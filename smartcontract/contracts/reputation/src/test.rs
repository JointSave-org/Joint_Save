use soroban_sdk::{testutils::{Address as _, storage::Persistent}, Address, Env};

use crate::{ReputationScore, ReputationTracker, ReputationTrackerClient};

fn setup<'a>(env: &Env) -> (ReputationTrackerClient<'a>, Address, Address) {
    let contract_id = env.register_contract(None, ReputationTracker);
    let client = ReputationTrackerClient::new(env, &contract_id);
    let pool = Address::generate(env);
    let member = Address::generate(env);
    (client, pool, member)
}

#[test]
fn get_reputation_defaults_for_unknown_address() {
    let env = Env::default();
    let (client, _pool, member) = setup(&env);

    let score = client.get_reputation(&member);
    assert_eq!(
        score,
        ReputationScore {
            total_deposits: 0,
            pools_completed: 0,
            missed_rounds: 0,
            on_time_rate: 10000,
        }
    );
}

#[test]
fn record_deposit_accumulates_total_and_keeps_full_on_time_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, pool, member) = setup(&env);

    client.record_deposit(&pool, &member, &100);
    client.record_deposit(&pool, &member, &50);

    let score = client.get_reputation(&member);
    assert_eq!(score.total_deposits, 150);
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
    // 1 deposit out of 2 tracked rounds = 50%
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
    assert_eq!(score_a.total_deposits, 100);
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

#[test]
fn test_bump_state() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, ReputationTracker);
    let client = ReputationTrackerClient::new(&env, &contract_id);
    let pool = Address::generate(&env);
    let member = Address::generate(&env);

    client.record_deposit(&pool, &member, &100);

    // Call bump_state
    client.bump_state();

    // Verify key TTLs were extended
    env.as_contract(&contract_id, || {
        let ttl_members = env.storage().persistent().get_ttl(&crate::DataKey::Members);
        assert!(ttl_members >= 2592000);

        let ttl_score = env.storage().persistent().get_ttl(&crate::DataKey::Score(member.clone()));
        assert!(ttl_score >= 2592000);

        let ttl_deposits = env.storage().persistent().get_ttl(&crate::DataKey::DepositsMade(member.clone()));
        assert!(ttl_deposits >= 2592000);

        let ttl_rounds = env.storage().persistent().get_ttl(&crate::DataKey::RoundsTracked(member.clone()));
        assert!(ttl_rounds >= 2592000);
    });
}

