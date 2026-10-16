use super::{FlexiblePool, FlexiblePoolClient};
use jointsave_yield_vault::mock::{MockVault, MockVaultClient};
use soroban_sdk::{
    testutils::{storage::Persistent, Address as _, Ledger as _},
    token, Address, Env, Symbol, Vec,
};

fn setup_pool(
    env: &Env,
    yield_enabled: bool,
) -> (
    FlexiblePoolClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(env, &contract_id);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    let member_a = Address::generate(env);
    let member_b = Address::generate(env);

    let mut members = Vec::new(env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &10i128,
        &0u32,
        &yield_enabled,
        &treasury,
        &0u32,
    );

    (client, token_address, admin, treasury, member_a, member_b)
}

// ── Original tests (updated for new initialize signature) ─────────────────────

#[test]
fn test_token_decimals_recorded() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _treasury, _a, _b) = setup_pool(&env, false);
    // SEP-41 decimals are validated at init and stored for display (SAC = 7)
    assert_eq!(client.token_decimals(), 7);
}

#[test]
#[should_panic(expected = "duplicate member address")]
fn test_initialize_rejects_duplicate_member() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    // member_a appears twice — distribute_yield iterates the raw members
    // vec, so a duplicate slot would grant member_a a double yield share.
    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_a.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );
}

#[test]
#[should_panic(expected = "below minimum deposit")]
fn test_minimum_deposit_rejection() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address, _admin, _treasury, member_a, _member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    token_client.mint(&member_a, &100i128);
    client.deposit(&member_a, &5i128);
}

#[test]
fn test_withdrawal_fee_deduction() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &10i128,
        &200u32,
        &false,
        &treasury,
        &0u32,
    );

    token_client.mint(&member_a, &1000i128);
    client.deposit(&member_a, &1000i128);
    assert_eq!(client.balance_of(&member_a), 1000);

    client.withdraw(&member_a, &500i128);

    assert_eq!(token_iface.balance(&member_a), 490);
    assert_eq!(token_iface.balance(&treasury), 10);
    assert_eq!(client.balance_of(&member_a), 500);
    assert_eq!(client.total_balance(), 500);
}

#[test]
fn test_proportional_yield_distribution() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &10i128,
        &0u32,
        &true,
        &treasury,
        &0u32,
    );

    token_client.mint(&member_a, &100i128);
    token_client.mint(&member_b, &200i128);

    client.deposit(&member_a, &100i128);
    client.deposit(&member_b, &200i128);
    assert_eq!(client.total_balance(), 300);

    client.distribute_yield(&admin, &60i128);

    assert_eq!(client.balance_of(&member_a), 120);
    assert_eq!(client.balance_of(&member_b), 240);
    assert_eq!(client.balance_of(&member_c), 0);
    assert_eq!(client.total_balance(), 360);
}

#[test]
fn test_add_member_can_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_address, admin, _treasury, _member_a, _member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let member_c = Address::generate(&env);

    client.add_member(&admin, &member_c);
    token_client.mint(&member_c, &100i128);
    client.deposit(&member_c, &100i128);

    assert_eq!(client.members().len(), 3);
    assert_eq!(client.balance_of(&member_c), 100);
}

#[test]
fn test_remove_member_refunds_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_address, admin, _treasury, member_a, member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);
    let member_c = Address::generate(&env);

    client.add_member(&admin, &member_c);
    token_client.mint(&member_b, &100i128);
    client.deposit(&member_b, &100i128);

    client.remove_member(&admin, &member_b);

    assert_eq!(token_iface.balance(&member_b), 100);
    assert_eq!(client.balance_of(&member_b), 0);
    assert_eq!(client.total_balance(), 0);
    assert_eq!(client.members().len(), 2);

    token_client.mint(&member_a, &100i128);
    client.deposit(&member_a, &100i128);
}

