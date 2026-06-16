#![cfg(test)]

use super::{JointSaveFactory, JointSaveFactoryClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

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
