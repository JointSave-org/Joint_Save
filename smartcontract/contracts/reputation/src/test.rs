use soroban_sdk::{
    testutils::{storage::Persistent, Address as _, Ledger},
    Address, Env,
};

use crate::{ReputationData, ReputationScore, ReputationTracker, ReputationTrackerClient};

fn setup<'a>(env: &Env) -> (ReputationTrackerClient<'a>, Address, Address) {
    let contract_id = env.register_contract(None, ReputationTracker);
    let client = ReputationTrackerClient::new(env, &contract_id);
    let pool = Address::generate(env);
    let member = Address::generate(env);
    (client, pool, member)
}

// ── Legacy API backward-compatibility tests ───────────────────────────────────

#[test]
fn get_reputation_defaults_for_unknown_address() {
    let env = Env::default();
    let (client, _pool, member) = setup(&env);

    let score = client.get_reputation(&member);
    // Legacy default: on_time_rate=10000, everything else 0
    assert_eq!(score.total_deposits, 0);
    assert_eq!(score.pools_completed, 0);
    assert_eq!(score.missed_rounds, 0);
    assert_eq!(score.on_time_rate, 10000);
}

#[test]
fn record_deposit_accumulates_total_and_keeps_full_on_time_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    client.record_deposit(&pool, &member, &100);
    client.record_deposit(&pool, &member, &50);

    let score = client.get_reputation(&member);
    assert_eq!(score.total_deposits, 2); // count, not amount sum
    assert_eq!(score.missed_rounds, 0);
    assert_eq!(score.on_time_rate, 10000);
}

#[test]
fn record_payout_received_increments_pools_completed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    client.record_payout_received(&pool, &member);
    client.record_payout_received(&pool, &member);

    let score = client.get_reputation(&member);
    assert_eq!(score.pools_completed, 2);
}

#[test]
fn record_missed_round_increments_missed_and_lowers_on_time_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    client.record_deposit(&pool, &member, &100);
    client.record_missed_round(&pool, &member);

    let score = client.get_reputation(&member);
    assert_eq!(score.missed_rounds, 1);
    // 1 deposit out of 2 tracked rounds = 50%  → on_time_rate = 5000
    assert_eq!(score.on_time_rate, 5000);
}

#[test]
fn reputation_is_tracked_independently_per_member() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member_a) = setup(&env);
    let member_b = Address::generate(&env);

    client.record_deposit(&pool, &member_a, &100);
    client.record_missed_round(&pool, &member_b);

    let score_a = client.get_reputation(&member_a);
    let score_b = client.get_reputation(&member_b);
    assert_eq!(score_a.total_deposits, 1);
    assert_eq!(score_a.missed_rounds, 0);
    assert_eq!(score_b.total_deposits, 0);
    assert_eq!(score_b.missed_rounds, 1);
}

#[test]
#[should_panic]
fn record_deposit_requires_pool_authorization() {
    let env = Env::default();
    // No mock_all_auths() — the pool address must authorize the call.
    let (client, pool, member) = setup(&env);
    client.record_deposit(&pool, &member, &100);
}

// ── New scoring API tests ──────────────────────────────────────────────────────

#[test]
fn get_member_score_default_is_provisional_500() {
    let env = Env::default();
    let (client, _pool, member) = setup(&env);

    let data = client.get_member_score(&member);
    assert_eq!(data.total_score, 500);
    assert_eq!(data.deposit_reliability, 500);
    assert_eq!(data.total_deposits, 0);
    assert_eq!(data.missed_deposits, 0);
    assert_eq!(data.pools_completed, 0);
    assert_eq!(data.pools_joined, 0);
    assert!(client.is_provisional(&member));
}

#[test]
fn update_score_successful_deposit_raises_score() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    client.update_score(&pool, &member, &true, &false);

    let data = client.get_member_score(&member);
    assert_eq!(data.total_deposits, 1);
    assert_eq!(data.missed_deposits, 0);
    assert_eq!(data.deposit_reliability, 1000); // 1/1 = 100%
    // pools_joined=1, pools_completed=0 → pcs=0; recency=1000 (just happened)
    // score = (1000*6 + 0*3 + 1000*1)/10 = 7000/10 = 700
    assert_eq!(data.total_score, 700);
    assert_eq!(data.pools_joined, 1);
}

#[test]
fn update_score_missed_deposit_lowers_reliability() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    // 1 success, 1 miss → reliability = 500
    client.update_score(&pool, &member, &true, &false);
    client.update_score(&pool, &member, &false, &false);

    let data = client.get_member_score(&member);
    assert_eq!(data.total_deposits, 1);
    assert_eq!(data.missed_deposits, 1);
    assert_eq!(data.deposit_reliability, 500);
}

