use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

use crate::events;
use crate::types::SHARE_SCALE;

/// Storage keys for the mock vault. Kept private to this contract.
#[contracttype]
pub enum MockVaultKey {
    Admin,
    Token,
    TotalShares,
    Locked,
    Shares(Address),
}

/// A deliberately simple, self-contained vault that satisfies `VaultAdapter`.
///
/// It exists for tests and local development only: it holds a single SEP-41
/// asset, mints shares 1:1 on the first deposit, and reports a live share price
/// from its token balance. Tests can simulate yield by minting the underlying
/// token to the vault, and simulate illiquidity with `set_locked_assets`.
/// It is **not** a production vault.
#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    pub fn initialize(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        assert!(!storage.has(&MockVaultKey::Admin), "already initialized");
        storage.set(&MockVaultKey::Admin, &admin);
        storage.set(&MockVaultKey::Token, &token);
        storage.set(&MockVaultKey::TotalShares, &0i128);
        storage.set(&MockVaultKey::Locked, &0i128);
    }

    /// Deposit `amount` of the underlying asset held on behalf of `from`.
    /// The caller must have transferred `amount` tokens to this contract first.
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().persistent();
        let token_addr: Address = storage.get(&MockVaultKey::Token).expect("not initialized");
        let total_shares: i128 = storage.get(&MockVaultKey::TotalShares).unwrap_or(0);
        let total_assets =
            token::Client::new(&env, &token_addr).balance(&env.current_contract_address());

        // Assets already held *before* this deposit (the pool transfers first).
        let pre_assets = total_assets - amount;
        let shares = if total_shares == 0 || pre_assets <= 0 {
            amount
        } else {
            amount * total_shares / pre_assets
        };

        let holder_key = MockVaultKey::Shares(from.clone());
        let held: i128 = storage.get(&holder_key).unwrap_or(0);
        storage.set(&holder_key, &(held + shares));
        storage.set(&MockVaultKey::TotalShares, &(total_shares + shares));

        events::deposited(&env, &from, amount, shares);
        shares
    }

    /// Redeem `shares` owned by `to` and send the proceeds to `to`.
    pub fn withdraw(env: Env, to: Address, shares: i128) -> i128 {
        to.require_auth();
        assert!(shares > 0, "shares must be > 0");

        let storage = env.storage().persistent();
        let token_addr: Address = storage.get(&MockVaultKey::Token).expect("not initialized");
        let total_shares: i128 = storage.get(&MockVaultKey::TotalShares).unwrap_or(0);
        assert!(total_shares > 0, "no shares");

        let holder_key = MockVaultKey::Shares(to.clone());
        let held: i128 = storage.get(&holder_key).unwrap_or(0);
        assert!(held >= shares, "insufficient shares");

        let total_assets =
            token::Client::new(&env, &token_addr).balance(&env.current_contract_address());
        // Floor division favours the vault, never the withdrawing member.
        let assets = shares * total_assets / total_shares;

        storage.set(&holder_key, &(held - shares));
        storage.set(&MockVaultKey::TotalShares, &(total_shares - shares));

        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &to,
            &assets,
        );

        events::withdrew(&env, &to, shares, assets);
        assets
    }

    /// Simulate illiquidity: `amount` assets are excluded from redemptions.
    pub fn set_locked_assets(env: Env, admin: Address, amount: i128) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&MockVaultKey::Admin).expect("not initialized");
        assert!(admin == stored_admin, "not admin");
        assert!(amount >= 0, "amount must be >= 0");
        storage.set(&MockVaultKey::Locked, &amount);
        events::vault_locked(&env, amount);
    }

    // ── VaultAdapter views ────────────────────────────────────────────────

    pub fn total_assets(env: Env) -> i128 {
        let storage = env.storage().persistent();
        let token_addr: Address = storage.get(&MockVaultKey::Token).expect("not initialized");
        token::Client::new(&env, &token_addr).balance(&env.current_contract_address())
    }

    pub fn total_shares(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&MockVaultKey::TotalShares)
            .unwrap_or(0)
    }

    pub fn share_price(env: Env) -> i128 {
        let total_shares = Self::total_shares(env.clone());
        if total_shares == 0 {
            return SHARE_SCALE;
        }
        Self::total_assets(env) * SHARE_SCALE / total_shares
    }

    pub fn max_redeemable(env: Env) -> i128 {
        let total_shares = Self::total_shares(env.clone());
        if total_shares == 0 {
            return 0;
        }
        let total_assets = Self::total_assets(env.clone());
        if total_assets <= 0 {
            return 0;
        }
        let locked: i128 = env
            .storage()
            .persistent()
            .get(&MockVaultKey::Locked)
            .unwrap_or(0);
        let available = if total_assets > locked {
            total_assets - locked
        } else {
            0
        };
        let shares = available * total_shares / total_assets;
        if shares > total_shares {
            total_shares
        } else {
            shares
        }
    }

    pub fn balance_of(env: Env, who: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&MockVaultKey::Shares(who))
            .unwrap_or(0)
    }
}
