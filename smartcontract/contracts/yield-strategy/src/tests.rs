#![cfg(test)]

use super::{YieldStrategy, YieldStrategyClient};
use crate::types::{StrategyConfig, StrategyType};
use soroban_sdk::{testutils::Address as _, token, Address, Env};

// ── Mock Soroswap router ──────────────────────────────────────────────────────

mod mock_soroswap {
    use soroban_sdk::{contract, contractimpl, token, Address, Env};

    #[contract]
    pub struct MockSoroswapRouter;

    #[contractimpl]
    impl MockSoroswapRouter {
        /// Tokens are already transferred to this contract before add_liq is called.
        pub fn add_liq(_env: Env, _token: Address, _amount: i128) {}

        /// Transfer `amount` tokens from this router back to `to`.
        pub fn rem_liq(env: Env, token: Address, amount: i128, to: Address) -> i128 {
            token::Client::new(&env, &token)
                .transfer(&env.current_contract_address(), &to, &amount);
            amount
        }

        /// Return simulated position value: principal + 50 yield.
        pub fn get_pos(_env: Env, _token: Address, _account: Address) -> i128 {
            550
        }
    }
}
pub use mock_soroswap::MockSoroswapRouter;

// ── Mock Stellar AMM pool ─────────────────────────────────────────────────────

mod mock_amm {
    use soroban_sdk::{contract, contractimpl, token, Address, Env};

    #[contract]
    pub struct MockAmmPool;

    #[contractimpl]
    impl MockAmmPool {
        /// Tokens are already transferred to this pool before deposit is called.
        pub fn deposit(_env: Env, _token: Address, _amount: i128) {}

        /// Transfer `amount` tokens from this pool back to `to`.
        pub fn withdraw(env: Env, token: Address, amount: i128, to: Address) -> i128 {
            token::Client::new(&env, &token)
                .transfer(&env.current_contract_address(), &to, &amount);
            amount
        }

        pub fn get_pos(_env: Env, _token: Address, _account: Address) -> i128 {
            550
        }
    }
}
pub use mock_amm::MockAmmPool;

// ── Test helpers ──────────────────────────────────────────────────────────────

fn setup_soroswap(env: &Env) -> (YieldStrategyClient<'static>, Address, Address, Address) {
    let contract_id = env.register_contract(None, YieldStrategy);
    let client = YieldStrategyClient::new(env, &contract_id);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(env, &token_address);

    let admin = Address::generate(env);
    let router_id = env.register_contract(None, MockSoroswapRouter);

    token_client.mint(&admin, &10_000i128);
    // Mint into router to simulate protocol holding funds for withdrawals/harvest
    token_client.mint(&router_id, &5_000i128);
    // Pre-mint into strategy contract to simulate flexible pool pre-transfer before deploy()
    token_client.mint(&contract_id, &5_000i128);

    let config = StrategyConfig {
        strategy_type: StrategyType::Soroswap,
        router: router_id.clone(),
        paired_token: token_address.clone(),
    };
    client.initialize(&admin, &token_address, &config);

    (client, admin, token_address, router_id)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_deploy_and_deployed_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token, _router) = setup_soroswap(&env);

    client.deploy(&500i128);
    assert_eq!(client.deployed_amount(), 500);
}

#[test]
fn test_harvest_yield_from_protocol() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token, _router) = setup_soroswap(&env);

    client.deploy(&500i128);
    // get_pos returns 550, deployed = 500, so yield = 50
    let harvested = client.harvest();
    assert_eq!(harvested, 50);
    assert_eq!(client.total_harvested(), 50);
    // deployed principal unchanged (only yield portion withdrawn)
    assert_eq!(client.deployed_amount(), 500);
}

#[test]
fn test_emergency_withdraw_calls_protocol() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token, _router) = setup_soroswap(&env);

    client.deploy(&500i128);
    let withdrawn = client.emergency_withdraw();
    assert_eq!(withdrawn, 500);
    assert_eq!(client.deployed_amount(), 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, router) = setup_soroswap(&env);
    let config = StrategyConfig {
        strategy_type: StrategyType::StellarAmm,
        router,
        paired_token: token_address.clone(),
    };
    client.initialize(&admin, &token_address, &config);
}

#[test]
#[should_panic(expected = "nothing deployed")]
fn test_emergency_withdraw_nothing() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token, _router) = setup_soroswap(&env);
    client.emergency_withdraw();
}

#[test]
fn test_stellar_amm_strategy() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, YieldStrategy);
    let client = YieldStrategyClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract.address();
    let token_client = token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let pool_id = env.register_contract(None, MockAmmPool);

    token_client.mint(&admin, &5_000i128);
    token_client.mint(&pool_id, &5_000i128);
    // Pre-mint into strategy contract (simulates flexible pool pre-transfer)
    token_client.mint(&contract_id, &5_000i128);

    let config = StrategyConfig {
        strategy_type: StrategyType::StellarAmm,
        router: pool_id.clone(),
        paired_token: token_address.clone(),
    };
    client.initialize(&admin, &token_address, &config);

    // Deploy 500 → get_pos returns 550 → yield = 50
    client.deploy(&500i128);
    assert_eq!(client.deployed_amount(), 500);

    let harvested = client.harvest();
    assert_eq!(harvested, 50);
    assert_eq!(client.total_harvested(), 50);
}

#[test]
#[should_panic(expected = "no yield available")]
fn test_harvest_no_yield() {
    let env = Env::default();
    env.mock_all_auths();
    // Deploy more than what get_pos returns (550) so yield = 0
    let (client, _admin, _token, _router) = setup_soroswap(&env);
    client.deploy(&600i128); // deployed=600, get_pos=550, yield=-50 → "no yield available"
    client.harvest();
}