#[test]
#[should_panic(expected = "not a member")]
fn test_removed_member_cannot_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, token_address, admin, _treasury, _member_a, member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let member_c = Address::generate(&env);

    client.add_member(&admin, &member_c);
    client.remove_member(&admin, &member_b);
    token_client.mint(&member_b, &100i128);
    client.deposit(&member_b, &100i128);
}

// ── Upstream pause/emergency tests ────────────────────────────────────────────

#[test]
fn test_pause_unpause_deposit_cycle() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address, admin, _treasury, member_a, _member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    token_client.mint(&member_a, &1000i128);

    assert!(!client.is_paused());
    client.deposit(&member_a, &100i128);
    assert_eq!(client.balance_of(&member_a), 100);

    client.pause(&admin);
    assert!(client.is_paused());

    client.unpause(&admin);
    assert!(!client.is_paused());

    client.deposit(&member_a, &100i128);
    assert_eq!(client.balance_of(&member_a), 200);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_deposit_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address, admin, _treasury, member_a, _member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    token_client.mint(&member_a, &1000i128);
    client.pause(&admin);
    client.deposit(&member_a, &100i128);
}

#[test]
fn test_emergency_withdraw_drains_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address, admin, _treasury, member_a, _member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);
    let recipient = Address::generate(&env);

    token_client.mint(&member_a, &500i128);
    client.deposit(&member_a, &500i128);
    assert_eq!(client.total_balance(), 500);

    client.pause(&admin);
    client.emergency_withdraw(&admin, &recipient);

    assert_eq!(token_iface.balance(&recipient), 500);
    assert_eq!(client.total_balance(), 0);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_non_admin_pause_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _treasury, member_a, _member_b) = setup_pool(&env, false);
    client.pause(&member_a);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_non_admin_emergency_withdraw_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, member_a, _member_b) = setup_pool(&env, false);
    let recipient = Address::generate(&env);
    client.pause(&admin);
    client.emergency_withdraw(&member_a, &recipient);
}

#[test]
#[should_panic(expected = "pool not paused")]
fn test_emergency_withdraw_requires_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, _member_a, _member_b) = setup_pool(&env, false);
    let recipient = Address::generate(&env);
    client.emergency_withdraw(&admin, &recipient);
}

// ── Yield strategy tests ───────────────────────────────────────────────────────

#[test]
fn test_set_yield_strategy() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, _a, _b) = setup_pool(&env, true);
    let strategy = Address::generate(&env);
    client.set_yield_strategy(&admin, &strategy);
    assert_eq!(client.yield_strategy(), Some(strategy));
}

#[test]
#[should_panic(expected = "yield disabled")]
fn test_set_yield_strategy_requires_yield_enabled() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, _a, _b) = setup_pool(&env, false);
    let strategy = Address::generate(&env);
    client.set_yield_strategy(&admin, &strategy);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_set_yield_strategy_only_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _treasury, member_a, _b) = setup_pool(&env, true);
    let strategy = Address::generate(&env);
    client.set_yield_strategy(&member_a, &strategy);
}

#[test]
fn test_deploy_to_yield_tracks_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address, admin, _treasury, member_a, member_b) = setup_pool(&env, true);

    let token_client = token::StellarAssetClient::new(&env, &token_address);
    token_client.mint(&member_a, &500i128);
    token_client.mint(&member_b, &500i128);
    client.deposit(&member_a, &500i128);
    client.deposit(&member_b, &500i128);

    let strategy_id = env.register_contract(None, MockStrategy);
    client.set_yield_strategy(&admin, &strategy_id);
    client.deploy_to_yield(&admin, &200i128);

    assert_eq!(client.deployed_to_yield(), 200);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_add_member_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, _member_a, _member_b) = setup_pool(&env, false);
    let member_c = Address::generate(&env);
    client.pause(&admin);
    client.add_member(&admin, &member_c);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_remove_member_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, member_a, _member_b) = setup_pool(&env, false);
    client.pause(&admin);
    client.remove_member(&admin, &member_a);
}

