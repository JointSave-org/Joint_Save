use crate::mock::{MockVault, MockVaultClient};
use crate::types::SHARE_SCALE;
use soroban_sdk::{testutils::Address as _, token, Address, Env};

struct Fixture {
    contract_id: Address,
    client: MockVaultClient<'static>,
    token: token::Client<'static>,
    token_admin: token::StellarAssetClient<'static>,
    admin: Address,
    depositor: Address,
}

fn setup(env: &Env) -> Fixture {
    env.mock_all_auths();

    let contract_id = env.register_contract(None, MockVault);
    let client = MockVaultClient::new(env, &contract_id);

    let token_admin_addr = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
    let token_addr = sac.address();
    let token = token::Client::new(env, &token_addr);
    let token_admin = token::StellarAssetClient::new(env, &token_addr);

    let admin = Address::generate(env);
    client.initialize(&admin, &token_addr);

    let depositor = Address::generate(env);

    Fixture {
        contract_id,
        client,
        token,
        token_admin,
        admin,
        depositor,
    }
}

/// Fund `who` and move the tokens into the vault, then call `deposit`.
fn deposit(f: &Fixture, who: &Address, amount: i128) -> i128 {
    f.token_admin.mint(who, &amount);
    f.token.transfer(who, &f.contract_id, &amount);
    f.client.deposit(who, &amount)
}

#[test]
fn first_deposit_mints_one_to_one() {
    let env = Env::default();
    let f = setup(&env);
    let shares = deposit(&f, &f.depositor, 1_000);
    assert_eq!(shares, 1_000);
    assert_eq!(f.client.total_shares(), 1_000);
    assert_eq!(f.client.total_assets(), 1_000);
    assert_eq!(f.client.share_price(), SHARE_SCALE);
    assert_eq!(f.client.balance_of(&f.depositor), 1_000);
}

#[test]
fn yield_raises_share_price_and_redemption_value() {
    let env = Env::default();
    let f = setup(&env);
    deposit(&f, &f.depositor, 1_000);

    // Simulate 10% yield by minting the asset straight into the vault.
    f.token_admin.mint(&f.contract_id, &100);

    // 1100 assets / 1000 shares -> 1.1 * SHARE_SCALE
    assert_eq!(f.client.share_price(), SHARE_SCALE * 11 / 10);

    let before = f.token.balance(&f.depositor);
    let assets = f.client.withdraw(&f.depositor, &1_000);
    // Floor division: 1000 * 1100 / 1000 == 1100.
    assert_eq!(assets, 1_100);
    assert_eq!(f.token.balance(&f.depositor), before + 1_100);
    assert_eq!(f.client.total_shares(), 0);
}

#[test]
fn withdrawal_rounds_down_in_the_vaults_favour() {
    let env = Env::default();
    let f = setup(&env);
    deposit(&f, &f.depositor, 3); // 3 shares
    f.token_admin.mint(&f.contract_id, &1); // 4 assets / 3 shares

    let assets = f.client.withdraw(&f.depositor, &1);
    // 1 * 4 / 3 == 1 (floored, remainder stays in the vault).
    assert_eq!(assets, 1);
    assert_eq!(f.client.total_shares(), 2);
    assert_eq!(f.client.total_assets(), 3);
}

#[test]
fn max_redeemable_respects_locked_assets() {
    let env = Env::default();
    let f = setup(&env);
    deposit(&f, &f.depositor, 1_000);
    assert_eq!(f.client.max_redeemable(), 1_000);

    f.client.set_locked_assets(&f.admin, &400);
    // 600 of 1000 assets are liquid -> 600 shares are redeemable.
    assert_eq!(f.client.max_redeemable(), 600);

    f.client.set_locked_assets(&f.admin, &10_000);
    assert_eq!(f.client.max_redeemable(), 0);
}
