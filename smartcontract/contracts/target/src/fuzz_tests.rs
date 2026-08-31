//! Property-based fuzz / invariant tests for JointSave Target Pool Contract.
//!
//! Covers:
//!   - Aggregate balance reconciliation: sum of member balances == TotalDeposited
//!   - Unlock is sticky: once target is reached the pool stays unlocked
//!   - Unlock cannot happen before target is met
//!   - Withdrawal capped by member balance; no funds created or destroyed
//!   - Refund path: total refunded == total deposited, zero remaining
//!   - Deadline semantics: deposits rejected after deadline
//!   - Multi-call fuzz: random deposit/withdraw/refund sequences never panic
//!   - Boundary/overflow: target_amount, deposits at 0, 1, i128::MAX/2
//!
//! Run with:
//!   cargo test prop_ --manifest-path=contracts/target/Cargo.toml \
//!         --release -- --nocapture

#[cfg(test)]
mod prop_tests {
    use proptest::prelude::*;

    extern crate std;
    use std::vec::Vec as StdVec;
    use std::vec;

    // ── Pure simulation ───────────────────────────────────────────────────────
    //
    // Uses Vec<(id, balance)> instead of HashMap to stay compatible with
    // the no_std crate root (test binaries still link std, but we avoid
    // direct std::collections imports to keep the code self-contained).

    struct TargetSim {
        /// (member_id, balance) pairs
        balances: StdVec<(u32, i128)>,
        total_deposited: i128,
        target_amount: i128,
        deadline: u32,
        current_sequence: u32,
        unlocked: bool,
        active: bool,
        /// The total_deposited value at the moment the pool became unlocked.
        /// Used by check_unlock_threshold to avoid a false positive: once
        /// members withdraw, total_deposited may legally fall below target_amount
        /// while unlocked == true.
        unlocked_at_total: i128,
    }

    impl TargetSim {
        fn new(members: StdVec<u32>, target_amount: i128, deadline: u32) -> Self {
            let balances = members.iter().map(|&id| (id, 0i128)).collect();
            TargetSim {
                balances,
                total_deposited: 0,
                target_amount,
                deadline,
                current_sequence: 0,
                unlocked: false,
                active: true,
                unlocked_at_total: 0,
            }
        }

        fn get_balance(&self, member: u32) -> Option<i128> {
            self.balances.iter().find(|&&(id, _)| id == member).map(|&(_, b)| b)
        }

        fn set_balance(&mut self, member: u32, val: i128) {
            if let Some(entry) = self.balances.iter_mut().find(|(id, _)| *id == member) {
                entry.1 = val;
            }
        }

        fn advance_ledger(&mut self, steps: u32) {
            self.current_sequence = self.current_sequence.saturating_add(steps);
        }

        fn deposit(&mut self, member: u32, amount: i128) -> Result<i128, &'static str> {
            if !self.active { return Err("pool inactive"); }
            if self.unlocked { return Err("pool already unlocked"); }
            if self.get_balance(member).is_none() { return Err("not a member"); }
            if amount <= 0 { return Err("amount must be > 0"); }
            if self.current_sequence > self.deadline { return Err("deadline passed"); }

            let prev = self.get_balance(member).unwrap();
            self.set_balance(member, prev + amount);
            self.total_deposited += amount;

            if self.total_deposited >= self.target_amount {
                self.unlocked = true;
                // Record how much was in the pool at the unlock moment.
                self.unlocked_at_total = self.total_deposited;
            }

            Ok(self.total_deposited)
        }