#[test]
fn test_leave_pool_non_admin_member_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, member_a, member_b) = setup_pool(&env, false);
    let member_c = Address::generate(&env);

    client.add_member(&admin, &member_c);

    // member_b leaves (not admin, pool has 3 members)
    client.leave_pool(&member_b);

    assert_eq!(client.members().len(), 2);
    let remaining = client.members();
    assert_eq!(remaining.get(0).unwrap(), member_a);
    assert_eq!(remaining.get(1).unwrap(), member_c);
}

#[test]
fn test_leave_pool_refunds_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address, admin, _treasury, _member_a, member_b) = setup_pool(&env, false);
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);
    let member_c = Address::generate(&env);

    client.add_member(&admin, &member_c);

    token_client.mint(&member_b, &150i128);
    client.deposit(&member_b, &150i128);

    client.leave_pool(&member_b);

    assert_eq!(token_iface.balance(&member_b), 150);
    assert_eq!(client.balance_of(&member_b), 0);
    assert_eq!(client.total_balance(), 0);
    assert_eq!(client.members().len(), 2);
}

#[test]
fn test_leave_pool_admin_can_leave_as_regular_member() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    // admin is also a member
    let mut members = Vec::new(&env);
    members.push_back(admin.clone());
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );

    // Admin leaves — leave_pool has no admin restriction
    client.leave_pool(&admin);

    assert_eq!(client.members().len(), 2);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_leave_pool_panics_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, _member_a, member_b) = setup_pool(&env, false);
    client.pause(&admin);
    client.leave_pool(&member_b);
}

#[test]
#[should_panic(expected = "need >=1 members")]
fn test_leave_pool_panics_when_only_one_member() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, member_a, member_b) = setup_pool(&env, false);

    // admin removes member_b, leaving only member_a
    client.remove_member(&admin, &member_b);

    // member_a is the last member — leave would drop to 0
    client.leave_pool(&member_a);
}

#[test]
fn test_bump_state() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );

    // Extend the contract instance TTL to prevent archiving when we advance sequence number
    env.as_contract(&contract_id, || {
        env.storage().instance().extend_ttl(3000000, 3000000);
    });

    // Advance sequence number to decrease TTL below LEDGER_THRESHOLD
    env.ledger().set_sequence_number(2_100_000);

    // Verify initial TTL is below threshold
    env.as_contract(&contract_id, || {
        let admin_ttl = env.storage().persistent().get_ttl(&super::DataKey::Admin);
        let members_ttl = env.storage().persistent().get_ttl(&super::DataKey::Members);
        assert!(admin_ttl < 518400);
        assert!(members_ttl < 518400);
    });

    // Call bump_state
    client.bump_state();

    // Verify Admin and Members keys TTL were extended back to LEDGER_BUMP
    env.as_contract(&contract_id, || {
        let admin_ttl = env.storage().persistent().get_ttl(&super::DataKey::Admin);
        let members_ttl = env.storage().persistent().get_ttl(&super::DataKey::Members);
        assert!(admin_ttl >= 2592000);
        assert!(members_ttl >= 2592000);
    });
}

#[test]
fn test_migrate_succeeds_to_next_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _token, admin, _treasury, _member_a, _member_b) = setup_pool(&env, false);

    assert_eq!(client.get_version(), 1);
    client.migrate(&admin, &2);
}

#[test]
fn test_migrate_idempotent_at_current_version() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _token, admin, _treasury, _member_a, _member_b) = setup_pool(&env, false);

    client.migrate(&admin, &1);
    assert_eq!(client.get_version(), 1);
}

#[test]
#[should_panic(expected = "version must be incremented by exactly 1")]
fn test_migrate_rejects_version_skip() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _token, admin, _treasury, _member_a, _member_b) = setup_pool(&env, false);

    client.migrate(&admin, &3);
}

// ── Supported-token allowlist (USDC bridge deposits, issue #209) ──────────────

#[test]
fn test_supported_tokens_empty_by_default() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _treasury, _a, _b) = setup_pool(&env, false);
    assert_eq!(client.get_supported_tokens().len(), 0);
}

