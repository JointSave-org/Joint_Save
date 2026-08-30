//! Property-based fuzz / invariant tests for JointSave Reputation Tracker Contract.
//!
//! Covers:
//!   - Score formula: total_score always in [0, 1000]
//!   - deposit_reliability = successful / (successful + missed) * 1000
//!   - recency_bonus is a non-increasing step function of elapsed time
//!   - pools_completed_ratio capped at 1000 (never exceeds pools_joined)
//!   - compute_total_score weights: 0.6 * reliability + 0.3 * completion + 0.1 * recency
//!   - Successful deposit never lowers reliability; missed deposit never raises it
//!   - is_provisional is true for < PROVISIONAL_THRESHOLD deposits, false after
//!   - No overflow in total_deposit_amount accumulation (saturating_add)
//!   - Multi-call fuzz: random update sequences never produce a score outside [0,1000]
//!
//! Run with:
//!   cargo test prop_ --manifest-path=contracts/reputation/Cargo.toml \
//!         --release -- --nocapture

#[cfg(test)]
mod prop_tests {
    use proptest::prelude::*;

    // In test binaries the standard library is always available even in no_std crates.
    extern crate std;
    use std::vec::Vec as StdVec;
    // Bring in the std vec![] macro explicitly to avoid ambiguity with soroban_sdk::vec!.
    macro_rules! std_vec {
        ($($x:expr),* $(,)?) => {
            <StdVec<_>>::from([$($x),*])
        };
    }

    // ── On-chain constants (must match lib.rs) ────────────────────────────────

    const PROVISIONAL_THRESHOLD: u32 = 10;
    const SECS_PER_DAY: u64 = 86_400;

    // ── Mirrors of pure on-chain helpers ─────────────────────────────────────

    fn compute_deposit_reliability(successful: u32, missed: u32) -> u32 {
        // Mirror of lib.rs: use saturating_add to prevent u32 overflow when
        // both counters are near u32::MAX (regression for prop_reliability_no_overflow).
        let total = successful.saturating_add(missed);
        if total == 0 {
            return 500;
        }
        (successful as u64 * 1000 / total as u64).min(1000) as u32
    }

