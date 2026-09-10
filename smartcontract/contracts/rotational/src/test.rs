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

// ── P3c: multi-round beneficiary rotation + relayer auth binding ──────────────

#[test]
fn test_beneficiary_rotation_across_full_lifecycle() {
    // 3 members, 3 rounds: verify each round pays the correct rotating
    // beneficiary with the right treasury/relayer cut.
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, sac) = create_token(&env, &token_admin);
    let ti = token::Client::new(&env, &token_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let relayer = Address::generate(&env);
    let m_a = Address::generate(&env);
    let m_b = Address::generate(&env);
    let m_c = Address::generate(&env);

    let pool_id = env.register_contract(None, RotationalPool);
    let pool = RotationalPoolClient::new(&env, &pool_id);

    // 10% treasury, 5% relayer
    pool.initialize(
        &token_id,
        &admin,
        &vec![&env, m_a.clone(), m_b.clone(), m_c.clone()],
        &DEPOSIT_AMOUNT,
        &ROUND_DURATION,
        &1000u32,
        &500u32,
        &treasury,
    );

    sac.mint(&m_a, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&m_b, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&m_c, &(DEPOSIT_AMOUNT * 10));

    // Round 0 — beneficiary is members[0] = m_a
    pool.deposit(&m_a);
    pool.deposit(&m_b);
    pool.deposit(&m_c);
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    pool.trigger_payout(&relayer);

    let pot = DEPOSIT_AMOUNT * 3; // 300
    let treas_cut = pot * 10 / 100; // 30
    let relay_cut = pot * 5 / 100; // 15
    let payout = pot - treas_cut - relay_cut; // 255
                                              // m_a: 1000 - 100 + 255 = 1155
    assert_eq!(ti.balance(&m_a), 1155);
    assert_eq!(ti.balance(&m_b), 900);
    assert_eq!(ti.balance(&m_c), 900);
    assert_eq!(ti.balance(&treasury), treas_cut);
    assert_eq!(ti.balance(&relayer), relay_cut);
    assert_eq!(pool.current_round(), 1);

    // Round 1 — beneficiary is members[1] = m_b
    pool.deposit(&m_a);
    pool.deposit(&m_b);
    pool.deposit(&m_c);
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    pool.trigger_payout(&relayer);

    // m_a: 1155 - 100 = 1055, m_b: 900 - 100 + 255 = 1055, m_c: 900 - 100 = 800
    assert_eq!(ti.balance(&m_a), 1055);
    assert_eq!(ti.balance(&m_b), 1055);
    assert_eq!(ti.balance(&m_c), 800);
    assert_eq!(ti.balance(&treasury), treas_cut * 2);
    assert_eq!(ti.balance(&relayer), relay_cut * 2);
    assert_eq!(pool.current_round(), 2);

    // Round 2 — beneficiary is members[2] = m_c, final round
    pool.deposit(&m_a);
    pool.deposit(&m_b);
    pool.deposit(&m_c);
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    pool.trigger_payout(&relayer);

    // m_a: 1055 - 100 = 955, m_b: 1055 - 100 = 955, m_c: 800 - 100 + 255 = 955
    assert_eq!(ti.balance(&m_a), 955);
    assert_eq!(ti.balance(&m_b), 955);
    assert_eq!(ti.balance(&m_c), 955);
    assert_eq!(ti.balance(&treasury), treas_cut * 3);
    assert_eq!(ti.balance(&relayer), relay_cut * 3);
    assert!(!pool.is_active());
}

