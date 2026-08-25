#![cfg(test)]

use super::{FlexiblePool, FlexiblePoolClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Vec,
};

#[test]
#[should_panic(expected = "below minimum deposit")]
fn test_minimum_deposit_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    // Minimum deposit = 10
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

    token_client.mint(&member_a, &100i128);

    // Try depositing 5 (which is less than 10)
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
    let token_interface_client = token::Client::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    // Minimum deposit = 10, withdrawal_fee_bps = 200 (2%)
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

    // Withdraw 500
    client.withdraw(&member_a, &500i128);

    // Fee = 500 * 2% = 10. Net payout = 490.
    assert_eq!(token_interface_client.balance(&member_a), 490);
    assert_eq!(token_interface_client.balance(&treasury), 10);
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

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    // Minimum deposit = 10, yield_enabled = true
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

    // Distribute yield of 60
    client.distribute_yield(&admin, &60i128);

    // A gets 20 (total 120)
    assert_eq!(client.balance_of(&member_a), 120);
    // B gets 40 (total 240)
    assert_eq!(client.balance_of(&member_b), 240);
    // C gets 0 (total 0)
    assert_eq!(client.balance_of(&member_c), 0);

    assert_eq!(client.total_balance(), 360);
}

#[test]
fn test_pause_unpause_deposit_cycle() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
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

    token_client.mint(&member_a, &1000i128);

    // Pool is not paused — deposit succeeds
    assert!(!client.is_paused());
    client.deposit(&member_a, &100i128);
    assert_eq!(client.balance_of(&member_a), 100);

    // Pause the pool
    client.pause(&admin);
    assert!(client.is_paused());

    // Unpause
    client.unpause(&admin);
    assert!(!client.is_paused());

    // Deposit should succeed again after unpause
    client.deposit(&member_a, &100i128);
    assert_eq!(client.balance_of(&member_a), 200);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_deposit_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
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

    token_client.mint(&member_a, &1000i128);

    // Pause the pool then try to deposit
    client.pause(&admin);
    client.deposit(&member_a, &100i128);
}

#[test]
fn test_emergency_withdraw_drains_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

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

    token_client.mint(&member_a, &500i128);
    client.deposit(&member_a, &500i128);
    assert_eq!(client.total_balance(), 500);

    // Must pause before emergency withdraw
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

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
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

    // non_admin is a different address — stored admin check must reject it
    client.pause(&non_admin);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_non_admin_emergency_withdraw_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

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

    // Pause with the real admin first so the paused check passes,
    // proving it is the admin check (not the paused check) that fires.
    client.pause(&admin);
    client.emergency_withdraw(&non_admin, &recipient);
}

#[test]
#[should_panic(expected = "pool not paused")]
fn test_emergency_withdraw_requires_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

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

    // Should panic because pool is not paused
    client.emergency_withdraw(&admin, &recipient);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-sig tests
// ═══════════════════════════════════════════════════════════════════════════════

use soroban_sdk::BytesN;

fn make_action_hash(env: &Env, seed: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[0..4].copy_from_slice(&seed.to_be_bytes());
    BytesN::from_array(env, &bytes)
}

#[test]
fn test_set_quorum_and_pause_via_multisig() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin1,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin1, &quorum);

    assert_eq!(client.get_admin_quorum().len(), 3);
    assert!(!client.is_paused());

    // Pause via multi-sig (2 of 3)
    let hash = make_action_hash(&env, 100);
    client.approve_action(&admin1, &hash);
    client.approve_action(&admin2, &hash);
    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &hash, &1u32, &dummy);

    assert!(client.is_paused());
}

#[test]
#[should_panic(expected = "multi-sig enabled")]
fn test_pause_directly_rejected_when_quorum_set() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
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

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin, &quorum);

    client.pause(&admin);
}

#[test]
fn test_pause_directly_works_without_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
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

    assert!(!client.is_paused());
    client.pause(&admin);
    assert!(client.is_paused());
}

#[test]
fn test_execute_emergency_withdraw_via_multisig() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin1,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );

    token_client.mint(&member_a, &500i128);
    client.deposit(&member_a, &500i128);

    // Set quorum of 2
    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin1, &quorum);

    // First pause via multi-sig
    let pause_hash = make_action_hash(&env, 200);
    client.approve_action(&admin1, &pause_hash);
    client.approve_action(&admin2, &pause_hash);
    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &pause_hash, &1u32, &dummy);
    assert!(client.is_paused());

    // Emergency withdraw via multi-sig
    let ew_hash = make_action_hash(&env, 201);
    client.approve_action(&admin1, &ew_hash);
    client.approve_action(&admin2, &ew_hash);
    client.execute_approved(&admin1, &ew_hash, &3u32, &recipient);

    assert_eq!(token_iface.balance(&recipient), 500);
    assert_eq!(client.total_balance(), 0);
}

#[test]
fn test_execute_remove_member_via_multisig() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(
        &token_address,
        &admin1,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin1, &quorum);

    assert_eq!(client.members().len(), 3);

    let rm_hash = make_action_hash(&env, 300);
    client.approve_action(&admin1, &rm_hash);
    client.approve_action(&admin2, &rm_hash);
    client.execute_approved(&admin1, &rm_hash, &4u32, &member_c);

    assert_eq!(client.members().len(), 2);
}

#[test]
#[should_panic(expected = "insufficient approvals")]
fn test_single_admin_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin1,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin1, &quorum);

    let hash = make_action_hash(&env, 400);
    client.approve_action(&admin1, &hash);
    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &hash, &1u32, &dummy);
}

#[test]
#[should_panic(expected = "action expired")]
fn test_action_expires() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin1,
        &members,
        &10i128,
        &0u32,
        &false,
        &treasury,
        &0u32,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin1, &quorum);

    let hash = make_action_hash(&env, 500);
    client.approve_action(&admin1, &hash);
    client.approve_action(&admin2, &hash);

    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + 48 * 3600 + 1);

    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &hash, &1u32, &dummy);
}
