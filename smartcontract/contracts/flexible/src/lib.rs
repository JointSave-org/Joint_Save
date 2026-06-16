#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec, symbol_short,
};

#[contracttype]
pub enum DataKey {
    Token,
    Treasury,
    Members,
    MinimumDeposit,
    WithdrawalFeeBps,
    TreasuryFeeBps,
    YieldEnabled,
    TotalBalance,
    Active,
    Balance(Address),
}

#[contract]
pub struct FlexiblePool;

#[contractimpl]
impl FlexiblePool {
    pub fn initialize(
        env: Env,
        token: Address,
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
        storage.set(&DataKey::Treasury, &treasury);
        storage.set(&DataKey::Members, &members);
        storage.set(&DataKey::MinimumDeposit, &minimum_deposit);
        storage.set(&DataKey::WithdrawalFeeBps, &withdrawal_fee_bps);
        storage.set(&DataKey::TreasuryFeeBps, &treasury_fee_bps);
        storage.set(&DataKey::YieldEnabled, &yield_enabled);
        storage.set(&DataKey::TotalBalance, &0i128);
        storage.set(&DataKey::Active, &true);
    }

    pub fn deposit(env: Env, member: Address, amount: i128) {
        member.require_auth();

        let storage = env.storage().persistent();
        let active: bool = storage.get(&DataKey::Active).unwrap();
        assert!(active, "pool inactive");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");

        let min: i128 = storage.get(&DataKey::MinimumDeposit).unwrap();
        assert!(amount >= min, "below minimum deposit");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&member, &env.current_contract_address(), &amount);

        let prev: i128 = storage
            .get(&DataKey::Balance(member.clone()))
            .unwrap_or(0);
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
        let balance: i128 = storage
            .get(&DataKey::Balance(member.clone()))
            .unwrap_or(0);
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
    /// Called by an admin/relayer after yield is earned externally.
    pub fn distribute_yield(env: Env, admin: Address, yield_amount: i128) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let yield_enabled: bool = storage.get(&DataKey::YieldEnabled).unwrap_or(false);
        assert!(yield_enabled, "yield disabled");
        assert!(yield_amount > 0, "yield must be > 0");

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        assert!(total > 0, "no balance");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        for m in members.iter() {
            let bal: i128 = storage
                .get(&DataKey::Balance(m.clone()))
                .unwrap_or(0);
            if bal > 0 {
                let member_yield = (yield_amount * bal) / total;
                storage.set(&DataKey::Balance(m.clone()), &(bal + member_yield));
            }
        }

        storage.set(&DataKey::TotalBalance, &(total + yield_amount));
        env.events()
            .publish((symbol_short!("yield"),), yield_amount);
    }

    // ── Views ──────────────────────────────────────────────────────────────

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

    // ── Helpers ────────────────────────────────────────────────────────────

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

