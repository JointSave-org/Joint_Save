use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, Env,
};

use jointsave_reputation::{ReputationTracker, ReputationTrackerClient};

use crate::{RotationalPool, RotationalPoolClient};

const DEPOSIT_AMOUNT: i128 = 100;
const ROUND_DURATION: u64 = 86_400;

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    (
        sac.address(),
        token::StellarAssetClient::new(env, &sac.address()),
    )
}

struct TestPool<'a> {
    pool: RotationalPoolClient<'a>,
    reputation: ReputationTrackerClient<'a>,
    member_a: Address,
    member_b: Address,
}

fn setup_pool<'a>(env: &Env) -> TestPool<'a> {
    let token_admin = Address::generate(env);
    let (token_id, sac) = create_token(env, &token_admin);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let member_a = Address::generate(env);
    let member_b = Address::generate(env);

    sac.mint(&member_a, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&member_b, &(DEPOSIT_AMOUNT * 10));

    let pool_id = env.register_contract(None, RotationalPool);
    let pool = RotationalPoolClient::new(env, &pool_id);
    pool.initialize(
        &token_id,
        &admin,
        &vec![&env, member_a.clone(), member_b.clone()],
        &DEPOSIT_AMOUNT,
        &ROUND_DURATION,
        &100,
        &50,
        &treasury,
    );

    let reputation_id = env.register_contract(None, ReputationTracker);
    let reputation = ReputationTrackerClient::new(env, &reputation_id);
    pool.set_reputation_tracker(&member_a, &reputation_id);

    TestPool {
        pool,
        reputation,
        member_a,
        member_b,
    }
}

#[test]
fn deposit_reports_to_reputation_tracker() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup_pool(&env);

    t.pool.deposit(&t.member_a);

    let score = t.reputation.get_reputation(&t.member_a);
    assert_eq!(score.total_deposits, DEPOSIT_AMOUNT);
    assert_eq!(score.missed_rounds, 0);
}

#[test]
fn trigger_payout_reports_completed_pool_for_beneficiary() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup_pool(&env);

    t.pool.deposit(&t.member_a);
    t.pool.deposit(&t.member_b);

    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    t.pool.trigger_payout(&t.member_a);

    // current_round 0 -> first member in the list is the beneficiary
    let score = t.reputation.get_reputation(&t.member_a);
    assert_eq!(score.pools_completed, 1);
}

#[test]
fn trigger_payout_reports_missed_round_for_non_depositors() {
    let env = Env::default();
    env.mock_all_auths();
    let t = setup_pool(&env);

    // Only member_a deposits this round; member_b misses it.
    t.pool.deposit(&t.member_a);

    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    t.pool.trigger_payout(&t.member_a);

    let score_b = t.reputation.get_reputation(&t.member_b);
    assert_eq!(score_b.missed_rounds, 1);

    let score_a = t.reputation.get_reputation(&t.member_a);
    assert_eq!(score_a.missed_rounds, 0);
}

#[test]
fn deposit_and_payout_work_without_a_reputation_tracker_configured() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, sac) = create_token(&env, &token_admin);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    sac.mint(&member_a, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&member_b, &(DEPOSIT_AMOUNT * 10));

    let pool_id = env.register_contract(None, RotationalPool);
    let pool = RotationalPoolClient::new(&env, &pool_id);
    pool.initialize(
        &token_id,
        &admin,
        &vec![&env, member_a.clone(), member_b.clone()],
        &DEPOSIT_AMOUNT,
        &ROUND_DURATION,
        &100,
        &50,
        &treasury,
    );

    // No set_reputation_tracker call — deposit/payout must still succeed.
    pool.deposit(&member_a);
    pool.deposit(&member_b);

    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    pool.trigger_payout(&member_a);

    assert_eq!(pool.current_round(), 1);
}
