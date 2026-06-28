#![cfg(test)]

use super::{FlexiblePool, FlexiblePoolClient};
use soroban_sdk::{testutils::{Address as _, Ledger as _, storage::Persistent}, token, Address, Env, Vec};

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

// ── Mock strategy ─────────────────────────────────────────────────────────────

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
