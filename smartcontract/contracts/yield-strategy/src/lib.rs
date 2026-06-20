#![no_std]

mod events;
mod types;
mod soroswap;
#[path = "stellar-amm.rs"]
mod stellar_amm;

use soroban_sdk::{contract, contractimpl, token, Address, Env};
use types::{DataKey, StrategyConfig, StrategyType};

#[contract]
pub struct YieldStrategy;

#[contractimpl]
impl YieldStrategy {
    /// One-time setup.
    pub fn initialize(env: Env, admin: Address, token: Address, config: StrategyConfig) {
        assert!(
            !env.storage().persistent().has(&DataKey::Admin),
            "already initialized"
        );
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Token, &token);
        env.storage().persistent().set(&DataKey::Strategy, &config);
        env.storage().persistent().set(&DataKey::DeployedAmount, &0i128);
        env.storage().persistent().set(&DataKey::TotalHarvested, &0i128);
    }

    /// Deploy `amount` into the DeFi protocol via the configured strategy.
    /// Caller (flexible pool) must have already transferred `amount` tokens
    /// into this contract before invoking — funds flow: pool → this contract → protocol.
    pub fn deploy(env: Env, amount: i128) {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let token: Address = env.storage().persistent().get(&DataKey::Token).unwrap();
        let config: StrategyConfig = env.storage().persistent().get(&DataKey::Strategy).unwrap();

        // Funds are already in this contract (transferred by flexible pool before this call).
        // Route them into the configured protocol — funds leave this contract here.
        match config.strategy_type {
            StrategyType::Soroswap => {
                soroswap::add_liquidity(
                    &env,
                    &config.router,
                    &token,
                    &config.paired_token,
                    amount,
                    0,
                    &env.current_contract_address(),
                );
            }
            StrategyType::StellarAmm => {
                stellar_amm::amm_deposit(
                    &env,
                    &config.router,
                    &token,
                    amount,
                    &env.current_contract_address(),
                );
            }
        }

        let prev: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::DeployedAmount)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::DeployedAmount, &(prev + amount));

        events::deployed(&env, amount);
    }

    /// Harvest yield by querying the protocol for the current position value,
    /// computing yield = current_value − deployed_principal, then withdrawing
    /// only the yield portion back to the admin (flexible pool).
    pub fn harvest(env: Env) -> i128 {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let token: Address = env.storage().persistent().get(&DataKey::Token).unwrap();
        let config: StrategyConfig = env.storage().persistent().get(&DataKey::Strategy).unwrap();
        let deployed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::DeployedAmount)
            .unwrap_or(0);
        assert!(deployed > 0, "nothing deployed");

        // Query the protocol for the current position value of this contract
        let current_value: i128 = match config.strategy_type {
            StrategyType::Soroswap => soroswap::get_position_value(
                &env,
                &config.router,
                &token,
                &config.paired_token,
                &env.current_contract_address(),
            ),
            StrategyType::StellarAmm => stellar_amm::get_position_value(
                &env,
                &config.router,
                &token,
                &env.current_contract_address(),
            ),
        };

        // Yield is any value above the deployed principal
        let yield_amount = current_value.saturating_sub(deployed);
        assert!(yield_amount > 0, "no yield available");

        // Withdraw only the yield portion from the protocol
        match config.strategy_type {
            StrategyType::Soroswap => {
                soroswap::remove_liquidity(
                    &env,
                    &config.router,
                    &token,
                    &config.paired_token,
                    yield_amount,
                    &env.current_contract_address(),
                );
            }
            StrategyType::StellarAmm => {
                stellar_amm::amm_withdraw(
                    &env,
                    &config.router,
                    &token,
                    yield_amount,
                    &env.current_contract_address(),
                );
            }
        }

        // Forward yield to admin (flexible pool) for distribution
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &admin,
            &yield_amount,
        );

        let prev: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalHarvested)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::TotalHarvested, &(prev + yield_amount));

        events::harvested(&env, yield_amount);
        yield_amount
    }

    /// Emergency: withdraw all deployed funds from the protocol back to admin.
    /// Calls the protocol's withdraw/remove_liquidity with the full deployed amount.
    pub fn emergency_withdraw(env: Env) -> i128 {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let deployed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::DeployedAmount)
            .unwrap_or(0);
        assert!(deployed > 0, "nothing deployed");

        let token: Address = env.storage().persistent().get(&DataKey::Token).unwrap();
        let config: StrategyConfig = env.storage().persistent().get(&DataKey::Strategy).unwrap();

        // Withdraw full position from the protocol back to this contract
        match config.strategy_type {
            StrategyType::Soroswap => {
                soroswap::remove_liquidity(
                    &env,
                    &config.router,
                    &token,
                    &config.paired_token,
                    deployed,
                    &env.current_contract_address(),
                );
            }
            StrategyType::StellarAmm => {
                stellar_amm::amm_withdraw(
                    &env,
                    &config.router,
                    &token,
                    deployed,
                    &env.current_contract_address(),
                );
            }
        }

        // Forward recovered funds to admin
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &admin,
            &deployed,
        );

        env.storage()
            .persistent()
            .set(&DataKey::DeployedAmount, &0i128);

        events::emergency_exit(&env, deployed);
        deployed
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn deployed_amount(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::DeployedAmount)
            .unwrap_or(0)
    }

    pub fn total_harvested(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalHarvested)
            .unwrap_or(0)
    }

    pub fn strategy_config(env: Env) -> StrategyConfig {
        env.storage().persistent().get(&DataKey::Strategy).unwrap()
    }
}

#[cfg(test)]
mod tests;
