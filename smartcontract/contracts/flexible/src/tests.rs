#![cfg(test)]

use super::{FlexiblePool, FlexiblePoolClient};
use soroban_sdk::{
    testutils::Address as _,
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
