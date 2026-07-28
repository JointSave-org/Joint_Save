#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, Env, IntoVal,
    Symbol, Vec,
};
use soroban_sdk::xdr::{FromXdr};

// ── Storage keys ──────────────────────────────────────────────────────────────

const VERSION: u32 = 1;

#[contracttype]
pub enum DataKey {
    Token,
    Admin,
    Treasury,
    Members,
    DepositAmount,
    RoundDuration,
    TreasuryFeeBps,
    RelayerFeeBps,
    CurrentRound,
    NextPayoutTime,
    Active,
    Paused,
    HasDeposited(Address),
    ReputationTracker,
    TokenDecimals,
    AdminQuorum,
    AdminQuorumThreshold,
    PendingApprovals(Bytes),
    PendingCreated(Bytes),
}

#[contracttype]
#[derive(Clone)]
pub enum Action {
    Pause,
    Unpause,
    EmergencyWithdraw(Address),
    RemoveMember(Address),
    MigratedFrom,
}

// ── Contract ──────────────────────────────────────────────────────────────────

const LEDGER_THRESHOLD: u32 = 518400;
const LEDGER_BUMP: u32 = 2592000;

#[contract]
pub struct RotationalPool;

#[contractimpl]
impl RotationalPool {
    /// Initialize the rotational savings pool.
    pub fn initialize(
        env: Env,
        token: Address,
        admin: Address,
        members: Vec<Address>,
        deposit_amount: i128,
        round_duration: u64,
        treasury_fee_bps: u32,
        relayer_fee_bps: u32,
        treasury: Address,
    ) {
        assert!(members.len() >= 2, "need >=2 members");
        assert!(
            !Self::has_duplicate_members(&members),
            "duplicate member address"
        );
        assert!(deposit_amount > 0, "deposit must be > 0");
        assert!(round_duration > 0, "round_duration must be > 0");

        // Validate the token is a real SEP-41 contract by reading its decimals
        // (this call traps for a non-token address) and remember it for display.
        let decimals = token::Client::new(&env, &token).decimals();

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::TokenDecimals, &decimals);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Treasury, &treasury);
        storage.set(&DataKey::Members, &members);
        storage.set(&DataKey::DepositAmount, &deposit_amount);
        storage.set(&DataKey::RoundDuration, &round_duration);
        storage.set(&DataKey::TreasuryFeeBps, &treasury_fee_bps);
        storage.set(&DataKey::RelayerFeeBps, &relayer_fee_bps);
        storage.set(&DataKey::CurrentRound, &0u32);
        storage.set(
            &DataKey::NextPayoutTime,
            &(env.ledger().timestamp() + round_duration),
        );
        storage.set(&DataKey::Active, &true);
        storage.set(&DataKey::Paused, &false);
        storage.set(&DataKey::AdminQuorum, &Vec::<Address>::new(&env));
        storage.set(&DataKey::AdminQuorumThreshold, &0u32);
        Self::bump_config_state_internal(&env);
    }

    /// Member deposits their fixed contribution for the current round.
    pub fn deposit(env: Env, member: Address) {
        member.require_auth();

        let storage = env.storage().persistent();
        let active: bool = storage.get(&DataKey::Active).unwrap();
        assert!(active, "pool inactive");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");

        let already: bool = storage
            .get(&DataKey::HasDeposited(member.clone()))
            .unwrap_or(false);
        assert!(!already, "already deposited this round");

        let deposit_amount: i128 = storage.get(&DataKey::DepositAmount).unwrap();
        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&member, &env.current_contract_address(), &deposit_amount);

        storage.set(&DataKey::HasDeposited(member.clone()), &true);
        storage.extend_ttl(
            &DataKey::HasDeposited(member.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.events()
            .publish((symbol_short!("deposit"), member.clone()), deposit_amount);

        Self::report_deposit(&env, &member, deposit_amount);
        Self::bump_config_state_internal(&env);
    }

    /// Trigger payout for the current round. Caller receives the relayer fee.
    pub fn trigger_payout(env: Env, relayer: Address) {
        relayer.require_auth();

        let storage = env.storage().persistent();
        let active: bool = storage.get(&DataKey::Active).unwrap();
        assert!(active, "pool inactive");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let next_payout_time: u64 = storage.get(&DataKey::NextPayoutTime).unwrap();
        assert!(env.ledger().timestamp() >= next_payout_time, "too early");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        let deposit_amount: i128 = storage.get(&DataKey::DepositAmount).unwrap();
        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let treasury: Address = storage.get(&DataKey::Treasury).unwrap();
        let treasury_fee_bps: u32 = storage.get(&DataKey::TreasuryFeeBps).unwrap();
        let relayer_fee_bps: u32 = storage.get(&DataKey::RelayerFeeBps).unwrap();
        let current_round: u32 = storage.get(&DataKey::CurrentRound).unwrap();
        let round_duration: u64 = storage.get(&DataKey::RoundDuration).unwrap();

        let token_client = token::Client::new(&env, &token_addr);

        // Count deposits and track members who missed this round
        let mut deposit_count: i128 = 0;
        let mut missed_members: Vec<Address> = Vec::new(&env);
        for m in members.iter() {
            if storage
                .get::<DataKey, bool>(&DataKey::HasDeposited(m.clone()))
                .unwrap_or(false)
            {
                deposit_count += 1;
            } else {
                missed_members.push_back(m.clone());
            }
        }
        assert!(deposit_count > 0, "no deposits this round");

        let total_collected = deposit_amount * deposit_count;
        let treasury_cut = (total_collected * treasury_fee_bps as i128) / 10000;
        let relayer_cut = (total_collected * relayer_fee_bps as i128) / 10000;
        let payout_amount = total_collected - treasury_cut - relayer_cut;

        let beneficiary = members.get(current_round).unwrap();

        if treasury_cut > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &treasury_cut);
        }
        if relayer_cut > 0 {
            token_client.transfer(&env.current_contract_address(), &relayer, &relayer_cut);
        }
        token_client.transfer(
            &env.current_contract_address(),
            &beneficiary,
            &payout_amount,
        );

        env.events().publish(
            (symbol_short!("payout"), beneficiary.clone()),
            payout_amount,
        );

        Self::report_payout(&env, &beneficiary);
        for m in missed_members.iter() {
            Self::report_missed_round(&env, &m);
        }

        // Reset deposits for next round
        for m in members.iter() {
            storage.remove(&DataKey::HasDeposited(m.clone()));
        }

        let next_round = current_round + 1;
        if next_round >= members.len() {
            storage.set(&DataKey::Active, &false);
            env.events()
                .publish((symbol_short!("complete"),), Symbol::new(&env, "pool_done"));
        } else {
            storage.set(&DataKey::CurrentRound, &next_round);
            storage.set(
                &DataKey::NextPayoutTime,
                &(env.ledger().timestamp() + round_duration),
            );
        }
        Self::bump_config_state_internal(&env);
    }

    pub fn add_member(env: Env, admin: Address, new_member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let current_round: u32 = storage.get(&DataKey::CurrentRound).unwrap_or(0);
        assert!(current_round == 0, "round already started");

        let mut members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(!Self::is_member(&members, &new_member), "already a member");

        for member in members.iter() {
            let has_deposited: bool = storage
                .get(&DataKey::HasDeposited(member.clone()))
                .unwrap_or(false);
            assert!(!has_deposited, "round already started");
        }

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

        let has_deposited: bool = storage
            .get(&DataKey::HasDeposited(member.clone()))
            .unwrap_or(false);
        assert!(!has_deposited, "member deposited this round");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        Self::member_index(&members, &member).expect("not a member");
        assert!(members.len() > 1, "need >=1 members");

        if !Self::quorum_is_empty(&env) {
            panic!("use execute_approved");
        }

        Self::remove_member_internal(&env, &member);
    }

    pub fn leave_pool(env: Env, member: Address) {
        member.require_auth();

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");

        let has_deposited: bool = storage
            .get(&DataKey::HasDeposited(member.clone()))
            .unwrap_or(false);
        assert!(!has_deposited, "member deposited this round");

        assert!(members.len() > 1, "need >=1 members");

        let current_round: u32 = storage.get(&DataKey::CurrentRound).unwrap_or(0);
        let beneficiary = members.get(current_round).unwrap();
        assert!(
            member != beneficiary,
            "current beneficiary cannot leave mid-round"
        );

        Self::remove_member_internal(&env, &member);
    }

    fn remove_member_internal(env: &Env, member: &Address) {
        let storage = env.storage().persistent();

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        let removed_index = Self::member_index(&members, member).expect("not a member");

        let mut updated_members: Vec<Address> = Vec::new(env);
        for existing in members.iter() {
            if existing != *member {
                updated_members.push_back(existing);
            }
        }

        let current_round: u32 = storage.get(&DataKey::CurrentRound).unwrap_or(0);
        let mut pool_completed = false;
        let updated_round = if removed_index < current_round {
            current_round - 1
        } else if removed_index == current_round && current_round >= updated_members.len() {
            pool_completed = true;
            0
        } else {
            current_round
        };

        storage.set(&DataKey::Members, &updated_members);
        storage.set(&DataKey::CurrentRound, &updated_round);
        if pool_completed {
            storage.set(&DataKey::Active, &false);
            env.events()
                .publish((symbol_short!("complete"),), Symbol::new(env, "pool_done"));
        }
        storage.remove(&DataKey::HasDeposited(member.clone()));
        env.events()
            .publish((symbol_short!("rem_mem"), member.clone()), ());
        Self::bump_config_state_internal(env);
    }

    // ── Emergency controls ─────────────────────────────────────────────────

    pub fn set_admin_quorum(env: Env, admin: Address, new_admins: Vec<Address>, threshold: u32) {
        admin.require_auth();
        let storage = env.storage().persistent();
        assert!(storage.get::<_, Address>(&DataKey::Admin).unwrap() == admin, "not admin");
        assert!(!Self::has_duplicate_members(&new_admins), "duplicate admin");
        assert!(threshold > 0, "threshold must be > 0");
        assert!(threshold <= new_admins.len(), "threshold > admins");
        storage.set(&DataKey::AdminQuorum, &new_admins);
        storage.set(&DataKey::AdminQuorumThreshold, &threshold);
        Self::bump_config_state_internal(&env);
    }

    pub fn approve_action(env: Env, admin: Address, action_hash: Bytes) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let quorum: Vec<Address> = storage.get(&DataKey::AdminQuorum).unwrap_or(Vec::new(&env));
        assert!(Self::is_member(&quorum, &admin), "not quorum admin");
        let mut approvals: Vec<Address> = storage.get(&DataKey::PendingApprovals(action_hash.clone())).unwrap_or(Vec::new(&env));
        assert!(!Self::is_member(&approvals, &admin), "already approved");
        approvals.push_back(admin);
        storage.set(&DataKey::PendingApprovals(action_hash.clone()), &approvals);
        if !storage.has(&DataKey::PendingCreated(action_hash.clone())) {
            storage.set(&DataKey::PendingCreated(action_hash), &env.ledger().timestamp());
        }
        Self::bump_config_state_internal(&env);
    }

    pub fn revoke_approval(env: Env, admin: Address, action_hash: Bytes) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let quorum: Vec<Address> = storage.get(&DataKey::AdminQuorum).unwrap_or(Vec::new(&env));
        assert!(Self::is_member(&quorum, &admin), "not quorum admin");
        let approvals: Vec<Address> = storage.get(&DataKey::PendingApprovals(action_hash.clone())).unwrap_or(Vec::new(&env));
        let mut updated = Vec::new(&env);
        for item in approvals.iter() { if item != admin { updated.push_back(item); } }
        storage.set(&DataKey::PendingApprovals(action_hash), &updated);
    }

    pub fn execute_approved(env: Env, action_hash: Bytes, action_data: Bytes) {
        let digest = env.crypto().sha256(&action_data);
        let expected = Bytes::from_slice(&env, &digest.to_array());
        assert!(expected == action_hash, "action hash mismatch");
        let storage = env.storage().persistent();
        let quorum: Vec<Address> = storage.get(&DataKey::AdminQuorum).unwrap_or(Vec::new(&env));
        assert!(!quorum.is_empty(), "quorum not configured");
        let created: u64 = storage.get(&DataKey::PendingCreated(action_hash.clone())).unwrap_or(0);
        assert!(created > 0 && env.ledger().timestamp() <= created + 172800, "approval expired");
        let approvals: Vec<Address> = storage.get(&DataKey::PendingApprovals(action_hash.clone())).unwrap_or(Vec::new(&env));
        let threshold: u32 = storage.get(&DataKey::AdminQuorumThreshold).unwrap_or(0);
        let required_approvals = if threshold > 0 {
            threshold
        } else {
            (quorum.len() + 1) / 2
        };
        assert!(approvals.len() >= required_approvals, "quorum not met");
        let action: Action = Action::from_xdr(&env, &action_data).unwrap();
        match action {
            Action::Pause => Self::pause_internal(&env),
            Action::Unpause => Self::unpause_internal(&env),
            Action::EmergencyWithdraw(recipient) => Self::emergency_withdraw_internal(&env, &recipient),
            Action::RemoveMember(member) => Self::remove_member_internal(&env, &member),
        }
        storage.remove(&DataKey::PendingApprovals(action_hash.clone()));
        storage.remove(&DataKey::PendingCreated(action_hash));
    }

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        if !Self::quorum_is_empty(&env) {
            panic!("use execute_approved");
        }
        Self::pause_internal(&env);
    }

    fn pause_internal(env: &Env) {
        let storage = env.storage().persistent();
        storage.set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), ());
        Self::bump_config_state_internal(env);
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        if !Self::quorum_is_empty(&env) {
            panic!("use execute_approved");
        }
        Self::unpause_internal(&env);
    }

    fn unpause_internal(env: &Env) { let storage = env.storage().persistent(); storage.set(&DataKey::Paused, &false); env.events().publish((symbol_short!("unpaused"),), ()); Self::bump_config_state_internal(env); }

    pub fn emergency_withdraw(env: Env, admin: Address, recipient: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        if !Self::quorum_is_empty(&env) {
            panic!("use execute_approved");
        }
        Self::emergency_withdraw_internal(&env, &recipient);
    }

    fn emergency_withdraw_internal(env: &Env, recipient: &Address) {
        let storage = env.storage().persistent();

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(paused, "pool not paused");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(env, &token_addr);
        let contract_balance = token_client.balance(&env.current_contract_address());

        if contract_balance > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &recipient,
                &contract_balance,
            );
        }

        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
        Self::bump_config_state_internal(env);
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

    /// Point this pool at a deployed ReputationTracker contract so deposits,
    /// payouts, and missed rounds are reported for the on-chain reputation
    /// system. Restricted to pool members; safe to call more than once.
    pub fn set_reputation_tracker(env: Env, caller: Address, tracker: Address) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &caller), "not a member");
        storage.set(&DataKey::ReputationTracker, &tracker);
        Self::bump_config_state_internal(&env);
    }

    pub fn bump_state(env: Env) {
        Self::bump_config_state_internal(&env);
        let storage = env.storage().persistent();
        if storage.has(&DataKey::Members) {
            let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
            for member in members.iter() {
                let key = DataKey::HasDeposited(member.clone());
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
        storage.extend_ttl(&DataKey::Treasury, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Members, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::DepositAmount, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::RoundDuration, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::TreasuryFeeBps, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::RelayerFeeBps, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::CurrentRound, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::NextPayoutTime, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Active, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Paused, LEDGER_THRESHOLD, LEDGER_BUMP);
        if storage.has(&DataKey::AdminQuorum) { storage.extend_ttl(&DataKey::AdminQuorum, LEDGER_THRESHOLD, LEDGER_BUMP); }

        if storage.has(&DataKey::ReputationTracker) {
            storage.extend_ttl(&DataKey::ReputationTracker, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    // ── Views ──────────────────────────────────────────────────────────────

    pub fn get_version(_env: Env) -> u32 {
        VERSION
    }

    pub fn migrated_from(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::MigratedFrom)
    }

    pub fn reputation_tracker(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::ReputationTracker)
    }

    pub fn is_active(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Active)
            .unwrap_or(false)
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

    pub fn current_round(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::CurrentRound)
            .unwrap_or(0)
    }

    pub fn members(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Members)
            .unwrap_or(Vec::new(&env))
    }

    pub fn has_deposited(env: Env, member: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::HasDeposited(member))
            .unwrap_or(false)
    }

    pub fn next_payout_time(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextPayoutTime)
            .unwrap_or(0)
    }

    pub fn get_admin_quorum(env: Env) -> Vec<Address> {
        env.storage().persistent().get(&DataKey::AdminQuorum).unwrap_or(Vec::new(&env))
    }

    pub fn get_pending_action(env: Env, action_hash: Bytes) -> Vec<Address> {
        env.storage().persistent().get(&DataKey::PendingApprovals(action_hash)).unwrap_or(Vec::new(&env))
    }

    pub fn get_approval_count(env: Env, action_hash: Bytes) -> u32 {
        Self::get_pending_action(env, action_hash).len()
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

    fn quorum_is_empty(env: &Env) -> bool {
        env.storage().persistent().get::<_, Vec<Address>>(&DataKey::AdminQuorum).unwrap_or(Vec::new(env)).is_empty()
    }

    /// O(n^2) pairwise scan — member lists are small (capped well below
    /// the resource limits that would make this costly), so this is cheaper
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

    fn member_index(members: &Vec<Address>, who: &Address) -> Option<u32> {
        let mut index = 0u32;
        for m in members.iter() {
            if m == *who {
                return Some(index);
            }
            index += 1;
        }
        None
    }

    /// Best-effort report to the configured ReputationTracker. Reputation
    /// tracking is supplementary, so a missing/misconfigured tracker must
    /// never block the pool's core deposit/payout flow.
    fn reputation_tracker_addr(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::ReputationTracker)
    }

    fn report_deposit(env: &Env, member: &Address, amount: i128) {
        if let Some(tracker) = Self::reputation_tracker_addr(env) {
            let pool = env.current_contract_address();
            env.invoke_contract::<()>(
                &tracker,
                &Symbol::new(env, "record_deposit"),
                soroban_sdk::vec![
                    env,
                    pool.into_val(env),
                    member.into_val(env),
                    amount.into_val(env)
                ],
            );
        }
    }

    fn report_payout(env: &Env, member: &Address) {
        if let Some(tracker) = Self::reputation_tracker_addr(env) {
            let pool = env.current_contract_address();
            env.invoke_contract::<()>(
                &tracker,
                &Symbol::new(env, "record_payout_received"),
                soroban_sdk::vec![env, pool.into_val(env), member.into_val(env)],
            );
        }
    }

    fn report_missed_round(env: &Env, member: &Address) {
        if let Some(tracker) = Self::reputation_tracker_addr(env) {
            let pool = env.current_contract_address();
            env.invoke_contract::<()>(
                &tracker,
                &Symbol::new(env, "record_missed_round"),
                soroban_sdk::vec![env, pool.into_val(env), member.into_val(env)],
            );
        }
    }
}

#[cfg(test)]
mod fuzz_tests;
#[cfg(test)]
mod test;
#[cfg(test)]
mod tests;
