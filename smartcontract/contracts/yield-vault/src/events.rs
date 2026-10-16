use soroban_sdk::{symbol_short, Address, Env};

/// Emitted when the pool's capital is moved into a vault.
pub fn allocated(env: &Env, vault: &Address, amount: i128, shares: i128) {
    env.events().publish(
        (symbol_short!("ya_alloc"),),
        (vault.clone(), amount, shares),
    );
}

/// Emitted when the pool's capital is pulled back out of a vault.
pub fn deallocated(env: &Env, requested: i128, received: i128, shares_burned: i128) {
    env.events().publish(
        (symbol_short!("ya_deall"),),
        (requested, received, shares_burned),
    );
}

/// Emitted when realised yield is credited to the pot.
pub fn synced(env: &Env, yield_amount: i128) {
    env.events()
        .publish((symbol_short!("ya_sync"),), yield_amount);
}

/// Emitted when the liquidity buffer is changed.
pub fn buffer_set(env: &Env, bps: u32) {
    env.events().publish((symbol_short!("ya_bufset"),), bps);
}

/// Emitted when the pool enters or leaves de-allocation-only mode.
pub fn lock_set(env: &Env, locked: bool) {
    env.events().publish((symbol_short!("ya_locked"),), locked);
}

/// Emitted by a vault when it mints shares for a deposit.
pub fn deposited(env: &Env, from: &Address, amount: i128, shares: i128) {
    env.events().publish(
        (symbol_short!("deposited"),),
        (from.clone(), amount, shares),
    );
}

/// Emitted by a vault when it burns shares and pays out assets.
pub fn withdrew(env: &Env, to: &Address, shares: i128, assets: i128) {
    env.events()
        .publish((symbol_short!("withdrew"),), (to.clone(), shares, assets));
}

/// Emitted by a vault when its locked (illiquid) assets change.
pub fn vault_locked(env: &Env, amount: i128) {
    env.events().publish((symbol_short!("v_locked"),), amount);
}
