#![no_std]

//! JointSave Reputation Tracker
//!
//! Foundational on-chain tracking for the Phase 2 reputation system.
//! Pool contracts (currently the Rotational pool) report participation
//! events here so that a trust score can be derived per member, across
//! every pool they have joined.
//!
//! Authorization model: each record_* function takes the reporting pool's
//! own contract address and calls `require_auth()` on it. Soroban
//! authorizes a contract address implicitly when that contract is the
//! direct caller of the current invocation, so only the genuine pool
//! contract (not an arbitrary spoofed caller) can update a member's score.

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, symbol_short};

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationScore {
    pub total_deposits: i128,
    pub pools_completed: u32,
    pub missed_rounds: u32,
    pub on_time_rate: u32, // basis points: 10000 = 100%
}

#[contracttype]
pub enum DataKey {
    Score(Address),
    DepositsMade(Address),
    RoundsTracked(Address),
}

#[contract]
pub struct ReputationTracker;

#[contractimpl]
impl ReputationTracker {
    /// Record a successful deposit made by `member` through `pool`.
    pub fn record_deposit(env: Env, pool: Address, member: Address, amount: i128) {
        pool.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().persistent();
        let mut score = Self::load_score(&env, &member);
        score.total_deposits += amount;

        let deposits_made: u32 = storage
            .get(&DataKey::DepositsMade(member.clone()))
            .unwrap_or(0)
            + 1;
        let rounds_tracked: u32 = storage
            .get(&DataKey::RoundsTracked(member.clone()))
            .unwrap_or(0)
            + 1;
        storage.set(&DataKey::DepositsMade(member.clone()), &deposits_made);
        storage.set(&DataKey::RoundsTracked(member.clone()), &rounds_tracked);

        score.on_time_rate = Self::on_time_rate(deposits_made, rounds_tracked);
        storage.set(&DataKey::Score(member.clone()), &score);

        env.events()
            .publish((symbol_short!("rep_dep"), pool, member), amount);
    }

    /// Record that `member` received a completed payout from `pool`.
    pub fn record_payout_received(env: Env, pool: Address, member: Address) {
        pool.require_auth();

        let storage = env.storage().persistent();
        let mut score = Self::load_score(&env, &member);
        score.pools_completed += 1;
        storage.set(&DataKey::Score(member.clone()), &score);

        env.events()
            .publish((symbol_short!("rep_pay"), pool, member), ());
    }

    /// Record that `member` skipped a round they were expected to deposit into.
    pub fn record_missed_round(env: Env, pool: Address, member: Address) {
        pool.require_auth();

        let storage = env.storage().persistent();
        let mut score = Self::load_score(&env, &member);
        score.missed_rounds += 1;

        let deposits_made: u32 = storage
            .get(&DataKey::DepositsMade(member.clone()))
            .unwrap_or(0);
        let rounds_tracked: u32 = storage
            .get(&DataKey::RoundsTracked(member.clone()))
            .unwrap_or(0)
            + 1;
        storage.set(&DataKey::RoundsTracked(member.clone()), &rounds_tracked);

        score.on_time_rate = Self::on_time_rate(deposits_made, rounds_tracked);
        storage.set(&DataKey::Score(member.clone()), &score);

        env.events()
            .publish((symbol_short!("rep_miss"), pool, member), ());
    }

    // ── Views ──────────────────────────────────────────────────────────────

    /// Read-only — no fees, no signing required.
    pub fn get_reputation(env: Env, address: Address) -> ReputationScore {
        Self::load_score(&env, &address)
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    fn load_score(env: &Env, member: &Address) -> ReputationScore {
        env.storage()
            .persistent()
            .get(&DataKey::Score(member.clone()))
            .unwrap_or(ReputationScore {
                total_deposits: 0,
                pools_completed: 0,
                missed_rounds: 0,
                on_time_rate: 10000,
            })
    }

    fn on_time_rate(deposits_made: u32, rounds_tracked: u32) -> u32 {
        if rounds_tracked == 0 {
            return 10000;
        }
        ((deposits_made as u64 * 10000) / rounds_tracked as u64) as u32
    }
}

#[cfg(test)]
mod test;
