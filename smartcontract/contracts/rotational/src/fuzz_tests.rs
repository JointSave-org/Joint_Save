// Property-based fuzz tests for JointSave contract arithmetic.
// Run with: cargo test prop_

#[cfg(test)]
mod prop_tests {
    use proptest::prelude::*;

    fn compute_fee_split(
        total_collected: i128,
        treasury_fee_bps: u32,
        relayer_fee_bps: u32,
    ) -> (i128, i128, i128) {
        let treasury_cut = (total_collected * treasury_fee_bps as i128) / 10_000;
        let relayer_cut = (total_collected * relayer_fee_bps as i128) / 10_000;
        let payout = total_collected - treasury_cut - relayer_cut;
        (treasury_cut, relayer_cut, payout)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        #[test]
        fn prop_fee_split_sums_to_total(
            total_collected in 1i128..=1_000_000_000_0000_000i128,
            treasury_fee_bps in 0u32..=5000u32,
            relayer_fee_bps in 0u32..=5000u32,
        ) {
            let combined_bps = treasury_fee_bps + relayer_fee_bps;
            let (t_bps, r_bps) = if combined_bps > 10_000 {
                let t = (treasury_fee_bps as u64 * 10_000 / combined_bps as u64) as u32;
                let r = (relayer_fee_bps as u64 * 10_000 / combined_bps as u64) as u32;
                (t, r)
            } else {
                (treasury_fee_bps, relayer_fee_bps)
            };
            let (treasury_cut, relayer_cut, payout) =
                compute_fee_split(total_collected, t_bps, r_bps);
            let sum = treasury_cut + relayer_cut + payout;
            prop_assert!(
                sum == total_collected,
                "Fee split does not sum to total: sum={}, total={}, t_bps={}, r_bps={}, treasury_cut={}, relayer_cut={}, payout={}",
                sum, total_collected, t_bps, r_bps, treasury_cut, relayer_cut, payout
            );
            prop_assert!(treasury_cut >= 0, "treasury_cut negative: {}", treasury_cut);
            prop_assert!(relayer_cut >= 0, "relayer_cut negative: {}", relayer_cut);
            prop_assert!(payout >= 0, "payout negative: {}", payout);
        }

        #[test]
        fn prop_zero_fees_full_payout(
            total_collected in 1i128..=1_000_000_000_0000_000i128,
        ) {
            let (treasury_cut, relayer_cut, payout) = compute_fee_split(total_collected, 0, 0);
            prop_assert!(treasury_cut == 0);
            prop_assert!(relayer_cut == 0);
            prop_assert!(payout == total_collected);
        }

        #[test]
        fn prop_max_fees_sum_holds(
            total_collected in 1i128..=1_000_000_000_0000_000i128,
            treasury_fee_bps in 0u32..=10_000u32,
        ) {
            let relayer_fee_bps = 10_000 - treasury_fee_bps;
            let (treasury_cut, relayer_cut, payout) =
                compute_fee_split(total_collected, treasury_fee_bps, relayer_fee_bps);
            prop_assert!(payout >= 0, "payout negative at 100% fees: {}", payout);
            let sum = treasury_cut + relayer_cut + payout;
            prop_assert!(
                sum == total_collected,
                "Sum broken at 100% fees: sum={}, total={}",
                sum, total_collected
            );
        }
    }

