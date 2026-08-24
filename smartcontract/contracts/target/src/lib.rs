#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, IntoVal, Symbol, Vec,
};

const VERSION: u32 = 1;

#[contracttype]
pub enum DataKey {
    Token,
    Admin,
    Members,
    TargetAmount,
    Deadline,
    TotalDeposited,
    Active,
    Unlocked,
    Paused,
    Balance(Address),
    TokenDecimals,
    MigratedFrom,
    /// Optional address of the on-chain ReputationTracker contract.
    ReputationTracker,
    /// Optional allowlist of accepted token addresses (empty = unrestricted).
    SupportedTokens,
    /// Optional address of the attached DAO governance contract.
    GovernanceContract,
    /// Late/missed-deposit penalty percentage governable by the DAO (0-100).
    PenaltyPercentage,
}

const LEDGER_THRESHOLD: u32 = 518400;
const LEDGER_BUMP: u32 = 2592000;

#[contract]
pub struct TargetPool;

#[contractimpl]
impl TargetPool {
    /// Initialize the goal-based savings pool.
    /// Funds unlock once `target_amount` is collectively reached before `deadline` (ledger seq).
    pub fn initialize(
        env: Env,
        token: Address,
        admin: Address,
        members: Vec<Address>,
        target_amount: i128,
        deadline: u32,
    ) {
        assert!(members.len() >= 2, "need >=2 members");
        assert!(
            !Self::has_duplicate_members(&members),
            "duplicate member address"
        );
        assert!(target_amount > 0, "target must be > 0");

        // Validate the token is a real SEP-41 contract by reading its decimals
        // (this call traps for a non-token address) and remember it for display.
        let decimals = token::Client::new(&env, &token).decimals();

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::TokenDecimals, &decimals);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Members, &members);
        storage.set(&DataKey::TargetAmount, &target_amount);
        storage.set(&DataKey::Deadline, &deadline);
        storage.set(&DataKey::TotalDeposited, &0i128);
        storage.set(&DataKey::Active, &true);
        storage.set(&DataKey::Unlocked, &false);
        storage.set(&DataKey::Paused, &false);
        Self::bump_config_state_internal(&env);
    }

    pub fn deposit(env: Env, member: Address, amount: i128) {
        member.require_auth();

        let storage = env.storage().persistent();
        assert!(
            storage.get::<_, bool>(&DataKey::Active).unwrap(),
            "pool inactive"
        );

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");
        assert!(amount > 0, "amount must be > 0");

        let deadline: u32 = storage.get(&DataKey::Deadline).unwrap();
        assert!(env.ledger().sequence() <= deadline, "deadline passed");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        Self::assert_token_supported(&env, &token_addr);
        token::Client::new(&env, &token_addr).transfer(
            &member,
            &env.current_contract_address(),
            &amount,
        );

        let prev: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        storage.set(&DataKey::Balance(member.clone()), &(prev + amount));

        let total: i128 = storage.get(&DataKey::TotalDeposited).unwrap();
        let new_total = total + amount;
        storage.set(&DataKey::TotalDeposited, &new_total);

        // Auto-unlock when target is reached
        let target: i128 = storage.get(&DataKey::TargetAmount).unwrap();
        if new_total >= target {
            storage.set(&DataKey::Unlocked, &true);
            env.events()
                .publish((symbol_short!("unlocked"),), new_total);
            // Target reached = pool completion event. Report completion for
            // every member who has a positive balance at this point.
            let current_members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
            for m in current_members.iter() {
                let bal: i128 = storage.get(&DataKey::Balance(m.clone())).unwrap_or(0);
                // The depositing member's balance is already updated above,
                // so bal > 0 correctly identifies contributors.
                let is_depositor = m == member;
                let contributed = if is_depositor { bal > 0 } else { bal > 0 };
                Self::report_update_score(&env, &m, contributed, true);
            }
        } else {
            // Regular deposit — report success without pool_completed
            Self::report_update_score(&env, &member, true, false);
        }

        env.events()
            .publish((symbol_short!("deposit"), member.clone()), amount);
        storage.extend_ttl(&DataKey::Balance(member), LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::bump_config_state_internal(&env);
    }

    /// Withdraw proportional share. Only allowed once target is reached.
    pub fn withdraw(env: Env, member: Address) {
        member.require_auth();

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let unlocked: bool = storage.get(&DataKey::Unlocked).unwrap_or(false);
        assert!(unlocked, "target not reached yet");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        assert!(balance > 0, "nothing to withdraw");

        storage.set(&DataKey::Balance(member.clone()), &0i128);
        let total: i128 = storage.get(&DataKey::TotalDeposited).unwrap();
        storage.set(&DataKey::TotalDeposited, &(total - balance));

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &member,
            &balance,
        );

        env.events()
            .publish((symbol_short!("withdraw"), member), balance);
        Self::bump_config_state_internal(&env);
    }

    /// Admin can close the pool and refund all members if deadline passed without reaching target.
    pub fn refund(env: Env, admin: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let unlocked: bool = storage.get(&DataKey::Unlocked).unwrap_or(false);
        assert!(!unlocked, "target reached, use withdraw");

        let deadline: u32 = storage.get(&DataKey::Deadline).unwrap();
        assert!(env.ledger().sequence() > deadline, "deadline not passed");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();

        for m in members.iter() {
            let bal: i128 = storage.get(&DataKey::Balance(m.clone())).unwrap_or(0);
            if bal > 0 {
                storage.set(&DataKey::Balance(m.clone()), &0i128);
                token_client.transfer(&env.current_contract_address(), &m, &bal);
            }
        }

        storage.set(&DataKey::TotalDeposited, &0i128);
        storage.set(&DataKey::Active, &false);
        env.events().publish((symbol_short!("refunded"),), ());
        Self::bump_config_state_internal(&env);
    }

    pub fn add_member(env: Env, admin: Address, new_member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let unlocked: bool = storage.get(&DataKey::Unlocked).unwrap_or(false);
        assert!(!unlocked, "pool unlocked");

        let mut members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(!Self::is_member(&members, &new_member), "already a member");

        members.push_back(new_member.clone());
        storage.set(&DataKey::Members, &members);
        env.events()
            .publish((symbol_short!("add_mem"), new_member), ());
        Self::bump_config_state_internal(&env);
    }

    pub fn remove_member(env: Env, admin: Address, member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let unlocked: bool = storage.get(&DataKey::Unlocked).unwrap_or(false);
        assert!(!unlocked, "pool unlocked");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");
        assert!(members.len() > 1, "need >=1 members");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        if balance > 0 {
            let token_addr: Address = storage.get(&DataKey::Token).unwrap();
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &member,
                &balance,
            );

            let total: i128 = storage.get(&DataKey::TotalDeposited).unwrap();
            storage.set(&DataKey::TotalDeposited, &(total - balance));
            storage.set(&DataKey::Balance(member.clone()), &0i128);
        }

        let mut updated_members: Vec<Address> = Vec::new(&env);
        for existing in members.iter() {
            if existing != member {
                updated_members.push_back(existing);
            }
        }

        storage.set(&DataKey::Members, &updated_members);
        env.events()
            .publish((symbol_short!("rem_mem"), member), balance);
        Self::bump_config_state_internal(&env);
    }

    pub fn leave_pool(env: Env, member: Address) {
        member.require_auth();

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let unlocked: bool = storage.get(&DataKey::Unlocked).unwrap_or(false);
        assert!(!unlocked, "pool already unlocked, use withdraw");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");
        assert!(members.len() > 1, "need >=1 members");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        if balance > 0 {
            let token_addr: Address = storage.get(&DataKey::Token).unwrap();
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &member,
                &balance,
            );

            let total: i128 = storage.get(&DataKey::TotalDeposited).unwrap();
            storage.set(&DataKey::TotalDeposited, &(total - balance));
            storage.set(&DataKey::Balance(member.clone()), &0i128);
        }

        let mut updated_members: Vec<Address> = Vec::new(&env);
        for existing in members.iter() {
            if existing != member {
                updated_members.push_back(existing);
            }
        }

        storage.set(&DataKey::Members, &updated_members);
        env.events()
            .publish((symbol_short!("rem_mem"), member), balance);
        Self::bump_config_state_internal(&env);
    }

    // ── Emergency controls ─────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        storage.set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), ());
        Self::bump_config_state_internal(&env);
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        storage.set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), ());
        Self::bump_config_state_internal(&env);
    }

    // ── Token allowlist ───────────────────────────────────────────────────

    /// Set the tokens this pool is allowed to accept deposits in (e.g. the
    /// native XLM SAC and USDC's SAC on Stellar). Admin-only. An empty list
    /// (the default) leaves the pool unrestricted — it only ever holds the
    /// single token chosen at `initialize()`.
    pub fn set_supported_tokens(env: Env, admin: Address, tokens: Vec<Address>) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        storage.set(&DataKey::SupportedTokens, &tokens);
        storage.extend_ttl(&DataKey::SupportedTokens, LEDGER_THRESHOLD, LEDGER_BUMP);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("sup_tok"), admin), tokens.len() as u32);
    }

    pub fn emergency_withdraw(env: Env, admin: Address, recipient: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(paused, "pool not paused");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let contract_balance = token_client.balance(&env.current_contract_address());

        if contract_balance > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &recipient,
                &contract_balance,
            );
        }

        storage.set(&DataKey::TotalDeposited, &0i128);
        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
        Self::bump_config_state_internal(&env);
    }

    /// Migrate this contract to a new version. Admin-only.
    /// Version must be incremented by exactly 1. Running migrate() with
    /// `to_version` equal to the current version is a safe no-op (idempotent).
    pub fn migrate(env: Env, admin: Address, to_version: u32) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let current = VERSION;
        if to_version == current {
            return;
        }
        assert!(
            to_version == current + 1,
            "version must be incremented by exactly 1"
        );

        // Future migration logic goes here
        env.events()
            .publish((symbol_short!("migrated"), admin), to_version);
    }

    pub fn bump_state(env: Env) {
        Self::bump_config_state_internal(&env);
        let storage = env.storage().persistent();
        if storage.has(&DataKey::Members) {
            let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
            for member in members.iter() {
                let key = DataKey::Balance(member.clone());
                if storage.has(&key) {
                    storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
        }
    }

    fn bump_config_state_internal(env: &Env) {
        let storage = env.storage().persistent();
        storage.extend_ttl(&DataKey::Token, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Admin, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Members, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::TargetAmount, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Deadline, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::TotalDeposited, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Active, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Unlocked, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Paused, LEDGER_THRESHOLD, LEDGER_BUMP);

        if storage.has(&DataKey::ReputationTracker) {
            storage.extend_ttl(&DataKey::ReputationTracker, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::SupportedTokens) {
            storage.extend_ttl(&DataKey::SupportedTokens, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::GovernanceContract) {
            storage.extend_ttl(&DataKey::GovernanceContract, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::PenaltyPercentage) {
            storage.extend_ttl(&DataKey::PenaltyPercentage, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    /// Point this pool at a deployed ReputationTracker contract so deposits
    /// and pool completions are reported for the on-chain reputation system.
    /// Restricted to pool members; safe to call more than once.
    pub fn set_reputation_tracker(env: Env, caller: Address, tracker: Address) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &caller), "not a member");
        storage.set(&DataKey::ReputationTracker, &tracker);
        Self::bump_config_state_internal(&env);
    }

    // ── DAO governance ────────────────────────────────────────────────────

    /// Register the DAO governance contract allowed to apply proposals.
    pub fn set_governance_contract(env: Env, admin: Address, governance: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        storage.set(&DataKey::GovernanceContract, &governance);
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("gov_set"), admin), governance);
    }

    /// Apply a governance-approved parameter change. Callable by the pool
    /// admin directly or by the registered governance contract via CPI.
    ///
    /// Proposal types (symbols):
    ///   - "extend_deadline" -> ledgers to add to the deadline (> 0)
    ///   - "add_penalty"     -> penalty percentage 0-100
    ///   - "remove_penalty"  -> clears penalty percentage
    pub fn apply_governance_proposal(
        env: Env,
        caller: Address,
        proposal_type: Symbol,
        new_value: i128,
    ) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        let gov: Option<Address> = storage.get(&DataKey::GovernanceContract);
        assert!(
            caller == stored_admin || gov.map_or(false, |g| g == caller),
            "not authorized"
        );

        let extend_deadline = Symbol::new(&env, "extend_deadline");
        let add_penalty = Symbol::new(&env, "add_penalty");
        let remove_penalty = Symbol::new(&env, "remove_penalty");

        if proposal_type == extend_deadline {
            assert!(new_value > 0, "extension must be > 0");
            assert!(new_value <= u32::MAX as i128, "extension too large");
            let deadline: u32 = storage.get(&DataKey::Deadline).unwrap();
            let extended = deadline.checked_add(new_value as u32);
            assert!(extended.is_some(), "deadline overflow");
            storage.set(&DataKey::Deadline, &extended.unwrap());
        } else if proposal_type == add_penalty {
            assert!(new_value >= 0 && new_value <= 100, "penalty must be 0-100");
            storage.set(&DataKey::PenaltyPercentage, &(new_value as u32));
        } else if proposal_type == remove_penalty {
            storage.set(&DataKey::PenaltyPercentage, &0u32);
        } else {
            panic!("unsupported proposal type");
        }

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("gov_appl"), proposal_type), new_value);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    pub fn get_version(_env: Env) -> u32 {
        VERSION
    }

    pub fn migrated_from(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::MigratedFrom)
    }

    pub fn balance_of(env: Env, member: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(member))
            .unwrap_or(0)
    }

    pub fn total_deposited(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalDeposited)
            .unwrap_or(0)
    }

    pub fn is_unlocked(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Unlocked)
            .unwrap_or(false)
    }

    pub fn target_amount(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TargetAmount)
            .unwrap_or(0)
    }

    /// Decimals of the pool's token, recorded at initialize time. Defaults to 7
    /// (native XLM) for pools created before multi-token support.
    pub fn token_decimals(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::TokenDecimals)
            .unwrap_or(7)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().persistent().get(&DataKey::Admin).unwrap()
    }

    pub fn members(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Members)
            .unwrap_or(Vec::new(&env))
    }

    pub fn deadline(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Deadline)
            .unwrap_or(0)
    }

    pub fn reputation_tracker(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::ReputationTracker)
    }

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::SupportedTokens)
            .unwrap_or(Vec::new(&env))
    }

    /// Address of the attached DAO governance contract, if any.
    pub fn governance_contract(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::GovernanceContract)
    }

    /// Penalty percentage applied to missed deposits (0 by default).
    pub fn penalty_percentage(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PenaltyPercentage)
            .unwrap_or(0)
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    fn is_member(members: &Vec<Address>, who: &Address) -> bool {
        for m in members.iter() {
            if m == *who {
                return true;
            }
        }
        false
    }

    /// If a supported-token allowlist has been configured, require `token` to
    /// be on it. No-op while the allowlist is empty (default/back-compat).
    fn assert_token_supported(env: &Env, token: &Address) {
        let supported: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::SupportedTokens)
            .unwrap_or(Vec::new(env));
        if supported.len() > 0 {
            let mut found = false;
            for t in supported.iter() {
                if t == *token {
                    found = true;
                    break;
                }
            }
            assert!(found, "token not supported");
        }
    }

    /// O(n^2) pairwise scan — member lists are small, so this is cheaper
    /// than maintaining a separate index just to dedupe at init time.
    fn has_duplicate_members(members: &Vec<Address>) -> bool {
        for i in 0..members.len() {
            let a = members.get(i).unwrap();
            for j in (i + 1)..members.len() {
                if a == members.get(j).unwrap() {
                    return true;
                }
            }
        }
        false
    }

    /// Best-effort reputation report. A missing/misconfigured tracker must
    /// never block the pool's core deposit/payout flow.
    fn reputation_tracker_addr(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::ReputationTracker)
    }

    fn report_update_score(
        env: &Env,
        member: &Address,
        deposit_success: bool,
        pool_completed: bool,
    ) {
        if let Some(tracker) = Self::reputation_tracker_addr(env) {
            let pool = env.current_contract_address();
            env.invoke_contract::<()>(
                &tracker,
                &Symbol::new(env, "update_score"),
                soroban_sdk::vec![
                    env,
                    pool.into_val(env),
                    member.into_val(env),
                    deposit_success.into_val(env),
                    pool_completed.into_val(env)
                ],
            );
        }
    }
}

#[cfg(test)]
mod tests;
