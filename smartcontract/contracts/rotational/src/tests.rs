#![cfg(test)]

use super::{RotationalPool, RotationalPoolClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Vec,
};

#[test]
fn test_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup contract and clients
    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    // Setup token
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_interface_client = token::Client::new(&env, &token_address);

    // Setup actors
    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    let deposit_amount = 100i128;
    let round_duration = 100u64;
    let treasury_fee_bps = 500u32; // 5%
    let relayer_fee_bps = 200u32;  // 2%

    // Initialize pool
    client.initialize(
        &token_address,
        &admin,
        &members,
        &deposit_amount,
        &round_duration,
        &treasury_fee_bps,
        &relayer_fee_bps,
        &treasury,
    );

    // Verify initial state
    assert!(client.is_active());
    assert!(!client.is_paused());
    assert_eq!(client.current_round(), 0);
    assert_eq!(client.members().len(), 3);
    assert_eq!(client.next_payout_time(), env.ledger().timestamp() + round_duration);

    // Mint tokens to members
    token_client.mint(&member_a, &deposit_amount);
    token_client.mint(&member_b, &deposit_amount);
    token_client.mint(&member_c, &deposit_amount);

    // Deposit for each member
    client.deposit(&member_a);
    client.deposit(&member_b);
    client.deposit(&member_c);

    // Check deposits registered
    assert!(client.has_deposited(&member_a));
    assert!(client.has_deposited(&member_b));
    assert!(client.has_deposited(&member_c));

    // Advance time to allow payout
    let next_payout = client.next_payout_time();
    env.ledger().set_timestamp(next_payout);

    // Trigger payout
    client.trigger_payout(&relayer);

    // Total collected = 300
    // Treasury fee = 300 * 5% = 15
    // Relayer fee = 300 * 2% = 6
    // Payout amount = 300 - 15 - 6 = 279
    // Beneficiary of round 0 is member_a
    assert_eq!(token_interface_client.balance(&member_a), 279);
    assert_eq!(token_interface_client.balance(&treasury), 15);
    assert_eq!(token_interface_client.balance(&relayer), 6);

    // Round should have advanced
    assert_eq!(client.current_round(), 1);
    assert_eq!(client.next_payout_time(), next_payout + round_duration);

    // Deposited flags reset
    assert!(!client.has_deposited(&member_a));
}

#[test]
#[should_panic(expected = "not a member")]
fn test_non_member_deposit_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let non_member = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&non_member, &100i128);

    // This should panic because non_member is not in members list
    client.deposit(&non_member);
}

#[test]
#[should_panic(expected = "already deposited this round")]
fn test_duplicate_deposit_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &200i128);

    // First deposit succeeds
    client.deposit(&member_a);

    // Second deposit should panic
    client.deposit(&member_a);
}

#[test]
#[should_panic(expected = "too early")]
fn test_premature_payout_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &100i128);
    token_client.mint(&member_b, &100i128);

    client.deposit(&member_a);
    client.deposit(&member_b);

    // Keep timestamp < next_payout_time (which is init_time + 100)
    // We set timestamp to 99, which is premature.
    env.ledger().set_timestamp(99);

    // This should panic because next_payout_time is 100.
    client.trigger_payout(&relayer);
}

#[test]
fn test_fee_deduction() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_interface_client = token::Client::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    // Treasury fee = 20% (2000 BPS), Relayer fee = 10% (1000 BPS)
    client.initialize(
        &token_address,
        &admin,
        &members,
        &1000i128,
        &100u64,
        &2000u32,
        &1000u32,
        &treasury,
    );

    token_client.mint(&member_a, &1000i128);
    token_client.mint(&member_b, &1000i128);

    client.deposit(&member_a);
    client.deposit(&member_b);

    // Advance time
    env.ledger().set_timestamp(100);

    client.trigger_payout(&relayer);

    // Total collected = 2000
    // Treasury fee = 2000 * 20% = 400
    // Relayer fee = 2000 * 10% = 200
    // Beneficiary payout = 2000 - 400 - 200 = 1400
    assert_eq!(token_interface_client.balance(&member_a), 1400);
    assert_eq!(token_interface_client.balance(&treasury), 400);
    assert_eq!(token_interface_client.balance(&relayer), 200);
}

#[test]
fn test_pool_marks_inactive() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    // Mints
    token_client.mint(&member_a, &200i128);
    token_client.mint(&member_b, &200i128);

    // ROUND 0
    client.deposit(&member_a);
    client.deposit(&member_b);
    env.ledger().set_timestamp(100);
    client.trigger_payout(&relayer);

    assert!(client.is_active());
    assert_eq!(client.current_round(), 1);

    // ROUND 1
    client.deposit(&member_a);
    client.deposit(&member_b);
    env.ledger().set_timestamp(200);
    client.trigger_payout(&relayer);

    // Now the pool should be inactive (as both rounds are completed)
    assert!(!client.is_active());
}

