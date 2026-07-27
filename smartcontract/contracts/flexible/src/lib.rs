#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, Env, Vec};
use soroban_sdk::xdr::{FromXdr};

const VERSION: u32 = 1;

#[contracttype]
pub enum DataKey {
    Token,
    Admin,
    Treasury,
    Members,
    MinimumDeposit,
    WithdrawalFeeBps,
    TreasuryFeeBps,
    YieldEnabled,
    TotalBalance,
    Active,
    Paused,
    Balance(Address),
    YieldStrategy,
    DeployedToYield,
    TokenDecimals,
    AdminQuorum,
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

const LEDGER_THRESHOLD: u32 = 518400;
const LEDGER_BUMP: u32 = 2592000;

#[contract]
pub struct FlexiblePool;

#[contractimpl]
impl FlexiblePool {
    pub fn initialize(
        env: Env,
        token: Address,
        admin: Address,
        members: Vec<Address>,
        minimum_deposit: i128,
        withdrawal_fee_bps: u32,
        yield_enabled: bool,
        treasury: Address,
        treasury_fee_bps: u32,
    ) {
        assert!(members.len() >= 2, "need >=2 members");
        assert!(
            !Self::has_duplicate_members(&members),
            "duplicate member address"
        );
        assert!(minimum_deposit > 0, "minimum must be > 0");

        // Validate the token is a real SEP-41 contract by reading its decimals
        // (this call traps for a non-token address) and remember it for display.
        let decimals = token::Client::new(&env, &token).decimals();

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::TokenDecimals, &decimals);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Treasury, &treasury);
        storage.set(&DataKey::Members, &members);
        storage.set(&DataKey::MinimumDeposit, &minimum_deposit);
        storage.set(&DataKey::WithdrawalFeeBps, &withdrawal_fee_bps);
        storage.set(&DataKey::TreasuryFeeBps, &treasury_fee_bps);
        storage.set(&DataKey::YieldEnabled, &yield_enabled);
        storage.set(&DataKey::TotalBalance, &0i128);
        storage.set(&DataKey::Active, &true);
        storage.set(&DataKey::Paused, &false);
        storage.set(&DataKey::DeployedToYield, &0i128);
        storage.set(&DataKey::AdminQuorum, &Vec::<Address>::new(&env));