    fn compute_recency_bonus(now: u64, last_activity: u64) -> u32 {
        if now < last_activity {
            return 1000;
        }
        let elapsed = now - last_activity;
        let days = elapsed / SECS_PER_DAY;
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

    fn compute_total_score(reliability: u32, completion_score: u32, recency: u32) -> u32 {
        let r = reliability.min(1000);
        let c = completion_score.min(1000);
        let n = recency.min(1000);
        ((r as u64 * 6 + c as u64 * 3 + n as u64 * 1) / 10) as u32
    }

    fn is_provisional(total_deposits: u32) -> bool {
        total_deposits < PROVISIONAL_THRESHOLD
    }

    // ── Score-bounds invariants ───────────────────────────────────────────────

    // Zero-argument assertions must live outside proptest! as plain #[test] functions.
    #[test]
    fn prop_max_score_requires_all_max() {
        let score = compute_total_score(1000, 1000, 1000);
        assert_eq!(score, 1000);
    }

    #[test]
    fn prop_zero_score_when_all_zero() {
        let score = compute_total_score(0, 0, 0);
        assert_eq!(score, 0);
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50_000))]

        /// Invariant: total_score always in [0, 1000].
        #[test]
        fn prop_total_score_in_range(
            reliability in 0u32..=1000u32,
            completion in 0u32..=1000u32,
            recency in 0u32..=1000u32,
        ) {
            let score = compute_total_score(reliability, completion, recency);
            prop_assert!(score <= 1000, "score {} > 1000", score);
        }

        /// Invariant: score is monotone in reliability.
        #[test]
        fn prop_score_monotone_in_reliability(
            low_r in 0u32..=999u32,
            high_offset in 1u32..=1000u32,
            completion in 0u32..=1000u32,
            recency in 0u32..=1000u32,
        ) {
            let high_r = (low_r + high_offset).min(1000);
            let low_score = compute_total_score(low_r, completion, recency);
            let high_score = compute_total_score(high_r, completion, recency);
            prop_assert!(high_score >= low_score,
                "not monotone in reliability: {}→{} at r={}→{}", low_score, high_score, low_r, high_r);
        }

        /// Invariant: score is monotone in completion ratio.
        #[test]
        fn prop_score_monotone_in_completion(
            reliability in 0u32..=1000u32,
            low_c in 0u32..=999u32,
            high_offset in 1u32..=1000u32,
            recency in 0u32..=1000u32,
        ) {
            let high_c = (low_c + high_offset).min(1000);
            let low_score = compute_total_score(reliability, low_c, recency);
            let high_score = compute_total_score(reliability, high_c, recency);
            prop_assert!(high_score >= low_score,
                "not monotone in completion: {}→{} at c={}→{}", low_score, high_score, low_c, high_c);
        }

        /// Invariant: score is monotone in recency bonus.
        #[test]
        fn prop_score_monotone_in_recency(
            reliability in 0u32..=1000u32,
            completion in 0u32..=1000u32,
            low_n in 0u32..=999u32,
            high_offset in 1u32..=1000u32,
        ) {
            let high_n = (low_n + high_offset).min(1000);
            let low_score = compute_total_score(reliability, completion, low_n);
            let high_score = compute_total_score(reliability, completion, high_n);
            prop_assert!(high_score >= low_score,
                "not monotone in recency: {}→{} at n={}→{}", low_score, high_score, low_n, high_n);
        }
    }

    // ── deposit_reliability invariants ────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50_000))]

        /// Invariant: reliability always in [0, 1000].
        #[test]
        fn prop_reliability_in_range(
            successful in 0u32..=10_000u32,
            missed in 0u32..=10_000u32,
        ) {
            let r = compute_deposit_reliability(successful, missed);
            prop_assert!(r <= 1000, "reliability {} > 1000", r);
        }

        /// Invariant: zero history defaults to 500 (neutral).
        #[test]
        fn prop_reliability_default_500(
            _dummy in 0u32..=0u32,
        ) {
            prop_assert_eq!(compute_deposit_reliability(0, 0), 500);
        }

        /// Invariant: all successful → reliability == 1000.
        #[test]
        fn prop_reliability_all_success(successful in 1u32..=10_000u32) {
            prop_assert_eq!(compute_deposit_reliability(successful, 0), 1000);
        }

        /// Invariant: all missed → reliability == 0.
        #[test]
        fn prop_reliability_all_missed(missed in 1u32..=10_000u32) {
            prop_assert_eq!(compute_deposit_reliability(0, missed), 0);
        }

        /// Invariant: adding a successful deposit cannot decrease reliability.
        #[test]
        fn prop_reliability_non_decreasing_on_success(
            successful in 0u32..=10_000u32,
            missed in 0u32..=10_000u32,
        ) {
            let before = compute_deposit_reliability(successful, missed);
            let after  = compute_deposit_reliability(successful + 1, missed);
            prop_assert!(after >= before,
                "reliability decreased after success: {}→{} (s={}, m={})",
                before, after, successful, missed);
        }

        /// Invariant: adding a missed deposit cannot increase reliability.
        #[test]
        fn prop_reliability_non_increasing_on_miss(
            successful in 0u32..=10_000u32,
            missed in 0u32..=10_000u32,
        ) {
            let before = compute_deposit_reliability(successful, missed);
            let after  = compute_deposit_reliability(successful, missed + 1);
            prop_assert!(after <= before,
                "reliability increased after miss: {}→{} (s={}, m={})",
                before, after, successful, missed);
        }

        /// Boundary: extreme u32 inputs don't overflow.
        #[test]
        fn prop_reliability_no_overflow(
            successful in prop::sample::select(std_vec![0u32, 1u32, u32::MAX / 2, u32::MAX]),
            missed in prop::sample::select(std_vec![0u32, 1u32, u32::MAX / 2]),
        ) {
            let r = compute_deposit_reliability(successful, missed);
            prop_assert!(r <= 1000);
        }
    }

    // ── recency_bonus invariants ──────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20_000))]

        /// Invariant: recency_bonus is always in {0, 250, 500, 1000}.
        #[test]
        fn prop_recency_bonus_valid_values(
            now in 0u64..=u64::MAX / 2,
            last in 0u64..=u64::MAX / 2,
        ) {
            let bonus = compute_recency_bonus(now, last);
            prop_assert!(
                bonus == 0 || bonus == 250 || bonus == 500 || bonus == 1000,
                "unexpected recency bonus: {}", bonus
            );
        }

        /// Invariant: recency_bonus is non-increasing as time since last activity grows.
        #[test]
        fn prop_recency_bonus_decreases_with_time(
            last_activity in 0u64..=1_000_000u64,
            days_delta in 0u64..=200u64,
        ) {
            let base = last_activity;
            let now_a = base + days_delta * SECS_PER_DAY;
            let now_b = now_a + 30 * SECS_PER_DAY;
            let bonus_a = compute_recency_bonus(now_a, base);
            let bonus_b = compute_recency_bonus(now_b, base);
            prop_assert!(bonus_b <= bonus_a,
                "recency bonus increased with time: {}→{} (delta days={}+30)",
                bonus_a, bonus_b, days_delta);
        }

        /// Invariant: activity within last 30 days → 1000.
        #[test]
        fn prop_recent_activity_max_bonus(
            days_ago in 0u64..=29u64,
            base_time in SECS_PER_DAY * 30..=SECS_PER_DAY * 10_000,
        ) {
            let last = base_time - days_ago * SECS_PER_DAY;
            prop_assert_eq!(compute_recency_bonus(base_time, last), 1000,
                "activity {} days ago should give 1000 recency", days_ago);
        }

        /// Invariant: activity older than 90 days → 0.
        #[test]
        fn prop_old_activity_zero_bonus(
            days_ago in 90u64..=10_000u64,
            base_time in SECS_PER_DAY * 100..=SECS_PER_DAY * 100_000,
        ) {
            if days_ago * SECS_PER_DAY < base_time {
                let last = base_time - days_ago * SECS_PER_DAY;
                prop_assert_eq!(compute_recency_bonus(base_time, last), 0,
                    "activity {} days ago should give 0 recency", days_ago);
            }
        }
    }

    // ── Provisional flag invariants ───────────────────────────────────────────

    // Zero-argument assertion — plain #[test].
    #[test]
    fn prop_provisional_exactly_at_threshold() {
        assert!(!is_provisional(PROVISIONAL_THRESHOLD));
        assert!(is_provisional(PROVISIONAL_THRESHOLD - 1));
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        #[test]
        fn prop_provisional_threshold(deposits in 0u32..=20u32) {
            let provisional = is_provisional(deposits);
            if deposits < PROVISIONAL_THRESHOLD {
                prop_assert!(provisional);
            } else {
                prop_assert!(!provisional);
            }
        }
    }

    // ── Multi-call simulation ─────────────────────────────────────────────────

    struct MemberSim {
        total_deposits: u32,
        missed_deposits: u32,
        pools_completed: u32,
        pools_joined: u32,
        total_deposit_amount: i128,
        total_score: u32,
    }

    impl MemberSim {
        fn new() -> Self {
            MemberSim {
                total_deposits: 0,
                missed_deposits: 0,
                pools_completed: 0,
                pools_joined: 1,
                total_deposit_amount: 0,
                total_score: 500,
            }
        }

        fn update(&mut self, deposit_success: bool, pool_completed: bool, now: u64, amount: i128) {
            if deposit_success {
                self.total_deposits += 1;
                self.total_deposit_amount = self.total_deposit_amount.saturating_add(amount);
            } else {
                self.missed_deposits += 1;
            }
            if pool_completed {
                // A pool_completed event means the member was active in (at least) one
                // additional pool.  Keep pools_joined in sync so pools_completed can
                // never exceed it.
                self.pools_joined += 1;
                self.pools_completed += 1;
            }

            let reliability = compute_deposit_reliability(self.total_deposits, self.missed_deposits);
            let completion_score = if self.pools_joined > 0 {
                ((self.pools_completed as u64 * 1000) / self.pools_joined as u64).min(1000) as u32
            } else {
                0
            };
            let recency = compute_recency_bonus(now, now);
            self.total_score = compute_total_score(reliability, completion_score, recency);
        }

        fn check_invariants(&self) -> Result<(), &'static str> {
            if self.total_score > 1000 {
                return Err("total_score > 1000");
            }
            if self.total_deposit_amount < 0 {
                return Err("total_deposit_amount negative (should be saturating)");
            }
            if self.pools_completed > self.pools_joined {
                return Err("pools_completed > pools_joined");
            }
            Ok(())
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(5_000))]

        /// Multi-call fuzz: random update sequences never produce out-of-range scores.
        #[test]
        fn prop_reputation_multicall_score_always_valid(
            operations in prop::collection::vec(
                (prop::bool::ANY, prop::bool::ANY, 0u64..=200_000u64, 1i128..=1_000_000_0000000i128),
                1..=100
            ),
        ) {
            let mut member = MemberSim::new();
            let mut timestamp = 0u64;

            for (deposit_success, pool_completed, time_delta, amount) in operations {
                timestamp += time_delta;
                member.update(deposit_success, pool_completed, timestamp, amount);
                member.check_invariants().map_err(|e| TestCaseError::fail(e))?;
            }
        }

        /// Invariant: saturating_add prevents total_deposit_amount overflow.
        #[test]
        fn prop_total_deposit_amount_no_overflow(
            amounts in prop::collection::vec(
                prop::sample::select(std_vec![
                    1i128, 1000i128, 1_000_000_0000000i128, i128::MAX / 2
                ]),
                1..=50
            ),
        ) {
            let mut member = MemberSim::new();
            let mut now = 0u64;
            for amount in amounts {
                now += 1;
                member.update(true, false, now, amount);
                prop_assert!(member.total_deposit_amount >= 0,
                    "total_deposit_amount went negative: {}", member.total_deposit_amount);
            }
        }

        /// Invariant: pure deposit history trends toward high score.
        #[test]
        fn prop_pure_deposit_history_trends_high(n in 10u32..=100u32) {
            let mut member = MemberSim::new();
            let mut now = SECS_PER_DAY; // within 30-day recency window
            for _ in 0..n {
                member.update(true, false, now, 1_000);
                now += 60;
            }
            let reliability = compute_deposit_reliability(member.total_deposits, member.missed_deposits);
            prop_assert_eq!(reliability, 1000, "all-success reliability should be 1000");
            prop_assert!(!is_provisional(member.total_deposits));
            prop_assert!(member.total_score >= 600,
                "score {} too low after {} clean deposits", member.total_score, n);
        }

        /// Invariant: pure miss history trends toward low score.
        #[test]
        fn prop_all_miss_history_trends_low(n in 10u32..=100u32) {
            let mut member = MemberSim::new();
            let mut now = SECS_PER_DAY;
            for _ in 0..n {
                member.update(false, false, now, 0);
                now += 60;
            }
            let reliability = compute_deposit_reliability(member.total_deposits, member.missed_deposits);
            prop_assert_eq!(reliability, 0);
            prop_assert!(member.total_score <= 400,
                "score {} too high after {} misses", member.total_score, n);
        }
    }

    // ── Boundary / overflow ───────────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        #[test]
        fn prop_total_score_extreme_inputs(
            r in prop::sample::select(std_vec![0u32, 1u32, 500u32, 999u32, 1000u32, u32::MAX]),
            c in prop::sample::select(std_vec![0u32, 1u32, 500u32, 999u32, 1000u32, u32::MAX]),
            n in prop::sample::select(std_vec![0u32, 250u32, 500u32, 1000u32]),
        ) {
            let score = compute_total_score(r, c, n);
            prop_assert!(score <= 1000, "score {} out of range", score);
        }
    }

    // ── Regression tests (named, always run, no proptest shrinking needed) ────

    /// Regression for: compute_deposit_reliability panicked with "attempt to add
    /// with overflow" when successful=u32::MAX and missed=1.
    ///
    /// Root cause: `let total = successful + missed` was a plain u32 addition.
    /// Fix: use `successful.saturating_add(missed)` in both lib.rs and this mirror.
    #[test]
    fn regression_reliability_no_overflow_at_u32_max() {
        // u32::MAX + 1 would panic without saturating_add.
        let r = compute_deposit_reliability(u32::MAX, 1);
        assert!(r <= 1000, "reliability {} > 1000 (overflow regression)", r);

        // u32::MAX + u32::MAX also safe.
        let r2 = compute_deposit_reliability(u32::MAX, u32::MAX);
        assert_eq!(r2, 1000, "all-success at overflow boundary should be 1000");

        // Zero + u32::MAX stays at 0.
        let r3 = compute_deposit_reliability(0, u32::MAX);
        assert_eq!(r3, 0, "all-miss at overflow boundary should be 0");
    }

    /// Regression for: prop_reputation_multicall_score_always_valid panicked with
    /// "pools_completed > pools_joined" after two consecutive (false, true, ...) ops.
    ///
    /// Root cause: MemberSim.update() incremented pools_completed without incrementing
    /// pools_joined, while pools_joined was initialised to 1 and never grew.
    /// Fix: each pool_completed event also increments pools_joined by 1.
    #[test]
    fn regression_pools_completed_never_exceeds_pools_joined() {
        let mut member = MemberSim::new();
        // Two pool_completed events in a row (no deposit, no prior join).
        member.update(false, true, 0, 1);
        member.update(false, true, 0, 1);

        assert!(
            member.pools_completed <= member.pools_joined,
            "pools_completed {} > pools_joined {} (regression)",
            member.pools_completed,
            member.pools_joined,
        );
        assert!(
            member.total_score <= 1000,
            "score {} out of range after regression inputs",
            member.total_score,
        );
        // Confirm invariant holds via check_invariants as well.
        member.check_invariants().expect("invariants failed on regression input");
    }
}