#[test]
fn test_set_supported_tokens_by_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, admin, _treasury, _a, _b) = setup_pool(&env, false);

    let usdc = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token.clone());
    tokens.push_back(usdc.clone());

    client.set_supported_tokens(&admin, &tokens);

    let stored = client.get_supported_tokens();
    assert_eq!(stored.len(), 2);
    assert_eq!(stored.get(0).unwrap(), token);
    assert_eq!(stored.get(1).unwrap(), usdc);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_set_supported_tokens_rejects_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, _admin, _treasury, member_a, _b) = setup_pool(&env, false);

    let mut tokens = Vec::new(&env);
    tokens.push_back(token);
    client.set_supported_tokens(&member_a, &tokens);
}

#[test]
fn test_deposit_succeeds_when_pool_token_is_in_allowlist() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, admin, _treasury, member_a, _b) = setup_pool(&env, false);

    let usdc = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(token.clone());
    tokens.push_back(usdc);
    client.set_supported_tokens(&admin, &tokens);

    let token_client = token::StellarAssetClient::new(&env, &token);
    token_client.mint(&member_a, &100i128);

    client.deposit(&member_a, &20i128);
    assert_eq!(client.balance_of(&member_a), 20i128);
}

#[test]
#[should_panic(expected = "token not supported")]
fn test_deposit_fails_when_pool_token_not_in_allowlist() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, member_a, _b) = setup_pool(&env, false);

    // Allowlist that deliberately excludes this pool's own token — simulates
    // an admin restricting the pool to a different SEP-41 token (e.g. USDC)
    // after initialization.
    let usdc = Address::generate(&env);
    let mut tokens = Vec::new(&env);
    tokens.push_back(usdc);
    client.set_supported_tokens(&admin, &tokens);

    client.deposit(&member_a, &20i128);
}

mod mock_strategy {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct MockStrategy;

    #[contractimpl]
    impl MockStrategy {
        pub fn deploy(_env: Env, _amount: i128) {}
        pub fn harvest(_env: Env) -> i128 {
            50
        }
    }
}

pub use mock_strategy::MockStrategy;

// ── DAO governance integration ───────────────────────────────────────────────

#[test]
fn governance_contract_can_change_minimum_deposit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, _a, _b) = setup_pool(&env, false);

    let gov = Address::generate(&env);
    client.set_governance_contract(&admin, &gov);
    assert_eq!(client.governance_contract(), Some(gov.clone()));

    client.apply_governance_proposal(&gov, &Symbol::new(&env, "change_deposit_amount"), &50i128);
    assert_eq!(client.minimum_deposit(), 50i128);
}

#[test]
fn admin_can_apply_governance_proposals_directly() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, admin, _treasury, _a, _b) = setup_pool(&env, false);

    client.apply_governance_proposal(&admin, &Symbol::new(&env, "add_penalty"), &10i128);
    assert_eq!(client.penalty_percentage(), 10u32);

    client.apply_governance_proposal(&admin, &Symbol::new(&env, "remove_penalty"), &0i128);
    assert_eq!(client.penalty_percentage(), 0u32);
}

#[test]
#[should_panic(expected = "not authorized")]
fn unauthorized_caller_cannot_apply_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _treasury, _a, _b) = setup_pool(&env, false);

    let impostor = Address::generate(&env);
    client.apply_governance_proposal(
        &impostor,
        &Symbol::new(&env, "change_deposit_amount"),
        &50i128,
    );
}

#[test]
#[should_panic(expected = "not admin")]
fn non_admin_cannot_register_governance_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _admin, _treasury, member_a, _b) = setup_pool(&env, false);

    client.set_governance_contract(&member_a, &Address::generate(&env));
}

// ── Yield vault allocation ───────────────────────────────────────────────────

mod yield_fixture {
    use super::setup_pool;
    use jointsave_yield_vault::mock::MockVault;
    use jointsave_yield_vault::mock::MockVaultClient;
    use soroban_sdk::{token, Address, Env};

