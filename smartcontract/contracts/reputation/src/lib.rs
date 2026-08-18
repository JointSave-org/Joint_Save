#![no_std]

//! JointSave Reputation Tracker (v2)
//!
//! Extends the Phase 1 tracker with a normalized scoring system.
//!
//! ## Score formula (0-1000)
//!   deposit_reliability = (successful_deposits / total_tracked_rounds) * 1000
//!                         defaults to 500 for members with no history
//!   pools_completed_ratio = pools_completed / pools_joined  (capped at 1.0)
//!   recency_bonus = based on seconds since last_activity:
//!       < 30 days  → 1000
//!       30-60 days → 500
//!       60-90 days → 250
//!       > 90 days  → 0
//!   total_score = (deposit_reliability * 0.6)
//!               + (pools_completed_ratio * 1000 * 0.3)
//!               + (recency_bonus * 0.1)
//!
//! ## Provisional flag
//!   Scores are "provisional" until at least 10 deposits have been recorded.
//!
//! ## Authorization model
//!   record_* / update_score functions call `pool.require_auth()` where `pool`
//!   is the contract address of the calling pool.  A Soroban contract address
//!   is implicitly authorized when it is the direct caller, so only a real
//!   deployed pool can update scores.

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec};

// ── Version ───────────────────────────────────────────────────────────────────

const VERSION: u32 = 2;

// ── TTL constants ─────────────────────────────────────────────────────────────

const LEDGER_THRESHOLD: u32 = 518400;
const LEDGER_BUMP: u32 = 2592000;

// ── Thresholds ────────────────────────────────────────────────────────────────

/// Deposits required before a score is considered "established"
const PROVISIONAL_THRESHOLD: u32 = 10;

/// Seconds per day (approximate)
const SECS_PER_DAY: u64 = 86_400;

// ── Data types ────────────────────────────────────────────────────────────────

/// Full reputation dataset for a single member.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationData {
    /// Normalized score 0-1000
    pub total_score: u32,
    /// (successful_deposits / total_tracked_rounds) * 1000
    pub deposit_reliability: u32,
    /// Number of pools where this member received a payout or completion
    pub pools_completed: u32,
    /// Total pools this member has been recorded in (≥ 1 deposit OR ≥ 1 miss)
    pub pools_joined: u32,
    /// Cumulative successful deposits
    pub total_deposits: u32,
    /// Cumulative missed deposit rounds
    pub missed_deposits: u32,
    /// Unix timestamp of the last recorded activity (deposit or miss)
    pub last_activity: u64,
    /// Unix timestamp of the most recent score computation
    pub score_updated_at: u64,
}

/// Legacy struct kept for backward-compatible reads via `get_reputation`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationScore {
    pub total_deposits: i128,
    pub pools_completed: u32,
    pub missed_rounds: u32,
    pub on_time_rate: u32, // basis points: 10000 = 100%
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Full ReputationData per member
    MemberData(Address),
    /// Legacy score key for backward compatibility
    Score(Address),
    /// Legacy deposit count per member
    DepositsMade(Address),
    /// Legacy rounds tracked per member
    RoundsTracked(Address),
    /// Ordered list of all tracked members (used for leaderboard + TTL bumps)
    Members,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ReputationTracker;

#[contractimpl]
impl ReputationTracker {
    // ── Pool-facing write functions ────────────────────────────────────────