#[test]
fn test_different_relayers_receive_cut_per_round() {
    // Two different relayers trigger round 0 and round 1 — each receives
    // exactly their own round's relayer cut.
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, sac) = create_token(&env, &token_admin);
    let ti = token::Client::new(&env, &token_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let r_x = Address::generate(&env);
    let r_y = Address::generate(&env);
    let m_a = Address::generate(&env);
    let m_b = Address::generate(&env);

    let pool_id = env.register_contract(None, RotationalPool);
    let pool = RotationalPoolClient::new(&env, &pool_id);

    // 20% treasury, 10% relayer
    pool.initialize(
        &token_id,
        &admin,
        &vec![&env, m_a.clone(), m_b.clone()],
        &DEPOSIT_AMOUNT,
        &ROUND_DURATION,
        &2000u32,
        &1000u32,
        &treasury,
    );

    sac.mint(&m_a, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&m_b, &(DEPOSIT_AMOUNT * 10));

    // Round 0 — r_x triggers, m_a is beneficiary
    pool.deposit(&m_a);
    pool.deposit(&m_b);
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    pool.trigger_payout(&r_x);

    let pot = DEPOSIT_AMOUNT * 2; // 200
    let treas_cut = pot * 20 / 100; // 40
    let relay_cut = pot * 10 / 100; // 20
    let payout = pot - treas_cut - relay_cut; // 140

    // m_a: 1000 - 100 + 140 = 1040, m_b: 1000 - 100 = 900
    assert_eq!(ti.balance(&m_a), 1040);
    assert_eq!(ti.balance(&m_b), 900);
    assert_eq!(ti.balance(&r_x), relay_cut);
    assert_eq!(ti.balance(&r_y), 0);
    assert_eq!(ti.balance(&treasury), treas_cut);

    // Round 1 — r_y triggers, m_b is beneficiary
    pool.deposit(&m_a);
    pool.deposit(&m_b);
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    pool.trigger_payout(&r_y);

    // m_a: 1040 - 100 = 940, m_b: 900 - 100 + 140 = 940
    assert_eq!(ti.balance(&m_a), 940);
    assert_eq!(ti.balance(&m_b), 940);
    assert_eq!(ti.balance(&r_x), relay_cut); // unchanged
    assert_eq!(ti.balance(&r_y), relay_cut); // now has its cut
    assert_eq!(ti.balance(&treasury), treas_cut * 2);
    assert!(!pool.is_active());
}

#[test]
#[should_panic(expected = "too early")]
fn test_payout_not_possible_before_round_duration() {
    // Pin: premature payout is still rejected even when all members deposit
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, sac) = create_token(&env, &token_admin);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let relayer = Address::generate(&env);
    let m_a = Address::generate(&env);
    let m_b = Address::generate(&env);

    let pool_id = env.register_contract(None, RotationalPool);
    let pool = RotationalPoolClient::new(&env, &pool_id);
    pool.initialize(
        &token_id,
        &admin,
        &vec![&env, m_a.clone(), m_b.clone()],
        &DEPOSIT_AMOUNT,
        &ROUND_DURATION,
        &0u32,
        &0u32,
        &treasury,
    );

    sac.mint(&m_a, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&m_b, &(DEPOSIT_AMOUNT * 10));
    pool.deposit(&m_a);
    pool.deposit(&m_b);

    // Do NOT advance time — trigger must fail
    pool.trigger_payout(&relayer);
}

#[test]
#[should_panic(expected = "no deposits this round")]
fn test_payout_rejected_when_nobody_deposited() {
    // Pin: advancing time alone does not enable payout; deposit is mandatory.
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, sac) = create_token(&env, &token_admin);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let relayer = Address::generate(&env);
    let m_a = Address::generate(&env);
    let m_b = Address::generate(&env);

    let pool_id = env.register_contract(None, RotationalPool);
    let pool = RotationalPoolClient::new(&env, &pool_id);
    pool.initialize(
        &token_id,
        &admin,
        &vec![&env, m_a.clone(), m_b.clone()],
        &DEPOSIT_AMOUNT,
        &ROUND_DURATION,
        &0u32,
        &0u32,
        &treasury,
    );

    sac.mint(&m_a, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&m_b, &(DEPOSIT_AMOUNT * 10));
    // No deposit, just advance time
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);
    pool.trigger_payout(&relayer);
}