    pub struct YieldCtx {
        pub pool: super::FlexiblePoolClient<'static>,
        pub vault_id: Address,
        pub token_addr: Address,
        pub admin: Address,
        pub member_a: Address,
    }

    /// A yield-enabled pool with 100 units deposited by member_a and a fresh
    /// mock vault wired as the allocation target.
    pub fn setup(env: &Env) -> YieldCtx {
        let (pool, token_addr, admin, _treasury, member_a, _member_b) = setup_pool(env, true);

        let vault_id = env.register_contract(None, MockVault);
        MockVaultClient::new(env, &vault_id).initialize(&admin, &token_addr);

        let token_admin = token::StellarAssetClient::new(env, &token_addr);
        token_admin.mint(&member_a, &100i128);
        pool.deposit(&member_a, &100i128);

        YieldCtx {
            pool,
            vault_id,
            token_addr,
            admin,
            member_a,
        }
    }
}

use yield_fixture::{setup, YieldCtx};

#[test]
fn allocation_moves_idle_capital_into_vault() {
    let env = Env::default();
    env.mock_all_auths();
    let c: YieldCtx = setup(&env);

    assert_eq!(c.pool.yield_buffer_bps(), 2000u32);
    // 100 pot, 20% buffer -> 80 allocatable.
    assert_eq!(c.pool.max_allocatable_amount(), 80i128);

    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);

    assert_eq!(c.pool.yield_vault(), Some(c.vault_id.clone()));
    assert_eq!(c.pool.yield_shares(), 80i128);
    assert_eq!(c.pool.yield_cost_basis(), 80i128);

    // Pot total is unchanged; only the liquid/illiquid split moved.
    assert_eq!(c.pool.total_balance(), 100i128);
    let vault_balance = token::Client::new(&env, &c.token_addr).balance(&c.vault_id);
    assert_eq!(vault_balance, 80i128);

    // Nothing more is allocatable while the pot total is unchanged.
    assert_eq!(c.pool.max_allocatable_amount(), 0i128);
}

#[test]
#[should_panic(expected = "buffer would be violated")]
fn allocation_respects_liquidity_buffer() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &81i128);
}

#[test]
#[should_panic(expected = "yield disabled")]
fn allocation_requires_yield_enabled() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, token_addr, admin, _treasury, member_a, _b) = setup_pool(&env, false);
    let vault_id = env.register_contract(None, MockVault);
    MockVaultClient::new(&env, &vault_id).initialize(&admin, &token_addr);
    token::StellarAssetClient::new(&env, &token_addr).mint(&member_a, &100i128);
    pool.deposit(&member_a, &100i128);

    pool.apply_yield_allocation(&admin, &vault_id, &10i128);
}

#[test]
#[should_panic(expected = "not authorized")]
fn stranger_cannot_allocate() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    let stranger = Address::generate(&env);
    c.pool
        .apply_yield_allocation(&stranger, &c.vault_id, &10i128);
}

#[test]
fn governance_contract_can_allocate() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    let gov = Address::generate(&env);
    c.pool.set_governance_contract(&c.admin, &gov);

    c.pool.apply_yield_allocation(&gov, &c.vault_id, &80i128);
    assert_eq!(c.pool.yield_shares(), 80i128);
}

#[test]
fn set_yield_buffer_changes_headroom() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);

    c.pool.set_yield_buffer(&c.admin, &5000u32);
    assert_eq!(c.pool.yield_buffer_bps(), 5000u32);
    // 50% of 100 stays liquid -> 50 allocatable.
    assert_eq!(c.pool.max_allocatable_amount(), 50i128);
}

#[test]
#[should_panic(expected = "not admin")]
fn non_admin_cannot_set_yield_buffer() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool.set_yield_buffer(&c.member_a, &5000u32);
}

#[test]
#[should_panic(expected = "buffer must be <= 10000")]
fn yield_buffer_above_100_percent_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool.set_yield_buffer(&c.admin, &10_001u32);
}

