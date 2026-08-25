#![cfg(test)]

use super::{TargetPool, TargetPoolClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Vec,
};

#[test]
fn test_unlock_on_target() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    let target_amount = 100i128;
    let deadline = 1000u32;

    client.initialize(
        &token_address,
        &admin,
        &members,
        &target_amount,
        &deadline,
    );

    assert!(!client.is_unlocked());
    assert_eq!(client.total_deposited(), 0);

    token_client.mint(&member_a, &100i128);
    token_client.mint(&member_b, &100i128);

    // Deposit 40 from member A
    client.deposit(&member_a, &40i128);
    assert_eq!(client.total_deposited(), 40);
    assert!(!client.is_unlocked());

    // Deposit 60 from member B (target is 100)
    client.deposit(&member_b, &60i128);
    assert_eq!(client.total_deposited(), 100);
    assert!(client.is_unlocked());
}

#[test]
fn test_proportional_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_interface_client = token::Client::new(&env, &token_address);

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
        &1000u32,
    );

    token_client.mint(&member_a, &100i128);
    token_client.mint(&member_b, &100i128);

    client.deposit(&member_a, &40i128);
    client.deposit(&member_b, &60i128);

    assert!(client.is_unlocked());

    // Withdraw A
    client.withdraw(&member_a);
    assert_eq!(token_interface_client.balance(&member_a), 100); // 60 remaining + 40 withdrawn = 100
    assert_eq!(client.balance_of(&member_a), 0);

    // Withdraw B
    client.withdraw(&member_b);
    assert_eq!(token_interface_client.balance(&member_b), 100); // 40 remaining + 60 withdrawn = 100
    assert_eq!(client.balance_of(&member_b), 0);

    assert_eq!(client.total_deposited(), 0);
}

#[test]
fn test_refund_and_deadline_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_interface_client = token::Client::new(&env, &token_address);

    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    // Deadline sequence is 100
    client.initialize(
        &token_address,
        &admin,
        &members,
        &100i128,
        &100u32,
    );

    token_client.mint(&member_a, &100i128);
    token_client.mint(&member_b, &100i128);

    // Set ledger sequence to 50 (before deadline)
    env.ledger().set_sequence_number(50);
    client.deposit(&member_a, &40i128);

    // Set ledger sequence to 101 (passed deadline)
    env.ledger().set_sequence_number(101);

    // Refund
    client.refund(&admin);

    // Verify refund amounts: A gets their 40 back
    assert_eq!(token_interface_client.balance(&member_a), 100);
    assert_eq!(client.balance_of(&member_a), 0);
    assert_eq!(client.total_deposited(), 0);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_deposit_fails_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);
    token_client.mint(&member_a, &100i128);

    client.pause(&admin);
    client.deposit(&member_a, &40i128);
}

#[test]
fn test_pause_unpause_deposit_cycle() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);
    token_client.mint(&member_a, &100i128);

    // Deposit before pause succeeds
    assert!(!client.is_paused());
    client.deposit(&member_a, &20i128);
    assert_eq!(client.total_deposited(), 20);

    // Pause → unpause → deposit succeeds
    client.pause(&admin);
    assert!(client.is_paused());
    client.unpause(&admin);
    assert!(!client.is_paused());

    client.deposit(&member_a, &20i128);
    assert_eq!(client.total_deposited(), 40);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_non_admin_pause_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);

    client.pause(&non_admin);
}

#[test]
#[should_panic(expected = "not admin")]
fn test_non_admin_emergency_withdraw_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);
    token_client.mint(&member_a, &50i128);
    client.deposit(&member_a, &50i128);

    // Pause with real admin so paused check passes — admin check must fire
    client.pause(&admin);
    client.emergency_withdraw(&non_admin, &recipient);
}

#[test]
fn test_emergency_withdraw_drains_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);

    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &200i128, &1000u32);
    token_client.mint(&member_a, &100i128);
    client.deposit(&member_a, &100i128);

    client.pause(&admin);
    client.emergency_withdraw(&admin, &recipient);

    assert_eq!(token_iface.balance(&recipient), 100);
    assert_eq!(client.total_deposited(), 0);
}

#[test]
#[should_panic(expected = "deadline passed")]
fn test_deposit_after_deadline_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

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
        &100u32,
    );

    token_client.mint(&member_a, &100i128);

    // Set ledger sequence to 101 (passed deadline)
    env.ledger().set_sequence_number(101);

    // Should panic
    client.deposit(&member_a, &40i128);
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

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin1, &members, &100i128, &1000u32);

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

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);

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

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);

    assert!(!client.is_paused());
    client.pause(&admin);
    assert!(client.is_paused());
}

#[test]
fn test_execute_emergency_withdraw_via_multisig() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    let token_iface = token::Client::new(&env, &token_address);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin1, &members, &200i128, &1000u32);
    token_client.mint(&member_a, &100i128);
    client.deposit(&member_a, &100i128);

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

    assert_eq!(token_iface.balance(&recipient), 100);
    assert_eq!(client.total_deposited(), 0);
}

#[test]
fn test_execute_remove_member_via_multisig() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(&token_address, &admin1, &members, &100i128, &1000u32);

    let mut quorum = Vec::new(&env);
    quorum.push_back(admin1.clone());
    quorum.push_back(admin2.clone());
    client.set_admin_quorum(&admin1, &quorum);

    // Can't easily count members view (no view), but we test the function works
    let rm_hash = make_action_hash(&env, 300);
    client.approve_action(&admin1, &rm_hash);
    client.approve_action(&admin2, &rm_hash);
    client.execute_approved(&admin1, &rm_hash, &4u32, &member_c);
}

#[test]
#[should_panic(expected = "insufficient approvals")]
fn test_single_admin_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin1, &members, &100i128, &1000u32);

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

    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin1, &members, &100i128, &1000u32);

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
