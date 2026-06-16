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
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);

    let mut members = Vec::new(&env);
    members.push_back(member_a.clone());
    members.push_back(member_b.clone());

    // Minimum deposit = 10
    client.initialize(
        &token_address,
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
