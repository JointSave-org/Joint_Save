use soroban_sdk::{symbol_short, token, Address, Env, IntoVal};

/// Deposit into Soroswap: transfer tokens to router, then invoke add_liq.
/// Funds must already be in this contract before calling.
pub fn add_liquidity(
    env: &Env,
    router: &Address,
    token_a: &Address,
    _token_b: &Address,
    amount_a: i128,
    _amount_b: i128,
    _to: &Address,
) -> i128 {
    // Transfer tokens from this contract to the router
    token::Client::new(env, token_a)
        .transfer(&env.current_contract_address(), router, &amount_a);

    // Notify the router to record the deposit
    let _: () = env.invoke_contract(
        router,
        &symbol_short!("add_liq"),
        soroban_sdk::vec![
            env,
            token_a.into_val(env),
            amount_a.into_val(env),
        ],
    );
    amount_a
}

/// Withdraw from Soroswap: invoke rem_liq on router, which transfers tokens back.
pub fn remove_liquidity(
    env: &Env,
    router: &Address,
    token_a: &Address,
    _token_b: &Address,
    lp_amount: i128,
    to: &Address,
) -> i128 {
    // Router transfers tokens directly to `to`
    let recovered: i128 = env.invoke_contract(
        router,
        &symbol_short!("rem_liq"),
        soroban_sdk::vec![
            env,
            token_a.into_val(env),
            lp_amount.into_val(env),
            to.into_val(env),
        ],
    );
    recovered
}

/// Query the Soroswap router for the current position value of `account`.
pub fn get_position_value(
    env: &Env,
    router: &Address,
    token_a: &Address,
    _token_b: &Address,
    account: &Address,
) -> i128 {
    env.invoke_contract(
        router,
        &symbol_short!("get_pos"),
        soroban_sdk::vec![
            env,
            token_a.into_val(env),
            account.into_val(env),
        ],
    )
}
