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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    let target_amount = 100i128;
    let deadline = 1000u32;

    client.initialize(&token_address, &admin, &members, &target_amount, &deadline);

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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);

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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    // Deadline sequence is 100
    client.initialize(&token_address, &admin, &members, &100i128, &100u32);

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
fn test_add_member_can_deposit() {
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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);

    client.add_member(&admin, &member_c);
    token_client.mint(&member_c, &50i128);
    client.deposit(&member_c, &50i128);

    assert_eq!(client.members().len(), 3);
    assert_eq!(client.balance_of(&member_c), 50);
}

#[test]
#[should_panic(expected = "not a member")]
fn test_removed_member_cannot_deposit() {
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
    let member_c = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    members.push_back(member_c.clone());

    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);

    client.remove_member(&admin, &member_b);
    token_client.mint(&member_b, &50i128);
    client.deposit(&member_b, &50i128);
}

#[test]
fn test_remove_member_refunds_balance() {
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

    client.initialize(&token_address, &admin, &members, &200i128, &1000u32);

    token_client.mint(&member_b, &75i128);
    client.deposit(&member_b, &75i128);

    client.remove_member(&admin, &member_b);

    assert_eq!(token_interface_client.balance(&member_b), 75);
    assert_eq!(client.balance_of(&member_b), 0);
    assert_eq!(client.total_deposited(), 0);
    assert_eq!(client.members().len(), 1);
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

    client.initialize(&token_address, &admin, &members, &100i128, &100u32);

    token_client.mint(&member_a, &100i128);

    // Set ledger sequence to 101 (passed deadline)
    env.ledger().set_sequence_number(101);

    // Should panic
    client.deposit(&member_a, &40i128);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_add_member_fails_when_paused() {
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
    let member_c = Address::generate(&env);
    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());
    client.initialize(&token_address, &admin, &members, &100i128, &1000u32);
    client.pause(&admin);
    client.add_member(&admin, &member_c);
}

#[test]
#[should_panic(expected = "pool paused")]
fn test_remove_member_fails_when_paused() {
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
    client.pause(&admin);
    client.remove_member(&admin, &member_b);
}
