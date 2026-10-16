use soroban_sdk::{contractclient, Address, Env};

/// Interface every yield vault adapter must implement.
///
/// The savings pool depends only on this trait, never on a concrete vault, so
/// any contract that implements it (a mock, a lending market, a tokenised
/// fund) can be plugged in without changing the pool. The pool is responsible
/// for moving the underlying SEP-41 tokens to the vault *before* calling
/// `deposit`; the vault is responsible for reporting `max_redeemable` honestly
/// so callers never request more shares than it can pay for.
#[contractclient(name = "VaultClient")]
pub trait VaultAdapter {
    /// Deposit `amount` of the vault's underlying asset on behalf of `from`.
    /// Returns the number of shares minted.
    fn deposit(env: Env, from: Address, amount: i128) -> i128;

    /// Redeem `shares` and send the proceeds to `to`. Returns the assets paid.
    fn withdraw(env: Env, to: Address, shares: i128) -> i128;

    /// Assets per `SHARE_SCALE` shares, rounded down.
    fn share_price(env: Env) -> i128;

    /// Maximum shares that can be redeemed right now (liquidity-limited).
    fn max_redeemable(env: Env) -> i128;

    /// Total shares outstanding.
    fn total_shares(env: Env) -> i128;

    /// Total assets under management.
    fn total_assets(env: Env) -> i128;
}