    fn simulate_remove_member(
        member_count: u32,
        current_round: u32,
        removed_index: u32,
    ) -> (u32, bool) {
        assert!(member_count >= 1);
        assert!(current_round < member_count);
        assert!(removed_index < member_count);
        let updated_len = member_count - 1;
        let pool_completed;
        let updated_round = if removed_index < current_round {
            pool_completed = false;
            current_round - 1
        } else if removed_index == current_round && current_round >= updated_len {
            pool_completed = true;
            0
        } else {
            pool_completed = false;
            current_round
        };
        (updated_round, pool_completed)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(10_000))]

        #[test]
        fn prop_remove_member_round_validity(
            member_count in 2u32..=50u32,
            current_round_offset in 0u32..50u32,
            removed_index_offset in 0u32..50u32,
        ) {
            let current_round = current_round_offset % member_count;
            let removed_index = removed_index_offset % member_count;
            let updated_len = member_count - 1;
            let (updated_round, pool_completed) =
                simulate_remove_member(member_count, current_round, removed_index);
            if pool_completed {
                prop_assert!(
                    updated_len == 0 || current_round >= updated_len,
                    "pool_completed=true but round {} < updated_len {}",
                    current_round, updated_len
                );
            } else {
                prop_assert!(
                    updated_round < updated_len,
                    "updated_round {} out of range for updated_len {}",
                    updated_round, updated_len
                );
            }
        }

        #[test]
        fn prop_remove_future_member_preserves_round(
            member_count in 2u32..=50u32,
            current_round_offset in 0u32..50u32,
        ) {
            let current_round = current_round_offset % member_count;
            if current_round + 1 < member_count {
                let gap = member_count - current_round - 1;
                let removed_index = (current_round + 1 + (current_round_offset % gap)).min(member_count - 1);
                let (updated_round, pool_completed) =
                    simulate_remove_member(member_count, current_round, removed_index);
                if !pool_completed {
                    prop_assert!(
                        updated_round == current_round,
                        "removing future member changed round: {} -> {}",
                        current_round, updated_round
                    );
                }
            }
        }

        #[test]
        fn prop_remove_past_member_decrements_round(
            member_count in 2u32..=50u32,
            current_round_offset in 1u32..50u32,
        ) {
            let current_round = (current_round_offset % (member_count - 1)) + 1;
            let removed_index = current_round_offset % current_round;
            let (updated_round, pool_completed) =
                simulate_remove_member(member_count, current_round, removed_index);
            prop_assert!(!pool_completed, "removing past member completed pool unexpectedly");
            prop_assert!(
                updated_round == current_round - 1,
                "removing past member did not decrement round: {} -> {}",
                current_round, updated_round
            );
        }
    }

    fn simulate_deposits(target_amount: i128, deposits: &[i128]) -> (i128, bool) {
        let mut total_deposited: i128 = 0;
        let mut unlocked = false;
        for &amount in deposits {
            if amount <= 0 {
                continue;
            }
            total_deposited += amount;
            if total_deposited >= target_amount {
                unlocked = true;
            }
        }
        (total_deposited, unlocked)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(5_000))]

        #[test]
        fn prop_deposit_sum_exact(
            target_amount in 1i128..=1_000_000_000i128,
            deposits in prop::collection::vec(1i128..=100_000_000i128, 1..=20),
        ) {
            let expected_total: i128 = deposits.iter().sum();
            let (total_deposited, unlocked) = simulate_deposits(target_amount, &deposits);
            prop_assert!(
                total_deposited == expected_total,
                "total_deposited mismatch: got {}, expected {}",
                total_deposited, expected_total
            );
            let should_unlock = expected_total >= target_amount;
            prop_assert!(
                unlocked == should_unlock,
                "unlocked={} but total={}, target={}",
                unlocked, expected_total, target_amount
            );
        }

        #[test]
        fn prop_deposit_no_overcounting(
            target_amount in 1i128..=1_000_000_000i128,
            deposits in prop::collection::vec(1i128..=100_000_000i128, 1..=20),
        ) {
            let sum: i128 = deposits.iter().sum();
            let (total_deposited, _) = simulate_deposits(target_amount, &deposits);
            prop_assert!(total_deposited <= sum, "overcounting: {} > {}", total_deposited, sum);
            prop_assert!(total_deposited >= 0, "negative total: {}", total_deposited);
        }

        #[test]
        fn prop_unlock_is_sticky(
            target_amount in 1i128..=1_000_000_000i128,
            initial_deposits in prop::collection::vec(1i128..=100_000_000i128, 1..=10),
            extra_deposits in prop::collection::vec(1i128..=100_000_000i128, 1..=10),
        ) {
            let (_, unlocked_before) = simulate_deposits(target_amount, &initial_deposits);
            if unlocked_before {
                let mut all = initial_deposits.clone();
                all.extend_from_slice(&extra_deposits);
                let (_, unlocked_after) = simulate_deposits(target_amount, &all);
                prop_assert!(unlocked_after, "pool became locked again after more deposits");
            }
        }
    }
}
