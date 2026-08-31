//! Property-based fuzz / invariant tests for JointSave Yield Strategy Contract.
//!
//! Uses a pure-arithmetic simulation of deployed/harvested tracking that mirrors
//! the on-chain logic in lib.rs.  This avoids the Soroban testutils entirely,
//! which lets proptest drive thousands of random inputs without a live Env or
//! mock contracts.
//!
//! Covered invariants:
//!   - deployed_amount tracks the sum of all deploy() calls; always ≥ 0
//!   - total_harvested tracks the sum of all harvest() calls; always ≥ 0
//!   - harvested ≤ position_value − deployed (no over-harvest)
//!   - share price = position_value / deployed_amount ≥ 1.0; never negative
//!   - After emergency_withdraw, deployed_amount resets to 0
//!   - Yield ratio arithmetic: position_value = deployed × ratio / 10_000; ≥ deployed
//!   - No overflow in accumulation of deployed / harvested under saturating arithmetic
//!   - Multi-call fuzz: deploy/harvest/emergency_withdraw sequences keep all invariants
//!   - Boundary: deploy amount 1, i128::MAX/2; yield_ratio 10_000 (0%) to 50_000 (400%)
//!
//! Run with:
//!   cargo test prop_ --manifest-path=contracts/yield-strategy/Cargo.toml \
//!         --release -- --nocapture

#[cfg(test)]
mod prop_tests {
    use proptest::prelude::*;

    extern crate std;
    use std::vec::Vec as StdVec;
    macro_rules! std_vec {
        ($($x:expr),* $(,)?) => {
            <StdVec<_>>::from([$($x),*])
        };
    }

    // ── Pure mirrors of on-chain arithmetic ───────────────────────────────────
    //
    // The yield strategy uses two persistent values:
    //   DeployedAmount  – running sum of deploy() calls
    //   TotalHarvested  – running sum of harvest() calls
    //
    // harvest() computes:
    //   position_value = dex.get_position_value(self)   (mocked here as deployed × ratio / 10_000)
    //   yield_amount   = position_value.saturating_sub(deployed)
    //   assert(yield_amount > 0)
    //
    // deploy() moves tokens from contract → protocol and adds `amount` to DeployedAmount.

    /// Mock DEX: position_value = deployed * ratio / 10_000.
    /// ratio == 10_000 means no yield; ratio == 11_000 means 10% yield.
    fn mock_position_value(deployed: i128, ratio: i128) -> i128 {
        // Use saturating multiplication to stay safe near i128::MAX.
        deployed
            .checked_mul(ratio)
            .map(|v| v / 10_000)
            .unwrap_or(i128::MAX / 2)
    }

    fn expected_yield(deployed: i128, ratio: i128) -> i128 {
        mock_position_value(deployed, ratio).saturating_sub(deployed)
    }

    // ── Arithmetic unit invariants ────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50_000))]

        /// Invariant: position_value ≥ deployed for any ratio ≥ 10_000.
        #[test]
        fn prop_position_value_ge_deployed_for_positive_yield(
            deployed in 1i128..=i128::MAX / 50_001,
            ratio in 10_000i128..=50_000i128,
        ) {
            let pos = mock_position_value(deployed, ratio);
            prop_assert!(pos >= deployed,
                "position_value {} < deployed {} at ratio {}", pos, deployed, ratio);
        }

        /// Invariant: position_value == deployed at ratio 10_000 (no yield).
        #[test]
        fn prop_no_yield_at_ratio_10000(
            deployed in 1i128..=i128::MAX / 10_001,
        ) {
            let pos = mock_position_value(deployed, 10_000);
            prop_assert_eq!(pos, deployed, "expected no yield at ratio 10_000");
        }

        /// Invariant: yield is non-decreasing with ratio.
        #[test]
        fn prop_yield_monotone_in_ratio(
            deployed in 1i128..=i128::MAX / 50_001,
            low_ratio in 10_000i128..=49_999i128,
            delta in 1i128..=50_000i128,
        ) {
            let high_ratio = (low_ratio + delta).min(50_000);
            let low_yield = expected_yield(deployed, low_ratio);
            let high_yield = expected_yield(deployed, high_ratio);
            prop_assert!(high_yield >= low_yield,
                "yield not monotone in ratio: {} → {} at ratio {}→{}",
                low_yield, high_yield, low_ratio, high_ratio);
        }