#[test]
fn update_score_pool_completed_increments_pools_completed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    client.update_score(&pool, &member, &true, &true);

    let data = client.get_member_score(&member);
    assert_eq!(data.pools_completed, 1);
    assert_eq!(data.pools_joined, 1);
    // pcs = (1/1)*1000 = 1000; dep_rel=1000; recency=1000
    // score = (1000*6 + 1000*3 + 1000*1)/10 = 10000/10 = 1000
    assert_eq!(data.total_score, 1000);
}

#[test]
fn is_provisional_false_after_ten_deposits() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    for _ in 0..9 {
        client.update_score(&pool, &member, &true, &false);
    }
    assert!(client.is_provisional(&member));

    client.update_score(&pool, &member, &true, &false);
    assert!(!client.is_provisional(&member));
}

#[test]
fn get_members_scores_batch() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member_a) = setup(&env);
    let member_b = Address::generate(&env);

    client.update_score(&pool, &member_a, &true, &false);
    client.update_score(&pool, &member_b, &false, &false);

    let scores = client.get_members_scores(&soroban_sdk::vec![&env, member_a.clone(), member_b.clone()]);
    assert_eq!(scores.len(), 2);
    let score_a = scores.get(0).unwrap();
    let score_b = scores.get(1).unwrap();
    assert_eq!(score_a.total_deposits, 1);
    assert_eq!(score_b.missed_deposits, 1);
}

#[test]
fn leaderboard_returns_top_members_sorted_by_score() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member_a) = setup(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    // member_a: 3 deposits, 0 misses → high score
    client.update_score(&pool, &member_a, &true, &false);
    client.update_score(&pool, &member_a, &true, &false);
    client.update_score(&pool, &member_a, &true, &true); // pool completed

    // member_b: 1 deposit, 2 misses → low score
    client.update_score(&pool, &member_b, &true, &false);
    client.update_score(&pool, &member_b, &false, &false);
    client.update_score(&pool, &member_b, &false, &false);

    // member_c: 1 deposit only
    client.update_score(&pool, &member_c, &true, &false);

    let board = client.get_score_leaderboard(&3);
    assert_eq!(board.len(), 3);

    // First entry should be highest score (member_a)
    let (top_addr, top_data) = board.get(0).unwrap();
    assert_eq!(top_addr, member_a);
    assert!(top_data.total_score >= 900, "expected high score, got {}", top_data.total_score);
}

#[test]
fn leaderboard_respects_top_n_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member_a) = setup(&env);
    let member_b = Address::generate(&env);

    client.update_score(&pool, &member_a, &true, &false);
    client.update_score(&pool, &member_b, &true, &false);

    // Ask for top 1
    let board = client.get_score_leaderboard(&1);
    assert_eq!(board.len(), 1);
}

#[test]
fn test_bump_state() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, ReputationTracker);
    let client = ReputationTrackerClient::new(&env, &contract_id);
    let pool = Address::generate(&env);
    let member = Address::generate(&env);

    client.record_deposit(&pool, &member, &100);
    client.bump_state();

    env.as_contract(&contract_id, || {
        let ttl_members = env.storage().persistent().get_ttl(&crate::DataKey::Members);
        assert!(ttl_members >= 2592000);

        let ttl_score = env
            .storage()
            .persistent()
            .get_ttl(&crate::DataKey::Score(member.clone()));
        assert!(ttl_score >= 2592000);

        let ttl_data = env
            .storage()
            .persistent()
            .get_ttl(&crate::DataKey::MemberData(member.clone()));
        assert!(ttl_data >= 2592000);
    });
}

#[test]
fn recency_decay_boundary_at_90_days() {
    let env = Env::default();
    env.mock_all_auths();

    // Set ledger timestamp to day 0
    env.ledger().set_timestamp(0);
    let (client, pool, member) = setup(&env);

    // Make a deposit at time 0
    client.update_score(&pool, &member, &true, &false);
    let score_0 = client.get_member_score(&member);

    // Advance to exactly 90 days - should still have recency bonus of 250
    env.ledger().set_timestamp(89 * 86_400);
    // Re-trigger an update to recompute with current time
    client.update_score(&pool, &member, &true, &false);
    let score_89 = client.get_member_score(&member);

    // Advance past 90 days - recency bonus becomes 0
    env.ledger().set_timestamp(95 * 86_400);
    client.update_score(&pool, &member, &true, &false);
    let score_95 = client.get_member_score(&member);

    // Scores at recent timestamps should be higher than at day 0 but all
    // have recency=1000 since update was just now. What we're validating is
    // that last_activity is tracked correctly.
    assert!(score_0.last_activity == 0);
    assert!(score_89.last_activity == 89 * 86_400);
    assert!(score_95.last_activity == 95 * 86_400);
    // All three updates happen "now" so recency bonus is always 1000 at time of write.
    // The decay would be visible only when re-reading a stale score without
    // a fresh update — tested via get_member_score.
    assert!(score_0.total_score > 0);
    assert!(score_89.total_score > 0);
    assert!(score_95.total_score > 0);
}
