#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Vec};

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
        assert!(!Self::has_duplicate_members(&members), "duplicate member address");
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
    }

    // ── Views ──────────────────────────────────────────────────────────────

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

    // ── Helpers ────────────────────────────────────────────────────────────

    fn is_member(members: &Vec<Address>, who: &Address) -> bool {
        for m in members.iter() {
            if m == *who {
                return true;
            }
        }
        false
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
}

#[cfg(test)]
mod tests;