#[test]
#[should_panic]
fn test_trigger_payout_rejects_non_authorized_relayer() {
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    let env = Env::default();
    // NO mock_all_auths — real auth binding

    let token_admin = Address::generate(&env);
    let (token_id, sac) = create_token(&env, &token_admin);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let relayer_a = Address::generate(&env);
    let relayer_b = Address::generate(&env);
    let m_a = Address::generate(&env);
    let m_b = Address::generate(&env);

    let pool_id = env.register_contract(None, RotationalPool);
    let pool = RotationalPoolClient::new(&env, &pool_id);
    pool.initialize(
        &token_id,
        &admin,
        &vec![&env, m_a.clone(), m_b.clone()],
        &DEPOSIT_AMOUNT,
        &ROUND_DURATION,
        &0u32,
        &0u32,
        &treasury,
    );

    sac.mint(&m_a, &(DEPOSIT_AMOUNT * 10));
    sac.mint(&m_b, &(DEPOSIT_AMOUNT * 10));

    // Authorize both members' deposits (including the inner token transfer)
    let deposit_args_a: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::vec![&env, m_a.clone().into_val(&env)];
    let transfer_args_a: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![
        &env,
        m_a.clone().into_val(&env),
        pool_id.clone().into_val(&env),
        (DEPOSIT_AMOUNT as i128).into_val(&env)
    ];
    let deposit_args_b: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::vec![&env, m_b.clone().into_val(&env)];
    let transfer_args_b: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![
        &env,
        m_b.clone().into_val(&env),
        pool_id.clone().into_val(&env),
        (DEPOSIT_AMOUNT as i128).into_val(&env)
    ];

    // Authorize relayer_a to call trigger_payout
    let payout_args: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::vec![&env, relayer_a.clone().into_val(&env)];

    env.set_auths(&[
        MockAuth {
            address: &m_a,
            invoke: &MockAuthInvoke {
                contract: &pool_id,
                fn_name: "deposit",
                args: deposit_args_a,
                sub_invokes: &[MockAuthInvoke {
                    contract: &token_id,
                    fn_name: "transfer",
                    args: transfer_args_a,
                    sub_invokes: &[],
                }],
            },
        }
        .into(),
        MockAuth {
            address: &m_b,
            invoke: &MockAuthInvoke {
                contract: &pool_id,
                fn_name: "deposit",
                args: deposit_args_b,
                sub_invokes: &[MockAuthInvoke {
                    contract: &token_id,
                    fn_name: "transfer",
                    args: transfer_args_b,
                    sub_invokes: &[],
                }],
            },
        }
        .into(),
        MockAuth {
            address: &relayer_a,
            invoke: &MockAuthInvoke {
                contract: &pool_id,
                fn_name: "trigger_payout",
                args: payout_args,
                sub_invokes: &[],
            },
        }
        .into(),
    ]);

    pool.deposit(&m_a);
    pool.deposit(&m_b);
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);

    // relayer_a is authorized — this succeeds
    pool.trigger_payout(&relayer_a);
    assert_eq!(pool.current_round(), 1);

    // Advance time for round 1
    env.ledger().with_mut(|li| li.timestamp += ROUND_DURATION);

    // Re-authorize deposits for round 1, but deliberately do NOT include
    // relayer_b in the auth tree — trigger_payout must panic.
    let deposit_args_a2: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::vec![&env, m_a.clone().into_val(&env)];
    let transfer_args_a2: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![
        &env,
        m_a.clone().into_val(&env),
        pool_id.clone().into_val(&env),
        (DEPOSIT_AMOUNT as i128).into_val(&env)
    ];
    let deposit_args_b2: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::vec![&env, m_b.clone().into_val(&env)];
    let transfer_args_b2: soroban_sdk::Vec<soroban_sdk::Val> = soroban_sdk::vec![
        &env,
        m_b.clone().into_val(&env),
        pool_id.clone().into_val(&env),
        (DEPOSIT_AMOUNT as i128).into_val(&env)
    ];

    env.set_auths(&[
        MockAuth {
            address: &m_a,
            invoke: &MockAuthInvoke {
                contract: &pool_id,
                fn_name: "deposit",
                args: deposit_args_a2,
                sub_invokes: &[MockAuthInvoke {
                    contract: &token_id,
                    fn_name: "transfer",
                    args: transfer_args_a2,
                    sub_invokes: &[],
                }],
            },
        }
        .into(),
        MockAuth {
            address: &m_b,
            invoke: &MockAuthInvoke {
                contract: &pool_id,
                fn_name: "deposit",
                args: deposit_args_b2,
                sub_invokes: &[MockAuthInvoke {
                    contract: &token_id,
                    fn_name: "transfer",
                    args: transfer_args_b2,
                    sub_invokes: &[],
                }],
            },
        }
        .into(),
        // relayer_b is NOT authorized for trigger_payout
    ]);

    pool.deposit(&m_a);
    pool.deposit(&m_b);

    // relayer_b is not in the auth tree — this must panic
    pool.trigger_payout(&relayer_b);
}