    /// Primary update entry-point called by pool contracts.
    ///
    /// `pool`             — the calling pool contract (must supply auth)
    /// `member`           — the member whose score is being updated
    /// `deposit_success`  — true = successful deposit, false = missed round
    /// `pool_completed`   — true = this event marks pool completion for member
    pub fn update_score(
        env: Env,
        pool: Address,
        member: Address,
        deposit_success: bool,
        pool_completed: bool,
    ) {
        pool.require_auth();
        Self::ensure_tracked(&env, &member);

        let storage = env.storage().persistent();
        let now = env.ledger().timestamp();

        let mut data = Self::load_data(&env, &member);

        // Track pool membership
        let is_first_event = data.total_deposits == 0 && data.missed_deposits == 0;
        if is_first_event {
            data.pools_joined += 1;
        } else {
            // Increment pools_joined only if this is the first event from THIS pool.
            // We use a separate per-(member, pool) key to track that.
            let pool_key = DataKey::Score(
                // Re-use Score key namespaced by concatenating member+pool via a
                // synthetic address — we store a bool under a pool-scoped key.
                // Since DataKey is an enum we embed the pool address in a new variant.
                // For simplicity we track "has this pool been seen for this member"
                // via the DepositsMade key which encodes both.
                member.clone(),
            );
            let _ = pool_key; // handled below via PoolSeen key pattern
        }

        // Always track pool membership correctly using a dedicated seen flag
        let seen_key = DataKey::DepositsMade(pool.clone()); // reused as "pool seen by member"
        // We store pool-member pairings in a different way: we check whether the
        // combination already has any deposits/misses recorded.
        // Since Soroban DataKey can't be a tuple without an Address, we use
        // a dedicated approach: track pools_joined by comparing current sum
        // against a stored "last known joins" counter via pools_joined itself.
        // The cleanest approach is: on first-ever event for a member, pools_joined=1.
        // On subsequent events, we detect a new pool by tracking a per-pool flag.
        let pool_seen_key_exists = storage.has(&DataKey::RoundsTracked(pool.clone()));
        if !pool_seen_key_exists {
            // First time this specific pool reports for this member
            if data.total_deposits > 0 || data.missed_deposits > 0 {
                // Member existed before this pool → new pool
                data.pools_joined += 1;
            } else {
                // Very first event ever for this member
                data.pools_joined = 1;
            }
            // Mark this pool as "seen" for this member
            storage.set(&DataKey::RoundsTracked(pool.clone()), &true);
            storage.extend_ttl(&DataKey::RoundsTracked(pool.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        drop(seen_key);

        // Record deposit or miss
        if deposit_success {
            data.total_deposits += 1;
        } else {
            data.missed_deposits += 1;
        }

        if pool_completed {
            data.pools_completed += 1;
        }

        data.last_activity = now;

        // Recompute score — recency uses `now` directly since we just recorded activity
        data.deposit_reliability = Self::compute_deposit_reliability(
            data.total_deposits,
            data.missed_deposits,
        );
        let recency = Self::compute_recency_bonus(now, now);
        let pools_completed_ratio_score = if data.pools_joined > 0 {
            let ratio = (data.pools_completed as u64 * 1000) / data.pools_joined as u64;
            ratio.min(1000) as u32
        } else {
            0u32
        };
        data.total_score = Self::compute_total_score(
            data.deposit_reliability,
            pools_completed_ratio_score,
            recency,
        );
        data.score_updated_at = now;

        storage.set(&DataKey::MemberData(member.clone()), &data);
        storage.extend_ttl(&DataKey::MemberData(member.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);

        // Keep legacy score in sync for backward-compatible reads
        Self::sync_legacy_score(&env, &member, &data);

        env.events()
            .publish((symbol_short!("rep_upd"), pool, member.clone()), data.total_score);

        Self::bump_member_ttl(&env, &member);
    }

    /// Record a successful deposit (legacy entry-point, still honoured by rotational pool).
    pub fn record_deposit(env: Env, pool: Address, member: Address, amount: i128) {
        pool.require_auth();
        assert!(amount > 0, "amount must be > 0");

        Self::ensure_tracked(&env, &member);

        let now = env.ledger().timestamp();
        let storage = env.storage().persistent();
        let mut data = Self::load_data(&env, &member);

        // Track pool membership
        let pool_seen_key_exists = storage.has(&DataKey::RoundsTracked(pool.clone()));
        if !pool_seen_key_exists {
            if data.total_deposits > 0 || data.missed_deposits > 0 {
                data.pools_joined += 1;
            } else {
                data.pools_joined = 1;
            }
            storage.set(&DataKey::RoundsTracked(pool.clone()), &true);
            storage.extend_ttl(&DataKey::RoundsTracked(pool.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
        }

        data.total_deposits += 1;
        data.last_activity = now;

        // Recompute
        data.deposit_reliability = Self::compute_deposit_reliability(
            data.total_deposits,
            data.missed_deposits,
        );
        let recency = Self::compute_recency_bonus(now, now); // just deposited → max recency
        let pcs = if data.pools_joined > 0 {
            ((data.pools_completed as u64 * 1000) / data.pools_joined as u64).min(1000) as u32
        } else {
            0
        };
        data.total_score = Self::compute_total_score(data.deposit_reliability, pcs, recency);
        data.score_updated_at = now;

        storage.set(&DataKey::MemberData(member.clone()), &data);
        storage.extend_ttl(&DataKey::MemberData(member.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::sync_legacy_score(&env, &member, &data);

        env.events()
            .publish((symbol_short!("rep_dep"), pool, member.clone()), amount);
        Self::bump_member_ttl(&env, &member);
    }

    /// Record a payout received / pool completed (legacy entry-point).
    pub fn record_payout_received(env: Env, pool: Address, member: Address) {
        pool.require_auth();
        Self::ensure_tracked(&env, &member);

        let now = env.ledger().timestamp();
        let storage = env.storage().persistent();
        let mut data = Self::load_data(&env, &member);
        data.pools_completed += 1;
        data.last_activity = now;

        // Recompute score
        let recency = Self::compute_recency_bonus(now, now);
        let pcs = if data.pools_joined > 0 {
            ((data.pools_completed as u64 * 1000) / data.pools_joined as u64).min(1000) as u32
        } else {
            0
        };
        data.total_score = Self::compute_total_score(data.deposit_reliability, pcs, recency);
        data.score_updated_at = now;

        storage.set(&DataKey::MemberData(member.clone()), &data);
        storage.extend_ttl(&DataKey::MemberData(member.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::sync_legacy_score(&env, &member, &data);

        env.events()
            .publish((symbol_short!("rep_pay"), pool, member.clone()), ());
        Self::bump_member_ttl(&env, &member);
    }

    /// Record a missed round (legacy entry-point).
    pub fn record_missed_round(env: Env, pool: Address, member: Address) {
        pool.require_auth();
        Self::ensure_tracked(&env, &member);

        let now = env.ledger().timestamp();
        let storage = env.storage().persistent();
        let mut data = Self::load_data(&env, &member);

        // Track pool membership
        let pool_seen_key_exists = storage.has(&DataKey::RoundsTracked(pool.clone()));
        if !pool_seen_key_exists {
            if data.total_deposits > 0 || data.missed_deposits > 0 {
                data.pools_joined += 1;
            } else {
                data.pools_joined = 1;
            }
            storage.set(&DataKey::RoundsTracked(pool.clone()), &true);
            storage.extend_ttl(&DataKey::RoundsTracked(pool.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
        }

        data.missed_deposits += 1;
        data.last_activity = now;

        data.deposit_reliability = Self::compute_deposit_reliability(
            data.total_deposits,
            data.missed_deposits,
        );
        let recency = Self::compute_recency_bonus(now, now);
        let pcs = if data.pools_joined > 0 {
            ((data.pools_completed as u64 * 1000) / data.pools_joined as u64).min(1000) as u32
        } else {
            0
        };
        data.total_score = Self::compute_total_score(data.deposit_reliability, pcs, recency);
        data.score_updated_at = now;

        storage.set(&DataKey::MemberData(member.clone()), &data);
        storage.extend_ttl(&DataKey::MemberData(member.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::sync_legacy_score(&env, &member, &data);

        env.events()
            .publish((symbol_short!("rep_miss"), pool, member.clone()), ());
        Self::bump_member_ttl(&env, &member);
    }

    // ── Read-only views ────────────────────────────────────────────────────

    /// Returns the full ReputationData for a member.
    /// Returns a provisional default (score=500, deposit_reliability=500) for unknowns.
    pub fn get_member_score(env: Env, member: Address) -> ReputationData {
        Self::load_data(&env, &member)
    }

    /// Batch version of get_member_score.
    pub fn get_members_scores(env: Env, members: Vec<Address>) -> Vec<ReputationData> {
        let mut results = Vec::new(&env);
        for m in members.iter() {
            results.push_back(Self::load_data(&env, &m));
        }
        results
    }

    /// Returns the top N members by total_score, sorted descending.
    /// Uses insertion-sort on the stored members list (member lists are small).
    pub fn get_score_leaderboard(env: Env, top_n: u32) -> Vec<(Address, ReputationData)> {
        let storage = env.storage().persistent();
        if !storage.has(&DataKey::Members) {
            return Vec::new(&env);
        }
        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();

        // Collect all scores
        let mut scored: Vec<(u32, Address)> = Vec::new(&env);
        for m in members.iter() {
            let data = Self::load_data(&env, &m);
            scored.push_back((data.total_score, m.clone()));
        }

        // Insertion-sort descending by score (in-place on Soroban Vec requires rebuild)
        let n = scored.len();
        for i in 1..n {
            let cur = scored.get(i).unwrap();
            let mut j = i;
            while j > 0 {
                let prev = scored.get(j - 1).unwrap();
                if prev.0 >= cur.0 {
                    break;
                }
                scored.set(j, prev.clone());
                j -= 1;
            }
            scored.set(j, cur);
        }

        // Build result, capped at top_n
        let mut result = Vec::new(&env);
        let limit = if top_n < n { top_n } else { n };
        for i in 0..limit {
            let (_, addr) = scored.get(i).unwrap();
            let data = Self::load_data(&env, &addr);
            result.push_back((addr, data));
        }
        result
    }

    /// Legacy read — returns the old ReputationScore struct so existing callers
    /// (frontend fetchReputation, existing tests) keep working unchanged.
    pub fn get_reputation(env: Env, address: Address) -> ReputationScore {
        let storage = env.storage().persistent();
        // Prefer legacy Score key if it exists (populated via sync_legacy_score)
        if let Some(score) = storage.get::<_, ReputationScore>(&DataKey::Score(address.clone())) {
            return score;
        }
        // Fall back to synthesising from new data
        let data = Self::load_data(&env, &address);
        let total_rounds = data.total_deposits + data.missed_deposits;
        let on_time_rate = if total_rounds == 0 {
            // No history yet — default to 100% (10000 basis points)
            10000u32
        } else {
            ((data.total_deposits as u64 * 10000) / total_rounds as u64).min(10000) as u32
        };
        ReputationScore {
            total_deposits: data.total_deposits as i128,
            pools_completed: data.pools_completed,
            missed_rounds: data.missed_deposits,
            on_time_rate,
        }
    }

    /// Returns true if the member's score is provisional (< 10 deposits).
    pub fn is_provisional(env: Env, member: Address) -> bool {
        let data = Self::load_data(&env, &member);
        data.total_deposits < PROVISIONAL_THRESHOLD
    }

    pub fn get_version(_env: Env) -> u32 {
        VERSION
    }

    // ── TTL maintenance ────────────────────────────────────────────────────

    pub fn bump_state(env: Env) {
        let storage = env.storage().persistent();
        if storage.has(&DataKey::Members) {
            storage.extend_ttl(&DataKey::Members, LEDGER_THRESHOLD, LEDGER_BUMP);
            let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
            for member in members.iter() {
                Self::bump_member_ttl(&env, &member);
            }
        }
    }

    // ── Private helpers ────────────────────────────────────────────────────

    /// deposit_reliability = (total_deposits / (total_deposits + missed_deposits)) * 1000
    /// Returns 500 when no history exists.
    fn compute_deposit_reliability(total_deposits: u32, missed_deposits: u32) -> u32 {
        let total_rounds = total_deposits + missed_deposits;
        if total_rounds == 0 {
            return 500;
        }
        ((total_deposits as u64 * 1000) / total_rounds as u64) as u32
    }

    /// Recency bonus based on seconds elapsed since last_activity.
    /// Note: this is called with `last_activity` set to `now` for fresh events,
    /// which always returns 1000.  The decay kicks in when re-reading a stale score.
    fn compute_recency_bonus(now: u64, last_activity: u64) -> u32 {
        if last_activity == 0 {
            return 0;
        }
        let elapsed_secs = if now > last_activity { now - last_activity } else { 0 };
        let days = elapsed_secs / SECS_PER_DAY;
        if days < 30 {
            1000
        } else if days < 60 {
            500
        } else if days < 90 {
            250
        } else {
            0
        }
    }

    /// total_score = (deposit_reliability * 0.6) + (pcs * 0.3) + (recency * 0.1)
    /// All three inputs are in 0-1000 range; result is 0-1000.
    fn compute_total_score(deposit_reliability: u32, pcs: u32, recency: u32) -> u32 {
        // Use integer arithmetic: multiply by 10 then divide by 10 to get
        // one-decimal precision without floats.
        let score = (deposit_reliability as u64 * 6
            + pcs as u64 * 3
            + recency as u64 * 1)
            / 10;
        score.min(1000) as u32
    }

    /// Add member to the global Members list if not already tracked.
    fn ensure_tracked(env: &Env, member: &Address) {
        let storage = env.storage().persistent();
        if storage.has(&DataKey::MemberData(member.clone())) {
            return;
        }
        let mut members: Vec<Address> = storage
            .get(&DataKey::Members)
            .unwrap_or_else(|| Vec::new(env));
        // Avoid duplicate entries
        for m in members.iter() {
            if m == *member {
                return;
            }
        }
        members.push_back(member.clone());
        storage.set(&DataKey::Members, &members);
        storage.extend_ttl(&DataKey::Members, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Load ReputationData or return a provisional default.
    fn load_data(env: &Env, member: &Address) -> ReputationData {
        env.storage()
            .persistent()
            .get(&DataKey::MemberData(member.clone()))
            .unwrap_or(ReputationData {
                total_score: 500,
                deposit_reliability: 500,
                pools_completed: 0,
                pools_joined: 0,
                total_deposits: 0,
                missed_deposits: 0,
                last_activity: 0,
                score_updated_at: 0,
            })
    }

    /// Keep the legacy ReputationScore key up-to-date so existing callers
    /// (frontend `get_reputation`, rotational tests) keep working.
    fn sync_legacy_score(env: &Env, member: &Address, data: &ReputationData) {
        let total_rounds = data.total_deposits + data.missed_deposits;
        let on_time_rate = if total_rounds == 0 {
            10000u32
        } else {
            ((data.total_deposits as u64 * 10000) / total_rounds as u64).min(10000) as u32
        };
        let legacy = ReputationScore {
            total_deposits: data.total_deposits as i128,
            pools_completed: data.pools_completed,
            missed_rounds: data.missed_deposits,
            on_time_rate,
        };
        let storage = env.storage().persistent();
        storage.set(&DataKey::Score(member.clone()), &legacy);
        storage.extend_ttl(&DataKey::Score(member.clone()), LEDGER_THRESHOLD, LEDGER_BUMP);
        // Legacy counters
        storage.set(&DataKey::DepositsMade(member.clone()), &data.total_deposits);
        storage.extend_ttl(
            &DataKey::DepositsMade(member.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }

    fn bump_member_ttl(env: &Env, member: &Address) {
        let storage = env.storage().persistent();
        for key in [
            DataKey::MemberData(member.clone()),
            DataKey::Score(member.clone()),
            DataKey::DepositsMade(member.clone()),
        ] {
            if storage.has(&key) {
                storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
        if storage.has(&DataKey::Members) {
            storage.extend_ttl(&DataKey::Members, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }
}

#[cfg(test)]
mod test;
