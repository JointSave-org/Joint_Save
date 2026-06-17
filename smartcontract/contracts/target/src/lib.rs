#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec, symbol_short,
};

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
}

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
        assert!(target_amount > 0, "target must be > 0");

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Members, &members);
        storage.set(&DataKey::TargetAmount, &target_amount);
        storage.set(&DataKey::Deadline, &deadline);
        storage.set(&DataKey::TotalDeposited, &0i128);
        storage.set(&DataKey::Active, &true);
        storage.set(&DataKey::Unlocked, &false);
        storage.set(&DataKey::Paused, &false);
    }

    pub fn deposit(env: Env, member: Address, amount: i128) {
        member.require_auth();

        let storage = env.storage().persistent();
        assert!(storage.get::<_, bool>(&DataKey::Active).unwrap(), "pool inactive");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");
        assert!(amount > 0, "amount must be > 0");

        let deadline: u32 = storage.get(&DataKey::Deadline).unwrap();
        assert!(
            env.ledger().sequence() <= deadline,
            "deadline passed"
        );

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_addr)
            .transfer(&member, &env.current_contract_address(), &amount);

        let prev: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        storage.set(&DataKey::Balance(member.clone()), &(prev + amount));

        let total: i128 = storage.get(&DataKey::TotalDeposited).unwrap();
        let new_total = total + amount;
        storage.set(&DataKey::TotalDeposited, &new_total);

        // Auto-unlock when target is reached
        let target: i128 = storage.get(&DataKey::TargetAmount).unwrap();
        if new_total >= target {
            storage.set(&DataKey::Unlocked, &true);
            env.events().publish((symbol_short!("unlocked"),), new_total);
        }

        env.events().publish((symbol_short!("deposit"), member), amount);
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
        token::Client::new(&env, &token_addr)
            .transfer(&env.current_contract_address(), &member, &balance);

        env.events().publish((symbol_short!("withdraw"), member), balance);
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
    }

    // ── Emergency controls ─────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        storage.set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), ());
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        storage.set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), ());
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
            token_client.transfer(&env.current_contract_address(), &recipient, &contract_balance);
        }

        storage.set(&DataKey::TotalDeposited, &0i128);
        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    pub fn balance_of(env: Env, member: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(member)).unwrap_or(0)
    }

    pub fn total_deposited(env: Env) -> i128 {
        env.storage().persistent().get(&DataKey::TotalDeposited).unwrap_or(0)
    }

    pub fn is_unlocked(env: Env) -> bool {
        env.storage().persistent().get(&DataKey::Unlocked).unwrap_or(false)
    }

    pub fn target_amount(env: Env) -> i128 {
        env.storage().persistent().get(&DataKey::TargetAmount).unwrap_or(0)
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

    // ── Helpers ────────────────────────────────────────────────────────────

    fn is_member(members: &Vec<Address>, who: &Address) -> bool {
        for m in members.iter() {
            if m == *who { return true; }
        }
        false
    }
}

#[cfg(test)]
mod tests;