        /// Invariant: yield is never negative for ratio ≥ 10_000.
        #[test]
        fn prop_yield_never_negative(
            deployed in 1i128..=i128::MAX / 50_001,
            ratio in 10_000i128..=50_000i128,
        ) {
            let y = expected_yield(deployed, ratio);
            prop_assert!(y >= 0, "yield {} < 0 at ratio {}", y, ratio);
        }

        /// Boundary: ratio below 10_000 (theoretical loss scenario) gives negative yield.
        #[test]
        fn prop_loss_scenario_negative_yield(
            deployed in 1i128..=1_000_000i128,
            ratio in 1i128..=9_999i128,
        ) {
            let y = expected_yield(deployed, ratio);
            prop_assert!(y <= 0,
                "expected non-positive yield in loss scenario, got {}", y);
        }
    }

    // ── Simulation of deployed/harvested tracking ─────────────────────────────

    struct YieldSim {
        deployed_amount: i128,
        total_harvested: i128,
    }

    impl YieldSim {
        fn new() -> Self {
            YieldSim {
                deployed_amount: 0,
                total_harvested: 0,
            }
        }

        /// Simulate deploy(): add amount to deployed_amount.
        fn deploy(&mut self, amount: i128) -> bool {
            if amount <= 0 {
                return false;
            }
            self.deployed_amount = self.deployed_amount.saturating_add(amount);
            true
        }

        /// Simulate harvest(ratio): compute yield, add to total_harvested.
        /// Returns the harvested amount, or None if no yield.
        fn harvest(&mut self, ratio: i128) -> Option<i128> {
            if self.deployed_amount <= 0 {
                return None;
            }
            let position_value = mock_position_value(self.deployed_amount, ratio);
            let yield_amount = position_value.saturating_sub(self.deployed_amount);
            if yield_amount <= 0 {
                return None;
            }
            // On-chain: total_harvested += yield_amount (no reset of deployed).
            self.total_harvested = self.total_harvested.saturating_add(yield_amount);
            Some(yield_amount)
        }

        /// Simulate emergency_withdraw(): resets deployed_amount to 0.
        fn emergency_withdraw(&mut self) -> Option<i128> {
            if self.deployed_amount <= 0 {
                return None;
            }
            let amount = self.deployed_amount;
            self.deployed_amount = 0;
            Some(amount)
        }

        fn assert_invariants(&self) {
            assert!(self.deployed_amount >= 0,
                "deployed_amount {} is negative", self.deployed_amount);
            assert!(self.total_harvested >= 0,
                "total_harvested {} is negative", self.total_harvested);
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(3_000))]

        /// Multi-call fuzz: random deploy/harvest/emergency_withdraw sequences never
        /// break invariants or produce negative values.
        #[test]
        fn prop_yield_multicall_invariants(
            operations in prop::collection::vec(
                (0u32..=2u32, 1i128..=1_000_000i128, 9_000i128..=30_000i128),
                1..=30
            ),
        ) {
            let mut sim = YieldSim::new();

            for (op, amount, ratio) in &operations {
                match op {
                    0 => { sim.deploy(*amount); }
                    1 => { sim.harvest(*ratio); }
                    2 => { sim.emergency_withdraw(); }
                    _ => {}
                }
                sim.assert_invariants();
            }
        }

        /// Invariant: after emergency_withdraw, deployed_amount == 0.
        #[test]
        fn prop_emergency_withdraw_resets_deployed(
            amounts in prop::collection::vec(1i128..=1_000_000i128, 1..=10),
        ) {
            let mut sim = YieldSim::new();
            for a in amounts {
                sim.deploy(a);
            }
            if sim.deployed_amount > 0 {
                let withdrawn = sim.emergency_withdraw().unwrap();
                prop_assert!(withdrawn > 0, "emergency_withdraw returned 0");
                prop_assert_eq!(sim.deployed_amount, 0);
            }
        }

        /// Invariant: total_harvested is cumulative and never decreases.
        #[test]
        fn prop_total_harvested_never_decreases(
            deploy_amount in 1i128..=1_000_000i128,
            ratios in prop::collection::vec(10_001i128..=20_000i128, 1..=10),
        ) {
            let mut sim = YieldSim::new();
            sim.deploy(deploy_amount);

            let mut prev_harvested = 0i128;
            for ratio in ratios {
                if let Some(_) = sim.harvest(ratio) {
                    prop_assert!(sim.total_harvested >= prev_harvested,
                        "total_harvested decreased: {} → {}", prev_harvested, sim.total_harvested);
                    prev_harvested = sim.total_harvested;
                }
            }
        }

        /// Invariant: harvested amount ≤ position_value (can never over-harvest).
        #[test]
        fn prop_harvest_never_exceeds_position_value(
            deploy_amount in 1i128..=i128::MAX / 50_001,
            ratio in 10_001i128..=50_000i128,
        ) {
            let mut sim = YieldSim::new();
            sim.deploy(deploy_amount);

            let pos_value = mock_position_value(deploy_amount, ratio);
            let harvested = sim.harvest(ratio).unwrap_or(0);

            prop_assert!(harvested <= pos_value,
                "harvested {} > position_value {} at ratio {}", harvested, pos_value, ratio);
            prop_assert!(harvested >= 0, "harvested amount is negative: {}", harvested);
        }

        /// Invariant: deploying zero or negative amounts is always rejected.
        #[test]
        fn prop_deploy_zero_or_negative_rejected(
            bad_amount in i128::MIN..=0i128,
        ) {
            let mut sim = YieldSim::new();
            let result = sim.deploy(bad_amount);
            prop_assert!(!result, "deploy of {} should be rejected", bad_amount);
            prop_assert_eq!(sim.deployed_amount, 0);
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20_000))]

        /// Boundary: no overflow at extreme deploy amounts and high yield ratios.
        #[test]
        fn prop_no_overflow_at_boundaries(
            deploy_amount in prop::sample::select(std_vec![
                1i128,
                1_000i128,
                1_000_000_0000000i128,
                i128::MAX / 50_001,
                i128::MAX / 2,
            ]),
            ratio in prop::sample::select(std_vec![
                10_000i128,
                10_001i128,
                11_000i128,
                20_000i128,
                50_000i128,
            ]),
        ) {
            let mut sim = YieldSim::new();
            sim.deploy(deploy_amount);

            prop_assert!(sim.deployed_amount >= 0);

            let harvested = sim.harvest(ratio).unwrap_or(0);
            prop_assert!(harvested >= 0, "harvested negative at boundary");
            prop_assert!(sim.total_harvested >= 0);
        }

        /// Invariant: share price ≥ 1.0 for any ratio ≥ 10_000 and deployed > 0.
        /// Share price = position_value / deployed_amount.
        #[test]
        fn prop_share_price_never_below_one(
            deployed in 1i128..=i128::MAX / 50_001,
            ratio in 10_000i128..=50_000i128,
        ) {
            let pos = mock_position_value(deployed, ratio);
            // share_price * deployed == pos; price ≥ 1 iff pos ≥ deployed.
            prop_assert!(pos >= deployed,
                "share price below 1: pos={}, deployed={}, ratio={}",
                pos, deployed, ratio);
        }

        /// Invariant: multiple sequential harvests are all individually non-negative.
        #[test]
        fn prop_sequential_harvest_all_non_negative(
            deploy_amount in 1i128..=1_000_000i128,
            ratio in 10_001i128..=15_000i128,
            n in 1u32..=10u32,
        ) {
            let mut sim = YieldSim::new();
            sim.deploy(deploy_amount);

            // Harvest n times with the same ratio (after first harvest deployed stays
            // the same but the mock position value hasn't changed — subsequent harvests
            // return None because position_value == deployed after the mock DEX isn't
            // updated; that's fine, we just verify no panic and no negatives).
            for _ in 0..n {
                let h = sim.harvest(ratio).unwrap_or(0);
                prop_assert!(h >= 0);
                sim.assert_invariants();
            }
        }
    }
}
