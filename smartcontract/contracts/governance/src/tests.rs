extern crate std;

use super::{Governance, GovernanceClient, ProposalStatus, ProposalType};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, testutils::Address as _,
    testutils::Ledger as _, vec, Address, Bytes, BytesN, Env, Map, String, Symbol, Vec,
};

const DAY_SECS: u64 = 48 * 60 * 60;

#[contract]
struct TestPool;

#[contractimpl]
impl TestPool {
    pub fn initialize(env: Env, members: Vec<Address>) {
        env.storage()
            .persistent()
            .set(&DataKeyTest::Members, &members);
    }

    pub fn members(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKeyTest::Members)
            .unwrap_or(Vec::new(&env))
    }

    pub fn apply_governance_proposal(
        env: Env,
        caller: Address,
        proposal_type: Symbol,
        new_value: i128,
    ) {
        caller.require_auth();
        env.storage()
            .persistent()
            .set(&DataKeyTest::LastType(proposal_type.clone()), &new_value);
        env.events()
            .publish((symbol_short!("gov_ap"), proposal_type), new_value);
    }

    pub fn last_value(env: Env, proposal_type: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKeyTest::LastType(proposal_type))
            .unwrap_or(0)
    }
}

#[contracttype]
pub enum DataKeyTest {
    Members,
    LastType(Symbol),
}

struct Ctx {
    env: Env,
    pool_id: Address,
    gov_id: Address,
    admin: Address,
    proposer: Address,
    voters: [Address; 2],
}

fn params_i128(env: &Env, key: &str, value: i128) -> Map<String, Bytes> {
    let mut m = Map::new(env);
    m.set(
        String::from_str(env, key),
        Bytes::from_array(env, &value.to_be_bytes()),
    );
    m
}

fn empty_params(env: &Env) -> Map<String, Bytes> {
    Map::new(env)
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);

    let pool_id = env.register_contract(None, TestPool);
    TestPoolClient::new(&env, &pool_id).initialize(&vec![
        &env,
        proposer.clone(),
        voter1.clone(),
        voter2.clone(),
    ]);

    let gov_id = env.register_contract(None, Governance);
    let gov = GovernanceClient::new(&env, &gov_id);
    gov.initialize(&admin, &pool_id, &51u32);

    Ctx {
        env,
        pool_id,
        gov_id,
        admin,
        proposer,
        voters: [voter1, voter2],
    }
}

/// Creates a proposal proposed by ctx.proposer and passes it by having both
/// other members vote in favor (2/3 votes meets the 51% quorum).
fn create_and_pass(
    ctx: &Ctx,
    proposal_type: ProposalType,
    params: Map<String, Bytes>,
) -> BytesN<32> {
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &proposal_type,
        &String::from_str(&ctx.env, "test proposal"),
        &params,
    );
    gov.vote(&ctx.voters[0], &id, &true);
    gov.vote(&ctx.voters[1], &id, &true);
    id
}

#[test]
fn initialize_stores_config() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    assert_eq!(gov.get_voting_quorum(), 51u32);
    assert_eq!(gov.admin(), ctx.admin);
    assert_eq!(gov.pool_contract(), ctx.pool_id);
    assert_eq!(gov.voting_period_secs(), DAY_SECS);
}

#[test]
#[should_panic(expected = "quorum must be 1-100")]
fn initialize_rejects_zero_quorum() {
    let env = Env::default();
    env.mock_all_auths();
    let pool_id = env.register_contract(None, TestPool);
    let gov_id = env.register_contract(None, Governance);
    let gov = GovernanceClient::new(&env, &gov_id);
    gov.initialize(&Address::generate(&env), &pool_id, &0u32);
}

#[test]
#[should_panic(expected = "quorum must be 1-100")]
fn initialize_rejects_quorum_over_100() {
    let env = Env::default();
    env.mock_all_auths();
    let pool_id = env.register_contract(None, TestPool);
    let gov_id = env.register_contract(None, Governance);
    let gov = GovernanceClient::new(&env, &gov_id);
    gov.initialize(&Address::generate(&env), &pool_id, &101u32);
}

#[test]
#[should_panic(expected = "already initialized")]
fn cannot_initialize_twice() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    gov.initialize(&ctx.admin, &ctx.pool_id, &51u32);
}

