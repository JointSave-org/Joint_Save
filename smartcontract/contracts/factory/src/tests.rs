#![cfg(test)]

use super::{JointSaveFactory, JointSaveFactoryClient};
use soroban_sdk::{testutils::Address as _, Address, Env, BytesN};
use soroban_sdk::testutils::storage::Persistent;

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Call initialize
    env.mock_all_auths();
    client.initialize(&admin, &token, &treasury);

    // Verify token and treasury matches initialized values
    assert_eq!(client.token(), token);
    assert_eq!(client.treasury(), treasury);
}

#[test]
fn test_registration() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token, &treasury);

    let caller = Address::generate(&env);

    // Initial lists should be empty
    assert_eq!(client.all_rotational().len(), 0);
    assert_eq!(client.all_target().len(), 0);
    assert_eq!(client.all_flexible().len(), 0);

    // Register a rotational pool
    let pool_id_1 = BytesN::from_array(&env, &[1; 32]);
    client.register_rotational(&caller, &pool_id_1);
    assert_eq!(client.all_rotational().len(), 1);
    assert_eq!(client.all_rotational().get(0).unwrap(), pool_id_1);

    // Register a target pool
    let pool_id_2 = BytesN::from_array(&env, &[2; 32]);
    client.register_target(&caller, &pool_id_2);
    assert_eq!(client.all_target().len(), 1);
    assert_eq!(client.all_target().get(0).unwrap(), pool_id_2);

    // Register a flexible pool
    let pool_id_3 = BytesN::from_array(&env, &[3; 32]);
    client.register_flexible(&caller, &pool_id_3);
    assert_eq!(client.all_flexible().len(), 1);
    assert_eq!(client.all_flexible().get(0).unwrap(), pool_id_3);
}

#[test]
fn test_set_treasury() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token, &treasury);

    let new_treasury = Address::generate(&env);
    client.set_treasury(&new_treasury);
    assert_eq!(client.treasury(), new_treasury);
}

#[test]
#[should_panic]
fn test_set_treasury_unauthorized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Set state in storage directly
    env.as_contract(&contract_id, || {
        let storage = env.storage().persistent();
        storage.set(&super::DataKey::Admin, &admin);
        storage.set(&super::DataKey::Treasury, &treasury);
    });

    let new_treasury = Address::generate(&env);
    // This should panic because mock_all_auths() is not set and admin did not sign
    client.set_treasury(&new_treasury);
}

#[test]
fn test_pause_all() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token, &treasury);

    // pause_all should succeed when called by admin
    client.pause_all(&admin);
    // No state change to assert — just must not panic
}

#[test]
#[should_panic(expected = "not admin")]
fn test_pause_all_unauthorized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);
    let stranger = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token, &treasury);

    // Non-admin should be rejected
    client.pause_all(&stranger);
}

#[test]
fn test_bump_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token, &treasury);

    // Call bump_state
    client.bump_state();

    // Verify Admin key TTL was extended
    env.as_contract(&contract_id, || {
        let ttl = env.storage().persistent().get_ttl(&super::DataKey::Admin);
        assert!(ttl >= 2592000);
    });
}



