use soroban_sdk::{symbol_short, token, Address, Env, IntoVal};

/// Deposit into a Stellar AMM pool: transfer tokens to pool, then invoke deposit.
/// Funds must already be in this contract before calling.
pub fn amm_deposit(env: &Env, pool: &Address, token: &Address, amount: i128, _to: &Address) -> i128 {
    // Transfer tokens from this contract to the pool
    token::Client::new(env, token)
        .transfer(&env.current_contract_address(), pool, &amount);

    // Notify the pool to record the deposit
    let _: () = env.invoke_contract(
        pool,
        &symbol_short!("deposit"),
        soroban_sdk::vec![
            env,
            token.into_val(env),
            amount.into_val(env),
        ],
    );
    amount
}

/// Withdraw from a Stellar AMM pool: invoke withdraw, pool transfers tokens back.
pub fn amm_withdraw(env: &Env, pool: &Address, token: &Address, amount: i128, to: &Address) -> i128 {
    // Pool transfers tokens directly to `to`
    let recovered: i128 = env.invoke_contract(
        pool,
        &symbol_short!("withdraw"),
        soroban_sdk::vec![
            env,
            token.into_val(env),
            amount.into_val(env),
            to.into_val(env),
        ],
    );
    recovered
}

/// Query the AMM pool for the current position value of `account`.
pub fn get_position_value(env: &Env, pool: &Address, token: &Address, account: &Address) -> i128 {
    env.invoke_contract(
        pool,
        &symbol_short!("get_pos"),
        soroban_sdk::vec![
            env,
            token.into_val(env),
            account.into_val(env),
        ],
    )
}
