use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum StrategyType {
    Soroswap,
    StellarAmm,
}

#[contracttype]
#[derive(Clone)]
pub struct StrategyConfig {
    pub strategy_type: StrategyType,
    /// DEX/AMM router address
    pub router: Address,
    /// The paired token (e.g. USDC) for the liquidity pair
    pub paired_token: Address,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Strategy,
    DeployedAmount,
    TotalHarvested,
}
