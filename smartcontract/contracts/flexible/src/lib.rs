#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, Vec};

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
}

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
        assert!(minimum_deposit > 0, "minimum must be > 0");

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
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
                storage.set(&DataKey::Balance(m.clone()), &(bal + member_yield));
            }
        }

        storage.set(&DataKey::TotalBalance, &(total + yield_amount));
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
        env.events()
            .publish((symbol_short!("add_mem"), new_member), ());
    }

    pub fn remove_member(env: Env, admin: Address, member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

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
        env.events()
            .publish((symbol_short!("rem_mem"), member), balance);
    }

    // ── Emergency controls ────────────────────────────────────────────────

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
            token_client.transfer(
                &env.current_contract_address(),
                &recipient,
                &contract_balance,
            );
        }

        storage.set(&DataKey::TotalBalance, &0i128);
        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
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
                    storage.set(&DataKey::Balance(m.clone()), &(bal + share));
                }
            }
            storage.set(&DataKey::TotalBalance, &(total + yield_amount));
            env.events()
                .publish((symbol_short!("harvested"),), yield_amount);
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────

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
}

#[cfg(test)]
mod tests;