#[test]
fn deallocation_recovers_capital() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);

    let received = c.pool.apply_yield_deallocation(&c.admin, &30i128);
    assert_eq!(received, 30i128);
    assert_eq!(c.pool.yield_shares(), 50i128);
    assert_eq!(c.pool.yield_cost_basis(), 50i128);

    // 50 remains in the vault.
    let vault_balance = token::Client::new(&env, &c.token_addr).balance(&c.vault_id);
    assert_eq!(vault_balance, 50i128);
}

#[test]
fn member_can_deallocate_without_vote() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);

    let received = c.pool.apply_yield_deallocation(&c.member_a, &20i128);
    assert_eq!(received, 20i128);
    assert_eq!(c.pool.yield_shares(), 60i128);
}

#[test]
#[should_panic(expected = "not authorized")]
fn stranger_cannot_deallocate() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);
    let stranger = Address::generate(&env);
    c.pool.apply_yield_deallocation(&stranger, &10i128);
}

#[test]
fn withdraw_auto_deallocates_when_liquid_short() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    // Deploy everything above the buffer: 20 stays liquid, 80 in the vault.
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);

    // Withdrawing 50 needs 30 more than the 20 liquid.
    c.pool.withdraw(&c.member_a, &50i128);
    assert_eq!(c.pool.balance_of(&c.member_a), 50i128);
    // 30 shares were redeemed to cover the shortfall.
    assert_eq!(c.pool.yield_shares(), 50i128);
}

#[test]
#[should_panic(expected = "vault illiquid")]
fn withdraw_reverts_when_vault_cannot_cover() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);

    // Simulate the vault's assets being fully locked up.
    MockVaultClient::new(&env, &c.vault_id).set_locked_assets(&c.admin, &80i128);

    c.pool.withdraw(&c.member_a, &50i128);
}

#[test]
fn deallocation_returns_partial_when_illiquid() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);
    MockVaultClient::new(&env, &c.vault_id).set_locked_assets(&c.admin, &40i128);

    // Only 40 of the 80 is liquid, so a 100 request returns 40 (no revert).
    let received = c.pool.apply_yield_deallocation(&c.admin, &100i128);
    assert_eq!(received, 40i128);
    assert_eq!(c.pool.yield_shares(), 40i128);
}

#[test]
#[should_panic(expected = "yield locked")]
fn locked_blocks_new_allocation() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool.set_yield_locked(&c.admin, &true);
    assert!(c.pool.yield_locked());
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &10i128);
}

#[test]
fn locked_still_allows_deallocation() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool
        .apply_yield_allocation(&c.admin, &c.vault_id, &80i128);
    c.pool.set_yield_locked(&c.admin, &true);

    let received = c.pool.apply_yield_deallocation(&c.admin, &80i128);
    assert_eq!(received, 80i128);
    assert_eq!(c.pool.yield_shares(), 0i128);
}

#[test]
#[should_panic(expected = "not admin")]
fn non_admin_cannot_lock() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool.set_yield_locked(&c.member_a, &true);
}

/// Pool with two members (a: 100, b: 100), a mock vault, and 80% allocated.
fn setup_two_members_allocated(
    env: &Env,
) -> (
    FlexiblePoolClient<'static>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let (pool, token_addr, admin, _treasury, a, b) = setup_pool(env, true);
    let vault_id = env.register_contract(None, MockVault);
    MockVaultClient::new(env, &vault_id).initialize(&admin, &token_addr);

    let asset = token::StellarAssetClient::new(env, &token_addr);
    asset.mint(&a, &100i128);
    asset.mint(&b, &100i128);
    pool.deposit(&a, &100i128);
    pool.deposit(&b, &100i128);

    // 200 pot, 20% buffer -> 160 allocatable.
    pool.apply_yield_allocation(&admin, &vault_id, &160i128);
    (pool, token_addr, vault_id, admin, a, b)
}