#[test]
#[should_panic(expected = "not a pool member")]
fn non_member_cannot_create_proposal() {
    let ctx = setup();
    let outsider = Address::generate(&ctx.env);
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    gov.create_proposal(
        &outsider,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "hostile proposal"),
        &params_i128(&ctx.env, "deposit_amount", 1),
    );
}

#[test]
fn create_and_read_proposal() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);

    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );

    let p = gov.get_proposal(&id);
    assert_eq!(p.id, id);
    assert_eq!(p.proposer, ctx.proposer);
    assert_eq!(p.proposal_type, ProposalType::ChangeDepositAmount);
    assert_eq!(p.status, ProposalStatus::Active);
    assert_eq!(p.created_at, 0u64);
    assert_eq!(p.expires_at, DAY_SECS);
    assert_eq!(p.votes_for.len(), 0u32);
    assert_eq!(p.votes_against.len(), 0u32);
    assert_eq!(p.execution_result, None);

    let active = gov.get_active_proposals(&ctx.pool_id);
    assert_eq!(active.len(), 1u32);
}

#[test]
#[should_panic(expected = "description required")]
fn empty_description_rejected() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    gov.create_proposal(
        &ctx.proposer,
        &ProposalType::Custom,
        &String::from_str(&ctx.env, ""),
        &empty_params(&ctx.env),
    );
}

#[test]
#[should_panic(expected = "description too long")]
fn overlong_description_rejected() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let long = String::from_str(&ctx.env, &"x".repeat(501));
    gov.create_proposal(
        &ctx.proposer,
        &ProposalType::Custom,
        &long,
        &empty_params(&ctx.env),
    );
}

#[test]
#[should_panic(expected = "too many active proposals")]
fn max_three_active_proposals_enforced() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    for i in 0..4u32 {
        gov.create_proposal(
            &ctx.proposer,
            &ProposalType::Custom,
            &String::from_str(&ctx.env, "custom"),
            &params_i128(&ctx.env, "note", i as i128),
        );
    }
}

#[test]
fn votes_are_counted() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );

    gov.vote(&ctx.voters[0], &id, &true);
    let p = gov.get_proposal(&id);
    assert_eq!(p.votes_for.len(), 1u32);

    gov.vote(&ctx.voters[1], &id, &false);
    let p = gov.get_proposal(&id);
    assert_eq!(p.votes_against.len(), 1u32);
    // 1 of 3 for (33%) does not meet 51% quorum yet.
    assert_eq!(p.status, ProposalStatus::Active);
    assert_eq!(gov.has_voted(&id, &ctx.voters[1]), Some(false));
}

#[test]
#[should_panic(expected = "already voted")]
fn double_vote_rejected() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );
    gov.vote(&ctx.voters[0], &id, &true);
    gov.vote(&ctx.voters[0], &id, &true);
}

#[test]
#[should_panic(expected = "proposer cannot vote")]
fn proposer_cannot_vote_own_proposal() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );
    gov.vote(&ctx.proposer, &id, &true);
}

#[test]
#[should_panic(expected = "not a pool member")]
fn non_member_cannot_vote() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );
    let outsider = Address::generate(&ctx.env);
    gov.vote(&outsider, &id, &true);
}

#[test]
#[should_panic(expected = "quorum not met")]
fn execute_before_quorum_fails() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );
    gov.vote(&ctx.voters[0], &id, &true);
    gov.execute_proposal(&ctx.voters[0], &id);
}

#[test]
fn execute_applies_change_to_pool_via_cpi() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);

    let id = create_and_pass(
        &ctx,
        ProposalType::ChangeDepositAmount,
        params_i128(&ctx.env, "deposit_amount", 500),
    );

    let p = gov.get_proposal(&id);
    assert_eq!(p.status, ProposalStatus::Passed);

    gov.execute_proposal(&ctx.voters[0], &id);

    let p = gov.get_proposal(&id);
    assert_eq!(p.status, ProposalStatus::Executed);
    assert!(p.execution_result.is_some());
    assert_eq!(
        TestPoolClient::new(&ctx.env, &ctx.pool_id)
            .last_value(&Symbol::new(&ctx.env, "change_deposit_amount")),
        500i128
    );

    // Executed proposals leave the active list.
    assert_eq!(gov.get_active_proposals(&ctx.pool_id).len(), 0u32);
    assert_eq!(gov.get_recent_proposals().len(), 1u32);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn expired_proposal_cannot_be_voted_on() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );

    ctx.env.ledger().set_timestamp(DAY_SECS + 1);
    gov.vote(&ctx.voters[0], &id, &true);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn passed_but_expired_proposal_cannot_execute() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = create_and_pass(
        &ctx,
        ProposalType::ChangeDepositAmount,
        params_i128(&ctx.env, "deposit_amount", 500),
    );

    ctx.env.ledger().set_timestamp(DAY_SECS + 1);
    gov.execute_proposal(&ctx.voters[0], &id);
}

