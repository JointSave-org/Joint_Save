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
    let relayer_fee_bps = 200u32; // 2%

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
    // SEP-41 decimals are validated at init and stored for display (SAC = 7)
    assert_eq!(client.token_decimals(), 7);
    assert_eq!(
        client.next_payout_time(),
        env.ledger().timestamp() + round_duration
    );

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
#[should_panic(expected = "duplicate member address")]
fn test_initialize_rejects_duplicate_member() {
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

    // member_a appears twice — this must be rejected, since the round-robin
    // payout indexes directly into the members vec and would otherwise let
    // member_a claim two payout rounds while member_b only ever claims one.
    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_a.clone());

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
fn test_add_member_can_deposit() {
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
    let member_c = Address::generate(&env);

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

    client.add_member(&admin, &member_c);
    token_client.mint(&member_c, &100i128);
    client.deposit(&member_c);

    assert_eq!(client.members().len(), 3);
    assert!(client.has_deposited(&member_c));
}

#[test]
#[should_panic(expected = "not a member")]
fn test_removed_member_cannot_deposit() {
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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

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

    client.remove_member(&admin, &member_b);
    token_client.mint(&member_b, &100i128);
    client.deposit(&member_b);
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

#[test]
fn test_remove_last_beneficiary_completes_pool() {
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

    // Round 0
    client.deposit(&member_a);
    client.deposit(&member_b);
    env.ledger().set_timestamp(100);
    client.trigger_payout(&relayer);

    assert!(client.is_active());
    assert_eq!(client.current_round(), 1);

    // In Round 1, member_b is the beneficiary.
    // If we remove member_b before they deposit, the pool should complete immediately because no beneficiary remains for the final round.
    client.remove_member(&admin, &member_b);

    assert!(!client.is_active());
}

#[test]
fn test_remove_member_general() {
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
    let member_c = Address::generate(&env);
    let member_d = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());
    members.push_back(member_d.clone());

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
    token_client.mint(&member_c, &200i128);
    token_client.mint(&member_d, &200i128);

    // Initial state: current_round = 0 (beneficiary is member_a)
    assert_eq!(client.current_round(), 0);

    // Scenario A: Remove a member after current_round index.
    // current_round = 0, we remove member_c (index 2).
    // removed_index (2) > current_round (0), so current_round should remain 0.
    client.remove_member(&admin, &member_c);
    assert_eq!(client.current_round(), 0);
    assert_eq!(client.members().len(), 3);
    // Members list should now be [member_a, member_b, member_d]
    assert_eq!(client.members().get(0).unwrap(), member_a);
    assert_eq!(client.members().get(1).unwrap(), member_b);
    assert_eq!(client.members().get(2).unwrap(), member_d);

    // Deposit and trigger payout for Round 0 (member_a is beneficiary)
    client.deposit(&member_a);
    client.deposit(&member_b);
    client.deposit(&member_d);
    env.ledger().set_timestamp(100);
    client.trigger_payout(&relayer);

    // Now in Round 1 (beneficiary is member_b)
    assert_eq!(client.current_round(), 1);

    // Scenario B: Remove a member before current_round index.
    // current_round = 1, we remove member_a (index 0).
    // removed_index (0) < current_round (1), so current_round should shift down to 0.
    client.remove_member(&admin, &member_a);
    assert_eq!(client.current_round(), 0);
    assert_eq!(client.members().len(), 2);
    assert_eq!(client.members().get(0).unwrap(), member_b);
    assert_eq!(client.members().get(1).unwrap(), member_d);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_add_member_fails_when_paused() {
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
    let member_c = Address::generate(&env);
    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    client.initialize(&token_address, &admin, &members, &100i128, &100u64, &0u32, &0u32, &treasury);
    client.pause(&admin);
    client.add_member(&admin, &member_c);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_remove_member_fails_when_paused() {
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
    client.initialize(&token_address, &admin, &members, &100i128, &100u64, &0u32, &0u32, &treasury);
    client.pause(&admin);
    client.remove_member(&admin, &member_b);
}

#[test]
fn test_leave_pool_non_admin_member_succeeds() {
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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &100u64, &0u32, &0u32, &treasury);

    // member_b is not admin and not the current beneficiary (index 0 = member_a)
    client.leave_pool(&member_b);

    assert_eq!(client.members().len(), 2);
    let remaining = client.members();
    assert_eq!(remaining.get(0).unwrap(), member_a);
    assert_eq!(remaining.get(1).unwrap(), member_c);
}

#[test]
#[should_panic(expected = "current beneficiary cannot leave mid-round")]
fn test_leave_pool_admin_panics_as_current_beneficiary() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    // admin is member[0] — the current beneficiary in round 0
    let mut members = Vec::new(&env);
    members.push_back(admin.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &100u64, &0u32, &0u32, &treasury);

    // admin is index 0 = current beneficiary at round 0, so leave_pool must block them
    client.leave_pool(&admin);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_leave_pool_panics_when_paused() {
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

    client.initialize(&token_address, &admin, &members, &100i128, &100u64, &0u32, &0u32, &treasury);

    client.pause(&admin);
    client.leave_pool(&member_b);
}

#[test]
#[should_panic(expected = "need >=1 members")]
fn test_leave_pool_panics_when_only_one_member() {
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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &100u64, &0u32, &0u32, &treasury);

    // admin removes two members so only member_a remains
    client.remove_member(&admin, &member_c);
    client.remove_member(&admin, &member_b);

    // len guard (1 > 1 = false) fires before beneficiary guard
    client.leave_pool(&member_a);
}

#[test]
#[should_panic(expected = "current beneficiary cannot leave mid-round")]
fn test_leave_pool_panics_when_current_beneficiary_non_admin() {
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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &100u64, &0u32, &0u32, &treasury);

    // current_round = 0, beneficiary is member_a (index 0)
    client.leave_pool(&member_a);
}

#[test]
fn test_bump_state() {
    use soroban_sdk::testutils::storage::Persistent;

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

    // Initialize pool
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

    // Call bump_state
    client.bump_state();

    // Verify Admin and Members keys TTL were extended
    env.as_contract(&contract_id, || {
        let admin_ttl = env.storage().persistent().get_ttl(&super::DataKey::Admin);
        let members_ttl = env.storage().persistent().get_ttl(&super::DataKey::Members);
        assert!(admin_ttl >= 2592000);
        assert!(members_ttl >= 2592000);
    });
}