        fn withdraw(&mut self, member: u32) -> Result<i128, &'static str> {
            if !self.unlocked { return Err("target not reached yet"); }
            let balance = self.get_balance(member).unwrap_or(0);
            if balance <= 0 { return Err("nothing to withdraw"); }
            self.set_balance(member, 0);
            self.total_deposited -= balance;
            Ok(balance)
        }

        fn refund(&mut self) -> Result<StdVec<(u32, i128)>, &'static str> {
            if self.unlocked { return Err("target reached, use withdraw"); }
            if self.current_sequence <= self.deadline { return Err("deadline not passed"); }

            let mut refunds = StdVec::new();
            for entry in self.balances.iter_mut() {
                if entry.1 > 0 {
                    refunds.push((entry.0, entry.1));
                    entry.1 = 0;
                }
            }
            self.total_deposited = 0;
            self.active = false;
            Ok(refunds)
        }

        fn check_reconciliation(&self) -> Result<(), &'static str> {
            let sum: i128 = self.balances.iter().map(|&(_, b)| b).sum();
            if sum != self.total_deposited {
                return Err("reconciliation broken: sum != total_deposited");
            }
            Ok(())
        }

        fn check_no_negatives(&self) -> Result<(), &'static str> {
            for &(_id, bal) in &self.balances {
                if bal < 0 {
                    return Err("negative member balance");
                }
            }
            if self.total_deposited < 0 {
                return Err("total_deposited is negative");
            }
            Ok(())
        }

        fn check_unlock_sticky(&self, was_unlocked: bool) -> Result<(), &'static str> {
            if was_unlocked && !self.unlocked {
                return Err("pool became locked again after being unlocked");
            }
            Ok(())
        }

        fn check_unlock_threshold(&self) -> Result<(), &'static str> {
            // The pool must not have entered the unlocked state unless total_deposited
            // was ≥ target_amount at the time of unlock.  Note: after valid withdrawals
            // total_deposited may legally fall below target_amount while unlocked==true,
            // so we compare against the snapshotted unlocked_at_total rather than the
            // current total_deposited.
            if self.unlocked && self.unlocked_at_total < self.target_amount {
                return Err("pool unlocked before target was met");
            }
            Ok(())
        }
    }

    // ── Invariant tests ───────────────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(5_000))]

        /// Multi-call fuzz: random deposit/withdraw sequences never violate invariants.
        #[test]
        fn prop_target_multicall_invariants(
            target_amount in 10i128..=1_000_000i128,
            deadline in 50u32..=200u32,
            member_count in 2u32..=8u32,
            operations in prop::collection::vec(
                (0u32..=3u32, 0u32..=7u32, 1i128..=50_000i128),
                1..=40
            ),
        ) {
            let members: StdVec<u32> = (0..member_count).collect();
            let mut sim = TargetSim::new(members, target_amount, deadline);

            for (op, member_offset, amount) in operations {
                let member = member_offset % member_count;
                let was_unlocked = sim.unlocked;

                match op {
                    0 => { let _ = sim.deposit(member, amount); }
                    1 => { let _ = sim.withdraw(member); }
                    2 => { sim.advance_ledger(amount as u32 % 20); }
                    3 => { let _ = sim.refund(); }
                    _ => {}
                }

                sim.check_reconciliation().map_err(|e| TestCaseError::fail(e))?;
                sim.check_no_negatives().map_err(|e| TestCaseError::fail(e))?;
                sim.check_unlock_sticky(was_unlocked).map_err(|e| TestCaseError::fail(e))?;
                sim.check_unlock_threshold().map_err(|e| TestCaseError::fail(e))?;
            }
        }

        /// Invariant: deposit exactly at target unlocks pool.
        #[test]
        fn prop_exact_target_unlocks(
            target in 1i128..=1_000_000i128,
            split_count in 1u32..=10u32,
        ) {
            let member_count = split_count.max(2);
            let members: StdVec<u32> = (0..member_count).collect();
            let mut sim = TargetSim::new(members, target, 1000);
            prop_assert!(!sim.unlocked);

            let per_member = target / split_count as i128;
            let remainder = target - per_member * split_count as i128;

            for id in 0..split_count {
                let _ = sim.deposit(id, per_member);
            }
            if remainder > 0 {
                let _ = sim.deposit(0, remainder);
            }

            prop_assert!(
                sim.total_deposited >= target,
                "total {} < target {}",
                sim.total_deposited, target
            );
            prop_assert!(sim.unlocked, "pool not unlocked after reaching target");
        }

        /// Invariant: unlock is sticky — further actions do not re-lock.
        #[test]
        fn prop_unlock_sticky_after_target(
            target in 1i128..=100_000i128,
            extra_deposits in prop::collection::vec(1i128..=10_000i128, 0..=10),
        ) {
            let mut sim = TargetSim::new(vec![0, 1], target, 1000);
            let _ = sim.deposit(0, target);

            if sim.unlocked {
                for extra in extra_deposits {
                    let result = sim.deposit(1, extra);
                    prop_assert!(result.is_err(), "unlocked pool accepted deposit");
                    prop_assert!(sim.unlocked, "pool became locked after extra deposit");
                }
            }
        }

        /// Invariant: deposits after deadline are rejected, balances unchanged.
        #[test]
        fn prop_deposit_rejected_after_deadline(
            target in 100i128..=1_000_000i128,
            deadline in 10u32..=50u32,
        ) {
            let mut sim = TargetSim::new(vec![0, 1], target, deadline);
            sim.advance_ledger(deadline + 1);

            let balance_before = sim.get_balance(0).unwrap();
            let total_before = sim.total_deposited;

            let result = sim.deposit(0, 1);

            prop_assert!(result.is_err(), "deposit should be rejected after deadline");
            prop_assert_eq!(sim.get_balance(0).unwrap(), balance_before);
            prop_assert_eq!(sim.total_deposited, total_before);
        }

        /// Invariant: after refund, sum of refunded amounts == total that was deposited.
        #[test]
        fn prop_refund_sum_equals_deposited(
            target in 1_000i128..=100_000i128,
            member_count in 2u32..=8u32,
            deposits in prop::collection::vec(1i128..=500i128, 2..=16),
        ) {
            let members: StdVec<u32> = (0..member_count).collect();
            let deadline = 100u32;
            let mut sim = TargetSim::new(members, target, deadline);

            for (i, &amount) in deposits.iter().enumerate() {
                let member = (i as u32) % member_count;
                let _ = sim.deposit(member, amount);
                if sim.unlocked { break; }
            }

            if !sim.unlocked {
                let recorded_total = sim.total_deposited;
                sim.advance_ledger(deadline + 1);
                let result = sim.refund();
                prop_assert!(result.is_ok(), "refund should succeed");
                let refunds = result.unwrap();
                let refund_sum: i128 = refunds.iter().map(|&(_, b)| b).sum();
                prop_assert_eq!(
                    refund_sum, recorded_total,
                    "refund sum {} != deposited total {}",
                    refund_sum, recorded_total
                );
                prop_assert_eq!(sim.total_deposited, 0);
            }
        }
    }

    // ── Boundary / overflow tests ─────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20_000))]

        /// Boundary: deposit of 1 stroop into a target of 1 unlocks immediately.
        #[test]
        fn prop_single_stroop_target(_unit in 1i128..=1i128) {
            let mut sim = TargetSim::new(vec![0, 1], 1, 100);
            let _ = sim.deposit(0, 1);
            prop_assert!(sim.unlocked);
            prop_assert_eq!(sim.total_deposited, 1);
            sim.check_reconciliation().map_err(|e| TestCaseError::fail(e))?;
        }

        /// Boundary: zero-amount deposit is always rejected.
        #[test]
        fn prop_zero_amount_rejected(target in 1i128..=100_000i128) {
            let mut sim = TargetSim::new(vec![0, 1], target, 100);
            let result = sim.deposit(0, 0);
            prop_assert!(result.is_err(), "zero amount deposit should be rejected");
            prop_assert_eq!(sim.total_deposited, 0);
        }

        /// Boundary: negative-amount deposit is always rejected.
        #[test]
        fn prop_negative_amount_rejected(
            target in 1i128..=100_000i128,
            negative_amount in i128::MIN..=-1i128,
        ) {
            let mut sim = TargetSim::new(vec![0, 1], target, 100);
            let result = sim.deposit(0, negative_amount);
            prop_assert!(result.is_err(), "negative amount deposit should be rejected");
            prop_assert_eq!(sim.total_deposited, 0);
        }

        /// Boundary: large amounts don't overflow total_deposited.
        #[test]
        fn prop_large_amounts_no_overflow(
            target in prop::sample::select(vec![i128::MAX / 4, i128::MAX / 2]),
            deposit in prop::sample::select(vec![1i128, i128::MAX / 8, i128::MAX / 4]),
        ) {
            let mut sim = TargetSim::new(vec![0, 1], target, 1000);
            let result = sim.deposit(0, deposit);
            match result {
                Ok(new_total) => {
                    prop_assert!(new_total >= deposit);
                    prop_assert!(new_total >= 0);
                }
                Err(_) => {}
            }
            prop_assert!(sim.total_deposited >= 0);
        }
    }
}
