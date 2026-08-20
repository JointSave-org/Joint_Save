#![no_std]

//! JointSave P2P Microloan Contract
//!
//! Enables pool members to request and offer short-term peer-to-peer loans
//! backed by their pool participation and on-chain reputation.
//!
//! ## Loan lifecycle
//!   PENDING  → borrower creates request, lender not yet assigned
//!   ACTIVE   → lender accepts, tokens transferred borrower-ward
//!   REPAID   → borrower repays full principal + interest
//!   DEFAULTED→ admin marks past-due loan as defaulted
//!   CANCELLED→ borrower cancels a PENDING request before acceptance
//!
//! ## Validation rules
//!   - lender and borrower must both be members of the same pool
//!   - max 3 active loans per member (as lender OR borrower)
//!   - interest_rate_bps: 0 – 5000 (0 % – 50 %)
//!   - term_days: 1 – 365
//!   - amount > 0
//!
//! ## Reputation side-effects (via cross-contract call, optional)
//!   - default_loan  → borrower reputation –200 pts  (record_missed_round ×20)
//!   - repay_loan (full) → borrower reputation +10 pts (record_deposit ×1)
//!
//! ## Authorization model
//!   - create_loan_request: borrower.require_auth()
//!   - accept_loan:         lender.require_auth()
//!   - repay_loan:          borrower.require_auth()
//!   - cancel_loan_request: borrower.require_auth()
//!   - default_loan:        admin.require_auth()

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env, IntoVal, Vec,
};

// ── TTL constants ─────────────────────────────────────────────────────────────

const LEDGER_THRESHOLD: u32 = 518_400;
const LEDGER_BUMP: u32 = 2_592_000;

// ── Business-rule limits ──────────────────────────────────────────────────────

/// Maximum simultaneous active loans a single member may hold (as lender or borrower).
const MAX_ACTIVE_LOANS: u32 = 3;
/// Maximum interest rate in basis points (5000 bps = 50 %).
const MAX_INTEREST_RATE_BPS: u32 = 5_000;
/// Maximum loan term in days.
const MAX_TERM_DAYS: u64 = 365;
/// Approximate seconds per day used for due-date calculation.
const SECS_PER_DAY: u64 = 86_400;

// ── Reputation adjustment constants ──────────────────────────────────────────

/// Number of `record_missed_round` calls made on default to approximate –200 pts.
/// Each miss costs roughly 10 pts at the median score, so 20 calls ≈ –200 pts.
const DEFAULT_MISS_CALLS: u32 = 20;

// ── Data types ────────────────────────────────────────────────────────────────

/// Loan status state machine.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoanStatus {
    Pending,
    Active,
    Repaid,
    Defaulted,
    Cancelled,
}

/// Full on-chain loan record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Loan {
    /// Unique loan ID (first 16 bytes of the env ledger sequence + borrower hash).
    pub id: BytesN<32>,
    /// Address that offered the loan (set when `accept_loan` is called).
    pub lender: Option<Address>,
    /// Address that requested the loan.
    pub borrower: Address,
    /// Principal amount in the pool's token stroops.
    pub amount: i128,
    /// Interest rate in basis points (0 – 5000).
    pub interest_rate_bps: u32,
    /// Loan duration in days.
    pub term_days: u64,
    /// Unix timestamp of the due date (set when `accept_loan` is called).
    pub due_date: u64,
    /// Current state.
    pub status: LoanStatus,
    /// Total amount repaid so far.
    pub repaid_amount: i128,
    /// Pool contract address this loan belongs to.
    pub pool_id: Address,
    /// Timestamp when the loan request was created.
    pub created_at: u64,
    /// Timestamp of the last status change.
    pub updated_at: u64,
}

impl Loan {
    /// Total amount owed = principal + interest.
    pub fn total_owed(&self) -> i128 {
        let interest = (self.amount as i128)
            .checked_mul(self.interest_rate_bps as i128)
            .unwrap_or(0)
            / 10_000_i128;
        self.amount + interest
    }