#[test]
#[should_panic(expected = "pool inactive")]
fn test_deposit_inactive_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &200i128);
    token_client.mint(&member_b, &200i128);

    // Round 0
    client.deposit(&member_a);
    client.deposit(&member_b);
    env.ledger().set_timestamp(100);
    client.trigger_payout(&relayer);

    // Round 1
    client.deposit(&member_a);
    client.deposit(&member_b);
    env.ledger().set_timestamp(200);
    client.trigger_payout(&relayer);

    // Now inactive. Try to deposit again:
    client.deposit(&member_a);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_deposit_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &100i128);

    // Pause then attempt deposit
    client.pause(&admin);
    client.deposit(&member_a);
}

#[test]
fn test_pause_unpause_deposit_cycle() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &300i128);

    // Pool active and not paused — deposit succeeds
    assert!(!client.is_paused());
    client.deposit(&member_a);
    assert!(client.has_deposited(&member_a));

    // Pause the pool
    client.pause(&admin);
    assert!(client.is_paused());

    // Unpause the pool
    client.unpause(&admin);
    assert!(!client.is_paused());

    // Deposit for member_b should succeed after unpause
    token_client.mint(&member_b, &100i128);
    client.deposit(&member_b);
    assert!(client.has_deposited(&member_b));
}

#[test]
#[should_panic(expected = "not admin")]
fn test_non_admin_pause_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    client.pause(&non_admin);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_non_admin_emergency_withdraw_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &100i128);
    client.deposit(&member_a);

    // Pause with real admin first so the paused check passes
    client.pause(&admin);
    client.emergency_withdraw(&non_admin, &recipient);
}

#[test]
fn test_emergency_withdraw_drains_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &100i128);
    token_client.mint(&member_b, &100i128);

    client.deposit(&member_a);
    client.deposit(&member_b);

    // Pause then emergency withdraw
    client.pause(&admin);
    client.emergency_withdraw(&admin, &recipient);

    assert_eq!(token_iface.balance(&recipient), 200);
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
fn test_set_admin_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    // Quorum is empty initially
    let q = client.get_admin_quorum();
    assert_eq!(q.len(), 0);

    // Set quorum of 3 admins
    let mut new_admins = Vec::new(&env);
    new_admins.push_back(admin.clone());
    new_admins.push_back(admin2.clone());
    new_admins.push_back(admin3.clone());
    client.set_admin_quorum(&admin, &new_admins);

    let q = client.get_admin_quorum();
    assert_eq!(q.len(), 3);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_set_quorum_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut new_admins = Vec::new(&env);
    new_admins.push_back(non_admin.clone());
    new_admins.push_back(Address::generate(&env));
    client.set_admin_quorum(&non_admin, &new_admins);
}

#[test]
#[should_panic(expected = "quorum must have at least 2 admins")]
fn test_set_quorum_too_few() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut new_admins = Vec::new(&env);
    new_admins.push_back(admin.clone());
    client.set_admin_quorum(&admin, &new_admins);
}

#[test]
#[should_panic(expected = "original admin must be in quorum")]
fn test_set_quorum_admin_not_included() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let other1 = Address::generate(&env);
    let other2 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut new_admins = Vec::new(&env);
    new_admins.push_back(other1.clone());
    new_admins.push_back(other2.clone());
    client.set_admin_quorum(&admin, &new_admins);
}

#[test]
fn test_approve_action_and_count() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    // Set quorum of 3
    let mut quorum = Vec::new(&env);
    quorum.push_back(admin.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin, &quorum);

    let hash = make_action_hash(&env, 1);

    // 0 approvals initially
    assert_eq!(client.get_approval_count(&hash), 0);

    // Admin 1 approves
    client.approve_action(&admin, &hash);
    assert_eq!(client.get_approval_count(&hash), 1);

    // Admin 2 approves
    client.approve_action(&admin2, &hash);
    assert_eq!(client.get_approval_count(&hash), 2);

    let approvals = client.get_approvals(&hash);
    assert_eq!(approvals.len(), 2);
}

#[test]
#[should_panic(expected = "already approved")]
fn test_double_approval_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin, &quorum);

    let hash = make_action_hash(&env, 2);
    client.approve_action(&admin, &hash);
    client.approve_action(&admin, &hash);
}

