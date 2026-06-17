#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec, Symbol, symbol_short,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

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
}

// ── Contract ──────────────────────────────────────────────────────────────────

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
        assert!(deposit_amount > 0, "deposit must be > 0");
        assert!(round_duration > 0, "round_duration must be > 0");

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
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
        env.events().publish(
            (symbol_short!("deposit"), member),
            deposit_amount,
        );
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
        assert!(
            env.ledger().timestamp() >= next_payout_time,
            "too early"
        );

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        let deposit_amount: i128 = storage.get(&DataKey::DepositAmount).unwrap();
        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let treasury: Address = storage.get(&DataKey::Treasury).unwrap();
        let treasury_fee_bps: u32 = storage.get(&DataKey::TreasuryFeeBps).unwrap();
        let relayer_fee_bps: u32 = storage.get(&DataKey::RelayerFeeBps).unwrap();
        let current_round: u32 = storage.get(&DataKey::CurrentRound).unwrap();
        let round_duration: u64 = storage.get(&DataKey::RoundDuration).unwrap();

        let token_client = token::Client::new(&env, &token_addr);

        // Count deposits
        let mut deposit_count: i128 = 0;
        for m in members.iter() {
            if storage
                .get::<DataKey, bool>(&DataKey::HasDeposited(m.clone()))
                .unwrap_or(false)
            {
                deposit_count += 1;
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
        token_client.transfer(&env.current_contract_address(), &beneficiary, &payout_amount);

        env.events().publish(
            (symbol_short!("payout"), beneficiary.clone()),
            payout_amount,
        );

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

        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
    }

    // ── Views ──────────────────────────────────────────────────────────────

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