#[test]
fn expire_proposal_marks_expired() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );

    ctx.env.ledger().set_timestamp(DAY_SECS + 1);
    gov.expire_proposal(&ctx.voters[0], &id);
    assert_eq!(gov.get_proposal(&id).status, ProposalStatus::Expired);
}

#[test]
#[should_panic(expected = "voting period not over")]
fn expire_before_deadline_fails() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::ChangeDepositAmount,
        &String::from_str(&ctx.env, "raise deposit"),
        &params_i128(&ctx.env, "deposit_amount", 250),
    );
    gov.expire_proposal(&ctx.voters[0], &id);
}

#[test]
fn against_quorum_rejects_proposal() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::AddPenalty,
        &String::from_str(&ctx.env, "harsh penalty"),
        &params_i128(&ctx.env, "percentage", 90),
    );

    gov.vote(&ctx.voters[0], &id, &false);
    gov.vote(&ctx.voters[1], &id, &false);

    assert_eq!(gov.get_proposal(&id).status, ProposalStatus::Rejected);
    assert_eq!(gov.get_active_proposals(&ctx.pool_id).len(), 0u32);
}

#[test]
#[should_panic(expected = "quorum not met")]
fn rejected_proposal_cannot_execute() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = gov.create_proposal(
        &ctx.proposer,
        &ProposalType::AddPenalty,
        &String::from_str(&ctx.env, "harsh penalty"),
        &params_i128(&ctx.env, "percentage", 90),
    );
    gov.vote(&ctx.voters[0], &id, &false);
    gov.vote(&ctx.voters[1], &id, &false);
    gov.execute_proposal(&ctx.voters[0], &id);
}

#[test]
fn change_quorum_updates_governance_config() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = create_and_pass(
        &ctx,
        ProposalType::ChangeQuorum,
        params_i128(&ctx.env, "quorum", 66),
    );
    gov.execute_proposal(&ctx.voters[0], &id);
    assert_eq!(gov.get_voting_quorum(), 66u32);
}

#[test]
fn extend_deadline_and_penalty_proposals_apply() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);

    let id1 = create_and_pass(
        &ctx,
        ProposalType::ExtendDeadline,
        params_i128(&ctx.env, "seconds", 3600),
    );
    gov.execute_proposal(&ctx.voters[0], &id1);

    let id2 = create_and_pass(
        &ctx,
        ProposalType::AddPenalty,
        params_i128(&ctx.env, "percentage", 5),
    );
    gov.execute_proposal(&ctx.voters[0], &id2);

    let id3 = create_and_pass(&ctx, ProposalType::RemovePenalty, empty_params(&ctx.env));
    gov.execute_proposal(&ctx.voters[0], &id3);

    let pool = TestPoolClient::new(&ctx.env, &ctx.pool_id);
    assert_eq!(
        pool.last_value(&Symbol::new(&ctx.env, "extend_deadline")),
        3600i128
    );
    assert_eq!(
        pool.last_value(&Symbol::new(&ctx.env, "add_penalty")),
        5i128
    );
    assert_eq!(
        pool.last_value(&Symbol::new(&ctx.env, "remove_penalty")),
        0i128
    );
}

#[test]
#[should_panic(expected = "missing parameter")]
fn missing_parameter_traps_on_execute() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    let id = create_and_pass(
        &ctx,
        ProposalType::ChangeDepositAmount,
        params_i128(&ctx.env, "wrong_key", 5),
    );
    gov.execute_proposal(&ctx.voters[0], &id);
}

#[test]
#[should_panic(expected = "wrong pool")]
fn active_proposals_query_rejects_wrong_pool() {
    let ctx = setup();
    let gov = GovernanceClient::new(&ctx.env, &ctx.gov_id);
    gov.get_active_proposals(&Address::generate(&ctx.env));
}