        Self::bump_config_state_internal(&env);
    }

    pub fn deposit(env: Env, member: Address, amount: i128) {
        member.require_auth();

        let storage = env.storage().persistent();
        let active: bool = storage.get(&DataKey::Active).unwrap();
        assert!(active, "pool inactive");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");

        let min: i128 = storage.get(&DataKey::MinimumDeposit).unwrap();
        assert!(amount >= min, "below minimum deposit");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&member, &env.current_contract_address(), &amount);

        let prev: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        storage.set(&DataKey::Balance(member.clone()), &(prev + amount));

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        storage.set(&DataKey::TotalBalance, &(total + amount));

        let bal_key = DataKey::Balance(member.clone());
        storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("deposit"), member), amount);
    }

    pub fn withdraw(env: Env, member: Address, amount: i128) {
        member.require_auth();

        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        assert!(balance >= amount, "insufficient balance");

        let fee_bps: u32 = storage.get(&DataKey::WithdrawalFeeBps).unwrap();
        let fee = (amount * fee_bps as i128) / 10000;
        let net = amount - fee;

        storage.set(&DataKey::Balance(member.clone()), &(balance - amount));
        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        storage.set(&DataKey::TotalBalance, &(total - amount));

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let treasury: Address = storage.get(&DataKey::Treasury).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        if fee > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee);
        }
        token_client.transfer(&env.current_contract_address(), &member, &net);

        let bal_key = DataKey::Balance(member.clone());
        storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("withdraw"), member), net);
    }

    /// Distribute yield proportionally to all members with a balance.
    pub fn distribute_yield(env: Env, admin: Address, yield_amount: i128) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let yield_enabled: bool = storage.get(&DataKey::YieldEnabled).unwrap_or(false);
        assert!(yield_enabled, "yield disabled");
        assert!(yield_amount > 0, "yield must be > 0");

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        assert!(total > 0, "no balance");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        for m in members.iter() {
            let bal: i128 = storage.get(&DataKey::Balance(m.clone())).unwrap_or(0);
            if bal > 0 {
                let member_yield = (yield_amount * bal) / total;
                let bal_key = DataKey::Balance(m.clone());
                storage.set(&bal_key, &(bal + member_yield));
                storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }

        storage.set(&DataKey::TotalBalance, &(total + yield_amount));
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("yield"),), yield_amount);
    }

    pub fn add_member(env: Env, admin: Address, new_member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let mut members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(!Self::is_member(&members, &new_member), "already a member");

        members.push_back(new_member.clone());
        storage.set(&DataKey::Members, &members);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("add_mem"), new_member), ());
    }

    pub fn remove_member(env: Env, admin: Address, member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        if !Self::quorum_is_empty(&env) {
            panic!("use execute_approved");
        }

        Self::remove_member_internal(&env, &member);
    }

    fn remove_member_internal(env: &Env, member: &Address) {
        let storage = env.storage().persistent();

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, member), "not a member");
        assert!(members.len() > 1, "need >=1 members");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        if balance > 0 {
            let token_addr: Address = storage.get(&DataKey::Token).unwrap();
            token::Client::new(env, &token_addr).transfer(
                &env.current_contract_address(),
                member,
                &balance,
            );

            let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
            storage.set(&DataKey::TotalBalance, &(total - balance));
            storage.set(&DataKey::Balance(member.clone()), &0i128);
        }

        let mut updated_members: Vec<Address> = Vec::new(env);
        for existing in members.iter() {
            if existing != *member {
                updated_members.push_back(existing);
            }
        }

        storage.set(&DataKey::Members, &updated_members);

        Self::bump_config_state_internal(env);

        env.events()
            .publish((symbol_short!("rem_mem"), member.clone()), balance);
    }

    pub fn leave_pool(env: Env, member: Address) {
        member.require_auth();

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

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

            let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
            storage.set(&DataKey::TotalBalance, &(total - balance));
            storage.set(&DataKey::Balance(member.clone()), &0i128);
        }

        let mut updated_members: Vec<Address> = Vec::new(&env);
        for existing in members.iter() {
            if existing != member {
                updated_members.push_back(existing);
            }
        }

        storage.set(&DataKey::Members, &updated_members);
        Self::bump_config_state_internal(&env);
        env.events()
            .publish((symbol_short!("rem_mem"), member), balance);
    }

    // ── Emergency controls ────────────────────────────────────────────────

    pub fn set_admin_quorum(env: Env, admin: Address, new_admins: Vec<Address>) {
        admin.require_auth(); let storage = env.storage().persistent();
        assert!(storage.get::<_, Address>(&DataKey::Admin).unwrap() == admin, "not admin");
        assert!(!Self::has_duplicate_members(&new_admins), "duplicate admin");
        storage.set(&DataKey::AdminQuorum, &new_admins); Self::bump_config_state_internal(&env);
    }

    pub fn approve_action(env: Env, admin: Address, action_hash: Bytes) {
        admin.require_auth(); let storage = env.storage().persistent();
        let quorum: Vec<Address> = storage.get(&DataKey::AdminQuorum).unwrap_or(Vec::new(&env));
        assert!(Self::is_member(&quorum, &admin), "not quorum admin");
        let mut approvals: Vec<Address> = storage.get(&DataKey::PendingApprovals(action_hash.clone())).unwrap_or(Vec::new(&env));
        assert!(!Self::is_member(&approvals, &admin), "already approved"); approvals.push_back(admin);
        storage.set(&DataKey::PendingApprovals(action_hash.clone()), &approvals);
        if !storage.has(&DataKey::PendingCreated(action_hash.clone())) { storage.set(&DataKey::PendingCreated(action_hash), &env.ledger().timestamp()); }
    }

    pub fn revoke_approval(env: Env, admin: Address, action_hash: Bytes) {
        admin.require_auth(); let storage = env.storage().persistent();
        let quorum: Vec<Address> = storage.get(&DataKey::AdminQuorum).unwrap_or(Vec::new(&env)); assert!(Self::is_member(&quorum, &admin), "not quorum admin");
        let approvals: Vec<Address> = storage.get(&DataKey::PendingApprovals(action_hash.clone())).unwrap_or(Vec::new(&env)); let mut updated = Vec::new(&env);
        for item in approvals.iter() { if item != admin { updated.push_back(item); } } storage.set(&DataKey::PendingApprovals(action_hash), &updated);
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
        assert!(approvals.len() >= (quorum.len() + 1) / 2, "quorum not met");
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

        Self::bump_config_state_internal(env);

        env.events().publish((symbol_short!("paused"),), ());
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

    fn unpause_internal(env: &Env) {
        let storage = env.storage().persistent();
        storage.set(&DataKey::Paused, &false);

        Self::bump_config_state_internal(env);

        env.events().publish((symbol_short!("unpaused"),), ());
    }

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
                recipient,
                &contract_balance,
            );
        }

        storage.set(&DataKey::TotalBalance, &0i128);

        Self::bump_config_state_internal(env);

        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
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

    // ── Yield strategy ────────────────────────────────────────────────────

    /// Set the yield strategy contract address. Treasury-only, requires yield_enabled.
    pub fn set_yield_strategy(env: Env, admin: Address, strategy: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        let yield_enabled: bool = storage.get(&DataKey::YieldEnabled).unwrap_or(false);
        assert!(yield_enabled, "yield disabled");
        storage.set(&DataKey::YieldStrategy, &strategy);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("set_strat"),), strategy);
    }

    /// Deploy `amount` of pool funds to the yield strategy contract.
    pub fn deploy_to_yield(env: Env, admin: Address, amount: i128) {
        admin.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let strategy: Address = storage
            .get(&DataKey::YieldStrategy)
            .expect("no strategy set");

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        assert!(total >= amount, "insufficient pool balance");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &strategy,
            &amount,
        );

        let _: () = env.invoke_contract(
            &strategy,
            &symbol_short!("deploy"),
            soroban_sdk::vec![&env, soroban_sdk::IntoVal::into_val(&amount, &env)],
        );

        let deployed: i128 = storage.get(&DataKey::DeployedToYield).unwrap_or(0);
        storage.set(&DataKey::DeployedToYield, &(deployed + amount));

        Self::bump_config_state_internal(&env);

        env.events().publish((symbol_short!("deployed"),), amount);
    }

    /// Harvest yield from the strategy and distribute proportionally.
    pub fn harvest_yield(env: Env, admin: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let strategy: Address = storage
            .get(&DataKey::YieldStrategy)
            .expect("no strategy set");

        let yield_amount: i128 = env.invoke_contract(
            &strategy,
            &symbol_short!("harvest"),
            soroban_sdk::vec![&env],
        );

        if yield_amount > 0 {
            let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
            let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
            for m in members.iter() {
                let bal: i128 = storage.get(&DataKey::Balance(m.clone())).unwrap_or(0);
                if bal > 0 && total > 0 {
                    let share = (yield_amount * bal) / total;
                    let bal_key = DataKey::Balance(m.clone());
                    storage.set(&bal_key, &(bal + share));
                    storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
            storage.set(&DataKey::TotalBalance, &(total + yield_amount));
            env.events()
                .publish((symbol_short!("harvested"),), yield_amount);
        }

        Self::bump_config_state_internal(&env);
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
        storage.extend_ttl(&DataKey::Treasury, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Members, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::MinimumDeposit, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::WithdrawalFeeBps, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::TreasuryFeeBps, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::YieldEnabled, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::TotalBalance, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Active, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Paused, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::DeployedToYield, LEDGER_THRESHOLD, LEDGER_BUMP);
        if storage.has(&DataKey::AdminQuorum) { storage.extend_ttl(&DataKey::AdminQuorum, LEDGER_THRESHOLD, LEDGER_BUMP); }

        if storage.has(&DataKey::YieldStrategy) {
            storage.extend_ttl(&DataKey::YieldStrategy, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────

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

    pub fn total_balance(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalBalance)
            .unwrap_or(0)
    }

    pub fn get_admin_quorum(env: Env) -> Vec<Address> { env.storage().persistent().get(&DataKey::AdminQuorum).unwrap_or(Vec::new(&env)) }
    pub fn get_pending_action(env: Env, action_hash: Bytes) -> Vec<Address> { env.storage().persistent().get(&DataKey::PendingApprovals(action_hash)).unwrap_or(Vec::new(&env)) }
    pub fn get_approval_count(env: Env, action_hash: Bytes) -> u32 { Self::get_pending_action(env, action_hash).len() }

    /// Decimals of the pool's token, recorded at initialize time. Defaults to 7
    /// (native XLM) for pools created before multi-token support.
    pub fn token_decimals(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::TokenDecimals)
            .unwrap_or(7)
    }

    pub fn members(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Members)
            .unwrap_or(Vec::new(&env))
    }

    pub fn is_active(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Active)
            .unwrap_or(false)
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

    pub fn yield_strategy(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::YieldStrategy)
    }

    pub fn deployed_to_yield(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::DeployedToYield)
            .unwrap_or(0)
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    fn is_member(members: &Vec<Address>, who: &Address) -> bool {
        for m in members.iter() {
            if m == *who {
                return true;
            }
        }
        false
    }

    fn quorum_is_empty(env: &Env) -> bool { env.storage().persistent().get::<_, Vec<Address>>(&DataKey::AdminQuorum).unwrap_or(Vec::new(env)).is_empty() }

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
}

#[cfg(test)]
mod tests;