#[test]
fn test_revoke_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin, &quorum);

    let hash = make_action_hash(&env, 3);

    client.approve_action(&admin, &hash);
    assert_eq!(client.get_approval_count(&hash), 1);

    client.revoke_approval(&admin, &hash);
    assert_eq!(client.get_approval_count(&hash), 0);
}

#[test]
#[should_panic(expected = "no approval to revoke")]
fn test_revoke_nonexistent_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin, &quorum);

    let hash = make_action_hash(&env, 4);
    client.revoke_approval(&admin, &hash);
}

#[test]
fn test_execute_pause_via_multisig_2_of_3() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    // Set quorum of 3 admins
    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin1, &quorum);

    assert!(!client.is_paused());

    let hash = make_action_hash(&env, 10);

    // 2 of 3 approvals needed
    client.approve_action(&admin1, &hash);
    client.approve_action(&admin2, &hash);

    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &hash, &1u32, &dummy);

    assert!(client.is_paused());
}

#[test]
#[should_panic(expected = "insufficient approvals")]
fn test_single_admin_cannot_execute_with_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin1, &quorum);

    let hash = make_action_hash(&env, 11);

    // Only 1 approval out of 3 — need 2
    client.approve_action(&admin1, &hash);

    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &hash, &1u32, &dummy);
}

#[test]
#[should_panic(expected = "multi-sig enabled")]
fn test_pause_directly_rejected_when_quorum_set() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin, &quorum);

    // Direct pause should fail because quorum is configured
    client.pause(&admin);
}

#[test]
fn test_pause_directly_works_without_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    // No quorum set — direct pause should work (backward compatible)
    assert!(!client.is_paused());
    client.pause(&admin);
    assert!(client.is_paused());
}

#[test]
#[should_panic(expected = "multi-sig enabled")]
fn test_emergency_withdraw_rejected_when_quorum_set() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &100i128);
    client.deposit(&member_a);

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin, &quorum);

    // First pause is also blocked by quorum, so we need to go through multi-sig for pause
    // But direct emergency_withdraw should fail even if pool were paused
    client.emergency_withdraw(&admin, &recipient);
}

#[test]
fn test_execute_emergency_withdraw_via_multisig() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);

    let treasury = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    token_client.mint(&member_a, &100i128);
    client.deposit(&member_a);

    // Set quorum of 3
    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin1, &quorum);

    // First, pause via multi-sig
    let pause_hash = make_action_hash(&env, 20);
    client.approve_action(&admin1, &pause_hash);
    client.approve_action(&admin2, &pause_hash);
    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &pause_hash, &1u32, &dummy);
    assert!(client.is_paused());

    // Now emergency withdraw via multi-sig
    let ew_hash = make_action_hash(&env, 21);
    client.approve_action(&admin1, &ew_hash);
    client.approve_action(&admin2, &ew_hash);
    client.approve_action(&admin3, &ew_hash);
    client.execute_approved(&admin1, &ew_hash, &3u32, &recipient);

    assert_eq!(token_iface.balance(&recipient), 100);
}

#[test]
fn test_execute_remove_member_via_multisig() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    // Set quorum of 3
    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    quorum.push_back(admin3.clone());
    client.set_admin_quorum(&admin1, &quorum);

    assert_eq!(client.members().len(), 3);

    let rm_hash = make_action_hash(&env, 30);
    client.approve_action(&admin1, &rm_hash);
    client.approve_action(&admin2, &rm_hash);
    // 2 of 3 = majority, execute remove_member (action_type=4) on member_c
    client.execute_approved(&admin1, &rm_hash, &4u32, &member_c);

    assert_eq!(client.members().len(), 2);
}

#[test]
#[should_panic(expected = "action expired")]
fn test_action_expires_after_48_hours() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin1, &quorum);

    let hash = make_action_hash(&env, 40);

    // Approve by both admins
    client.approve_action(&admin1, &hash);
    client.approve_action(&admin2, &hash);

    // Advance time by 48 hours + 1 second
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + 48 * 3600 + 1);

    let dummy = Address::generate(&env);
    client.execute_approved(&admin1, &hash, &1u32, &dummy);
}

#[test]
#[should_panic(expected = "not a quorum admin")]
fn test_non_quorum_member_cannot_approve() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(
        &token_address,
        &admin1,
        &members,
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin1, &quorum);

    let hash = make_action_hash(&env, 50);
    client.approve_action(&outsider, &hash);
}

#[test]
#[should_panic(expected = "no quorum configured")]
fn test_approve_without_quorum_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

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
        &100i128,
        &100u64,
        &0u32,
        &0u32,
        &treasury,
    );

    let hash = make_action_hash(&env, 60);
    client.approve_action(&admin, &hash);
}