#[test]
fn sync_yield_distributes_pro_rata() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, token_addr, vault_id, _admin, a, b) = setup_two_members_allocated(&env);

    // 10% gain on the deployed 160.
    token::StellarAssetClient::new(&env, &token_addr).mint(&vault_id, &16i128);

    assert_eq!(pool.yield_position(), 176i128);
    assert_eq!(pool.unrealised_yield(), 16i128);

    let distributed = pool.sync_yield(&a);
    assert_eq!(distributed, 16i128);
    assert_eq!(pool.balance_of(&a), 108i128);
    assert_eq!(pool.balance_of(&b), 108i128);
    assert_eq!(pool.total_balance(), 216i128);
    assert_eq!(pool.yield_cost_basis(), 176i128);
    assert_eq!(pool.unrealised_yield(), 0i128);
}

#[test]
fn sync_yield_rounding_remainder_stays_in_pot() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, token_addr, vault_id, _admin, a, _b) = setup_two_members_allocated(&env);

    // 1 unit of yield across two equal members floors to 0 each.
    token::StellarAssetClient::new(&env, &token_addr).mint(&vault_id, &1i128);
    assert_eq!(pool.unrealised_yield(), 1i128);

    let distributed = pool.sync_yield(&a);
    assert_eq!(distributed, 0i128);
    assert_eq!(pool.total_balance(), 200i128);
    // The remainder is still unrealised and can be swept later.
    assert_eq!(pool.unrealised_yield(), 1i128);
}

#[test]
fn sync_yield_with_no_gain_is_noop() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, _token, _vault, _admin, a, _b) = setup_two_members_allocated(&env);
    assert_eq!(pool.sync_yield(&a), 0i128);
    assert_eq!(pool.total_balance(), 200i128);
}

#[test]
#[should_panic(expected = "not authorized")]
fn stranger_cannot_sync_yield() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, _token, _vault, _admin, _a, _b) = setup_two_members_allocated(&env);
    let stranger = Address::generate(&env);
    pool.sync_yield(&stranger);
}

#[test]
#[should_panic(expected = "pool paused")]
fn allocation_respects_paused_state() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, token_addr, admin, _treasury, member_a, _b) = setup_pool(&env, true);
    let vault_id = env.register_contract(None, MockVault);
    MockVaultClient::new(&env, &vault_id).initialize(&admin, &token_addr);
    token::StellarAssetClient::new(&env, &token_addr).mint(&member_a, &100i128);
    pool.deposit(&member_a, &100i128);
    pool.pause(&admin);
    pool.apply_yield_allocation(&admin, &vault_id, &10i128);
}

#[test]
#[should_panic(expected = "amount must be > 0")]
fn allocation_rejects_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let c = setup(&env);
    c.pool.apply_yield_allocation(&c.admin, &c.vault_id, &0i128);
}

#[test]
#[should_panic(expected = "amount must be > 0")]
fn deallocation_rejects_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, _token, _vault, _admin, a, _b) = setup_two_members_allocated(&env);
    pool.apply_yield_deallocation(&a, &0i128);
}

#[test]
fn deallocation_on_fully_illiquid_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, token_addr, vault_id, admin, a, _b) = setup_two_members_allocated(&env);
    MockVaultClient::new(&env, &vault_id).set_locked_assets(&admin, &160i128);
    let received = pool.apply_yield_deallocation(&a, &100i128);
    assert_eq!(received, 0i128);
}

#[test]
fn set_yield_buffer_zero_forces_full_liquidity() {
    let env = Env::default();
    env.mock_all_auths();
    let (pool, _token, vault_id, admin, a, _b) = setup_two_members_allocated(&env);
    pool.set_yield_buffer(&admin, &0u32);
    assert_eq!(pool.yield_buffer_bps(), 0u32);
    // 200 pot, 0% buffer -> 200 allocatable, but headroom is 200 (liquid at start 200).
    let head = pool.max_allocatable_amount();
    assert!(head > 0);
    pool.apply_yield_deallocation(&a, &160i128);
    assert!(pool.yield_shares() <= 0);
}