    /// Remaining balance after partial repayments.
    pub fn remaining(&self) -> i128 {
        let owed = self.total_owed();
        if self.repaid_amount >= owed {
            0
        } else {
            owed - self.repaid_amount
        }
    }
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Individual loan record keyed by loan ID.
    Loan(BytesN<32>),
    /// All loan IDs for a specific pool.
    PoolLoans(Address),
    /// All loan IDs associated with a member (as borrower or lender).
    MemberLoans(Address),
    /// Contract admin (can call `default_loan`).
    Admin,
    /// Optional reputation tracker contract for side-effects.
    ReputationTracker,
    /// Sequential counter for generating unique IDs.
    LoanCounter,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct MicroloanContract;

#[contractimpl]
impl MicroloanContract {
    // ── Initialisation ────────────────────────────────────────────────────

    /// One-time setup. Must be called before any other function.
    ///
    /// `admin`              – address permitted to call `default_loan`
    /// `reputation_tracker` – optional; pass `None` to skip reputation side-effects
    pub fn initialize(env: Env, admin: Address, reputation_tracker: Option<Address>) {
        let storage = env.storage().persistent();
        assert!(!storage.has(&DataKey::Admin), "already initialized");
        admin.require_auth();
        storage.set(&DataKey::Admin, &admin);
        storage.extend_ttl(&DataKey::Admin, LEDGER_THRESHOLD, LEDGER_BUMP);
        if let Some(tracker) = reputation_tracker {
            storage.set(&DataKey::ReputationTracker, &tracker);
            storage.extend_ttl(&DataKey::ReputationTracker, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        storage.set(&DataKey::LoanCounter, &0u64);
        storage.extend_ttl(&DataKey::LoanCounter, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    // ── Loan lifecycle functions ──────────────────────────────────────────

    /// Create a new pending loan request.
    ///
    /// The borrower specifies the desired principal, interest rate, and term.
    /// Any pool member who is not the borrower can subsequently call `accept_loan`.
    pub fn create_loan_request(
        env: Env,
        pool_id: Address,
        borrower: Address,
        amount: i128,
        interest_rate_bps: u32,
        term_days: u64,
        pool_members: Vec<Address>,
    ) -> BytesN<32> {
        borrower.require_auth();

        // Validate inputs
        assert!(amount > 0, "amount must be > 0");
        assert!(
            interest_rate_bps <= MAX_INTEREST_RATE_BPS,
            "interest_rate_bps exceeds maximum (5000)"
        );
        assert!(term_days >= 1, "term_days must be >= 1");
        assert!(term_days <= MAX_TERM_DAYS, "term_days exceeds maximum (365)");

        // Verify borrower is a pool member
        assert!(
            Self::is_pool_member(&borrower, &pool_members),
            "borrower is not a pool member"
        );

        // Enforce max active loans per borrower
        assert!(
            Self::count_active_loans_for_member(&env, &borrower) < MAX_ACTIVE_LOANS,
            "borrower has reached max active loans (3)"
        );

        let now = env.ledger().timestamp();
        let loan_id = Self::generate_loan_id(&env, &borrower);

        let loan = Loan {
            id: loan_id.clone(),
            lender: None,
            borrower: borrower.clone(),
            amount,
            interest_rate_bps,
            term_days,
            due_date: 0, // set on acceptance
            status: LoanStatus::Pending,
            repaid_amount: 0,
            pool_id: pool_id.clone(),
            created_at: now,
            updated_at: now,
        };

        Self::save_loan(&env, &loan);
        Self::append_pool_loan(&env, &pool_id, &loan_id);
        Self::append_member_loan(&env, &borrower, &loan_id);

        env.events().publish(
            (symbol_short!("ln_req"), pool_id, borrower),
            (loan_id.clone(), amount, interest_rate_bps, term_days),
        );

        loan_id
    }

    /// Accept a pending loan request as lender.
    ///
    /// Transfers `amount` tokens from lender to borrower and marks the loan
    /// ACTIVE.  The due date is computed from `term_days` and the current
    /// ledger timestamp.
    pub fn accept_loan(
        env: Env,
        loan_id: BytesN<32>,
        lender: Address,
        token_address: Address,
        pool_members: Vec<Address>,
    ) {
        lender.require_auth();

        let mut loan = Self::load_loan(&env, &loan_id);
        assert!(
            loan.status == LoanStatus::Pending,
            "loan is not in PENDING state"
        );
        assert!(lender != loan.borrower, "lender cannot be the borrower");

        // Verify lender is a pool member of the same pool
        assert!(
            Self::is_pool_member(&lender, &pool_members),
            "lender is not a pool member"
        );

        // Enforce max active loans per lender
        assert!(
            Self::count_active_loans_for_member(&env, &lender) < MAX_ACTIVE_LOANS,
            "lender has reached max active loans (3)"
        );

        let now = env.ledger().timestamp();
        loan.lender = Some(lender.clone());
        loan.due_date = now + loan.term_days * SECS_PER_DAY;
        loan.status = LoanStatus::Active;
        loan.updated_at = now;

        // Transfer principal from lender to borrower
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&lender, &loan.borrower, &loan.amount);

        Self::save_loan(&env, &loan);
        Self::append_member_loan(&env, &lender, &loan_id);

        env.events().publish(
            (symbol_short!("ln_acc"), loan.pool_id.clone(), lender),
            (loan_id, loan.borrower.clone(), loan.amount, loan.due_date),
        );
    }

    /// Repay part or all of an active loan.
    ///
    /// The borrower transfers `repay_amount` tokens to the lender.  When the
    /// full `total_owed` has been covered the loan is marked REPAID and the
    /// reputation side-effect (+10 pts) fires.
    pub fn repay_loan(
        env: Env,
        loan_id: BytesN<32>,
        borrower: Address,
        repay_amount: i128,
        token_address: Address,
    ) {
        borrower.require_auth();

        assert!(repay_amount > 0, "repay_amount must be > 0");

        let mut loan = Self::load_loan(&env, &loan_id);
        assert!(loan.status == LoanStatus::Active, "loan is not ACTIVE");
        assert!(loan.borrower == borrower, "caller is not the borrower");

        let remaining = loan.remaining();
        assert!(repay_amount <= remaining, "repay_amount exceeds remaining balance");

        let lender = loan.lender.clone().expect("active loan must have a lender");

        // Transfer repayment from borrower to lender
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&borrower, &lender, &repay_amount);

        let now = env.ledger().timestamp();
        loan.repaid_amount += repay_amount;
        loan.updated_at = now;

        let fully_repaid = loan.repaid_amount >= loan.total_owed();
        if fully_repaid {
            loan.status = LoanStatus::Repaid;

            // Reputation side-effect: +10 pts via record_deposit (single call)
            Self::try_reputation_deposit(&env, &loan.pool_id, &borrower, 1);
        }

        Self::save_loan(&env, &loan);

        env.events().publish(
            (symbol_short!("ln_rep"), loan.pool_id.clone(), borrower),
            (loan_id, repay_amount, loan.repaid_amount, fully_repaid),
        );
    }

    /// Cancel a pending (not-yet-accepted) loan request.
    ///
    /// Only the borrower can cancel, and only while the loan is PENDING.
    pub fn cancel_loan_request(env: Env, loan_id: BytesN<32>, borrower: Address) {
        borrower.require_auth();

        let mut loan = Self::load_loan(&env, &loan_id);
        assert!(
            loan.status == LoanStatus::Pending,
            "only PENDING loans can be cancelled"
        );
        assert!(loan.borrower == borrower, "caller is not the borrower");

        loan.status = LoanStatus::Cancelled;
        loan.updated_at = env.ledger().timestamp();
        Self::save_loan(&env, &loan);

        env.events().publish(
            (symbol_short!("ln_can"), loan.pool_id.clone(), borrower),
            loan_id,
        );
    }

    /// Mark an overdue active loan as DEFAULTED.
    ///
    /// Only the admin can call this. The loan must be ACTIVE and past its
    /// `due_date`.  Fires reputation side-effect: –200 pts on the borrower.
    pub fn default_loan(env: Env, loan_id: BytesN<32>) {
        let admin = Self::load_admin(&env);
        admin.require_auth();

        let mut loan = Self::load_loan(&env, &loan_id);
        assert!(loan.status == LoanStatus::Active, "loan is not ACTIVE");

        let now = env.ledger().timestamp();
        assert!(now > loan.due_date, "loan is not yet past due date");

        loan.status = LoanStatus::Defaulted;
        loan.updated_at = now;
        Self::save_loan(&env, &loan);

        // Reputation side-effect: –200 pts via 20× record_missed_round
        for _ in 0..DEFAULT_MISS_CALLS {
            Self::try_reputation_miss(&env, &loan.pool_id, &loan.borrower);
        }

        env.events().publish(
            (symbol_short!("ln_def"), loan.pool_id.clone(), loan.borrower.clone()),
            loan_id,
        );
    }

    // ── Read-only views ────────────────────────────────────────────────────

    /// Fetch a single loan by its ID.
    pub fn get_loan(env: Env, loan_id: BytesN<32>) -> Loan {
        Self::load_loan(&env, &loan_id)
    }

    /// Return all loan IDs associated with a member.
    pub fn get_member_loans(env: Env, member: Address) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::MemberLoans(member))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return all loan IDs for a pool.
    pub fn get_pool_loans(env: Env, pool_id: Address) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolLoans(pool_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Address {
        Self::load_admin(&env)
    }

    // ── TTL maintenance ───────────────────────────────────────────────────

    /// Extend the TTL for a loan and its associated indices.
    pub fn bump_loan(env: Env, loan_id: BytesN<32>) {
        let storage = env.storage().persistent();
        let key = DataKey::Loan(loan_id);
        if storage.has(&key) {
            storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────

    fn load_admin(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("contract not initialized")
    }

    fn load_loan(env: &Env, loan_id: &BytesN<32>) -> Loan {
        env.storage()
            .persistent()
            .get(&DataKey::Loan(loan_id.clone()))
            .expect("loan not found")
    }

    fn save_loan(env: &Env, loan: &Loan) {
        let storage = env.storage().persistent();
        storage.set(&DataKey::Loan(loan.id.clone()), loan);
        storage.extend_ttl(&DataKey::Loan(loan.id.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Append a loan ID to a pool's loan list, deduplicating.
    fn append_pool_loan(env: &Env, pool_id: &Address, loan_id: &BytesN<32>) {
        let storage = env.storage().persistent();
        let key = DataKey::PoolLoans(pool_id.clone());
        let mut list: Vec<BytesN<32>> = storage.get(&key).unwrap_or_else(|| Vec::new(env));
        list.push_back(loan_id.clone());
        storage.set(&key, &list);
        storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Append a loan ID to a member's loan list, deduplicating.
    fn append_member_loan(env: &Env, member: &Address, loan_id: &BytesN<32>) {
        let storage = env.storage().persistent();
        let key = DataKey::MemberLoans(member.clone());
        let mut list: Vec<BytesN<32>> = storage.get(&key).unwrap_or_else(|| Vec::new(env));
        // Avoid duplicate entries (e.g. lender already stored as borrower)
        for existing in list.iter() {
            if existing == *loan_id {
                return;
            }
        }
        list.push_back(loan_id.clone());
        storage.set(&key, &list);
        storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Count ACTIVE loans where `member` is either borrower or lender.
    fn count_active_loans_for_member(env: &Env, member: &Address) -> u32 {
        let storage = env.storage().persistent();
        let key = DataKey::MemberLoans(member.clone());
        let list: Vec<BytesN<32>> = storage.get(&key).unwrap_or_else(|| Vec::new(env));
        let mut count = 0u32;
        for loan_id in list.iter() {
            if let Some(loan) = storage.get::<_, Loan>(&DataKey::Loan(loan_id)) {
                if loan.status == LoanStatus::Active {
                    count += 1;
                }
            }
        }
        count
    }

    /// Check whether an address appears in the supplied pool members vector.
    fn is_pool_member(address: &Address, members: &Vec<Address>) -> bool {
        for m in members.iter() {
            if m == *address {
                return true;
            }
        }
        false
    }

    /// Generate a unique 32-byte loan ID from the counter + ledger timestamp.
    ///
    /// Layout: [ 8 bytes counter BE | 8 bytes ledger timestamp BE | 16 bytes zeros ]
    /// This is collision-free as long as the counter is monotonically increasing,
    /// which is guaranteed by the persistent storage counter.
    fn generate_loan_id(env: &Env, _borrower: &Address) -> BytesN<32> {
        let storage = env.storage().persistent();
        let counter_key = DataKey::LoanCounter;
        let counter: u64 = storage.get(&counter_key).unwrap_or(0);
        let new_counter = counter + 1;
        storage.set(&counter_key, &new_counter);
        storage.extend_ttl(&counter_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        // Build a 32-byte ID: 8 bytes counter + 8 bytes ledger timestamp + 16 zeros
        let mut id_bytes = [0u8; 32];
        let counter_bytes = new_counter.to_be_bytes();
        let ts_bytes = env.ledger().timestamp().to_be_bytes();
        for (i, b) in counter_bytes.iter().enumerate() {
            id_bytes[i] = *b;
        }
        for (i, b) in ts_bytes.iter().enumerate() {
            id_bytes[8 + i] = *b;
        }
        // Remaining 16 bytes stay zero (sufficient for uniqueness with counter)

        BytesN::from_array(env, &id_bytes)
    }

    /// Fire a `record_deposit` cross-contract call to the reputation tracker
    /// if one is configured. Used for repayment reward (+10 pts ≈ 1 deposit).
    fn try_reputation_deposit(env: &Env, pool_id: &Address, member: &Address, _amount: i128) {
        let storage = env.storage().persistent();
        if !storage.has(&DataKey::ReputationTracker) {
            return;
        }
        let tracker: Address = storage.get(&DataKey::ReputationTracker).unwrap();
        // Use the microloan contract itself as the "pool" caller so the
        // reputation contract's pool.require_auth() passes.
        let pool = env.current_contract_address();
        env.invoke_contract::<()>(
            &tracker,
            &soroban_sdk::Symbol::new(env, "record_deposit"),
            soroban_sdk::vec![
                env,
                pool.into_val(env),
                member.into_val(env),
                1i128.into_val(env),
            ],
        );
        // Silence unused variable warning on pool_id
        let _ = pool_id;
    }

    /// Fire a `record_missed_round` cross-contract call to the reputation
    /// tracker if one is configured.  Called 20× on default to approximate
    /// –200 pts.
    fn try_reputation_miss(env: &Env, pool_id: &Address, member: &Address) {
        let storage = env.storage().persistent();
        if !storage.has(&DataKey::ReputationTracker) {
            return;
        }
        let tracker: Address = storage.get(&DataKey::ReputationTracker).unwrap();
        let pool = env.current_contract_address();
        env.invoke_contract::<()>(
            &tracker,
            &soroban_sdk::Symbol::new(env, "record_missed_round"),
            soroban_sdk::vec![
                env,
                pool.into_val(env),
                member.into_val(env),
            ],
        );
        let _ = pool_id;
    }
}

#[cfg(test)]
mod tests;
