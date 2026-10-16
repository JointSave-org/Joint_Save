#![no_std]
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, IntoVal, Symbol, Vec,
};

use jointsave_yield_vault::{VaultClient, BPS_DENOMINATOR, DEFAULT_BUFFER_BPS, SHARE_SCALE};

const VERSION: u32 = 1;

#[contracttype]
pub enum DataKey {
    Token,
    Admin,
    Treasury,
    Members,
    MinimumDeposit,
    WithdrawalFeeBps,
    TreasuryFeeBps,
    YieldEnabled,
    TotalBalance,
    Active,
    Paused,
    Balance(Address),
    YieldStrategy,
    DeployedToYield,
    TokenDecimals,
    MigratedFrom,
    /// Optional address of the on-chain ReputationTracker contract.
    ReputationTracker,
    /// Optional allowlist of accepted token addresses (empty = unrestricted).
    SupportedTokens,
    /// Optional address of the attached DAO governance contract.
    GovernanceContract,
    /// Late/missed-deposit penalty percentage governable by the DAO (0-100).
    PenaltyPercentage,
    /// Address of the yield vault holding this pool's allocated capital.
    YieldVault,
    /// Shares the pool holds in the yield vault.
    YieldShares,
    /// Assets the pool has deposited into the vault (cost basis).
    YieldCostBasis,
    /// Minimum liquid share of the pot, in basis points (default 2000 = 20%).
    YieldBufferBps,
    /// When true, no new allocation is permitted (de-allocation only).
    YieldLocked,
}

const LEDGER_THRESHOLD: u32 = 518400;
const LEDGER_BUMP: u32 = 2592000;

#[contract]
pub struct FlexiblePool;

#[contractimpl]
impl FlexiblePool {
    pub fn initialize(
        env: Env,
        token: Address,
        admin: Address,
        members: Vec<Address>,
        minimum_deposit: i128,
        withdrawal_fee_bps: u32,
        yield_enabled: bool,
        treasury: Address,
        treasury_fee_bps: u32,
    ) {
        assert!(members.len() >= 2, "need >=2 members");
        assert!(
            !Self::has_duplicate_members(&members),
            "duplicate member address"
        );
        assert!(minimum_deposit > 0, "minimum must be > 0");

        // Validate the token is a real SEP-41 contract by reading its decimals
        // (this call traps for a non-token address) and remember it for display.
        let decimals = token::Client::new(&env, &token).decimals();

        let storage = env.storage().persistent();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::TokenDecimals, &decimals);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Treasury, &treasury);
        storage.set(&DataKey::Members, &members);
        storage.set(&DataKey::MinimumDeposit, &minimum_deposit);
        storage.set(&DataKey::WithdrawalFeeBps, &withdrawal_fee_bps);
        storage.set(&DataKey::TreasuryFeeBps, &treasury_fee_bps);
        storage.set(&DataKey::YieldEnabled, &yield_enabled);
        storage.set(&DataKey::TotalBalance, &0i128);
        storage.set(&DataKey::Active, &true);
        storage.set(&DataKey::Paused, &false);
        storage.set(&DataKey::DeployedToYield, &0i128);

        Self::bump_config_state_internal(&env);
    }

    pub fn deposit(env: Env, member: Address, amount: i128) {
        member.require_auth();

        let storage = env.storage().persistent();
        let active: bool = storage.get(&DataKey::Active).unwrap();
        assert!(active, "pool inactive");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");

        let min: i128 = storage.get(&DataKey::MinimumDeposit).unwrap();
        assert!(amount >= min, "below minimum deposit");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        Self::assert_token_supported(&env, &token_addr);
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&member, &env.current_contract_address(), &amount);

        let prev: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        storage.set(&DataKey::Balance(member.clone()), &(prev + amount));

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        storage.set(&DataKey::TotalBalance, &(total + amount));

        let bal_key = DataKey::Balance(member.clone());
        storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::bump_config_state_internal(&env);

        // Report successful deposit to reputation tracker (best-effort)
        Self::report_update_score(&env, &member, true, false);

        env.events()
            .publish((symbol_short!("deposit"), member), amount);
    }

    pub fn withdraw(env: Env, member: Address, amount: i128) {
        member.require_auth();

        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        assert!(balance >= amount, "insufficient balance");

        let fee_bps: u32 = storage.get(&DataKey::WithdrawalFeeBps).unwrap();
        let fee = (amount * fee_bps as i128) / 10000;
        let net = amount - fee;

        storage.set(&DataKey::Balance(member.clone()), &(balance - amount));
        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        storage.set(&DataKey::TotalBalance, &(total - amount));

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let treasury: Address = storage.get(&DataKey::Treasury).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        // If capital is deployed to the vault, pull back just enough to cover
        // this withdrawal. A partially-filled redemption still counts; only if
        // the pot is left genuinely short do we revert, so funds are never
        // trapped but members can always withdraw what the vault can return.
        let liquid = token_client.balance(&env.current_contract_address());
        if liquid < net {
            Self::deallocate_internal(&env, net - liquid);
            let liquid_after = token_client.balance(&env.current_contract_address());
            assert!(liquid_after >= net, "vault illiquid");
        }

        if fee > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee);
        }
        token_client.transfer(&env.current_contract_address(), &member, &net);

        let bal_key = DataKey::Balance(member.clone());
        storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("withdraw"), member), net);
    }

    /// Distribute yield proportionally to all members with a balance.
    pub fn distribute_yield(env: Env, admin: Address, yield_amount: i128) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let yield_enabled: bool = storage.get(&DataKey::YieldEnabled).unwrap_or(false);
        assert!(yield_enabled, "yield disabled");
        assert!(yield_amount > 0, "yield must be > 0");

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        assert!(total > 0, "no balance");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        for m in members.iter() {
            let bal: i128 = storage.get(&DataKey::Balance(m.clone())).unwrap_or(0);
            if bal > 0 {
                let member_yield = (yield_amount * bal) / total;
                let bal_key = DataKey::Balance(m.clone());
                storage.set(&bal_key, &(bal + member_yield));
                storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }

        storage.set(&DataKey::TotalBalance, &(total + yield_amount));
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("yield"),), yield_amount);
    }

    pub fn add_member(env: Env, admin: Address, new_member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let mut members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(!Self::is_member(&members, &new_member), "already a member");

        members.push_back(new_member.clone());
        storage.set(&DataKey::Members, &members);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("add_mem"), new_member), ());
    }

    pub fn remove_member(env: Env, admin: Address, member: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");
        assert!(members.len() > 1, "need >=1 members");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        if balance > 0 {
            let token_addr: Address = storage.get(&DataKey::Token).unwrap();
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &member,
                &balance,
            );

            let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
            storage.set(&DataKey::TotalBalance, &(total - balance));
            storage.set(&DataKey::Balance(member.clone()), &0i128);
        }

        let mut updated_members: Vec<Address> = Vec::new(&env);
        for existing in members.iter() {
            if existing != member {
                updated_members.push_back(existing);
            }
        }

        storage.set(&DataKey::Members, &updated_members);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("rem_mem"), member), balance);
    }

    pub fn leave_pool(env: Env, member: Address) {
        member.require_auth();

        let storage = env.storage().persistent();
        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &member), "not a member");
        assert!(members.len() > 1, "need >=1 members");

        let balance: i128 = storage.get(&DataKey::Balance(member.clone())).unwrap_or(0);
        if balance > 0 {
            let token_addr: Address = storage.get(&DataKey::Token).unwrap();
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &member,
                &balance,
            );

            let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
            storage.set(&DataKey::TotalBalance, &(total - balance));
            storage.set(&DataKey::Balance(member.clone()), &0i128);
        }

        let mut updated_members: Vec<Address> = Vec::new(&env);
        for existing in members.iter() {
            if existing != member {
                updated_members.push_back(existing);
            }
        }

        storage.set(&DataKey::Members, &updated_members);
        Self::bump_config_state_internal(&env);
        env.events()
            .publish((symbol_short!("rem_mem"), member), balance);
    }

    // ── Emergency controls ────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        storage.set(&DataKey::Paused, &true);

        Self::bump_config_state_internal(&env);

        env.events().publish((symbol_short!("paused"),), ());
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        storage.set(&DataKey::Paused, &false);

        Self::bump_config_state_internal(&env);

        env.events().publish((symbol_short!("unpaused"),), ());
    }

    // ── Token allowlist ───────────────────────────────────────────────────

    /// Set the tokens this pool is allowed to accept deposits in (e.g. the
    /// native XLM SAC and USDC's SAC on Stellar). Admin-only. An empty list
    /// (the default) leaves the pool unrestricted — it only ever holds the
    /// single token chosen at `initialize()`.
    pub fn set_supported_tokens(env: Env, admin: Address, tokens: Vec<Address>) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        storage.set(&DataKey::SupportedTokens, &tokens);
        storage.extend_ttl(&DataKey::SupportedTokens, LEDGER_THRESHOLD, LEDGER_BUMP);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("sup_tok"), admin), tokens.len());
    }

    pub fn emergency_withdraw(env: Env, admin: Address, recipient: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(paused, "pool not paused");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let contract_balance = token_client.balance(&env.current_contract_address());

        if contract_balance > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &recipient,
                &contract_balance,
            );
        }

        storage.set(&DataKey::TotalBalance, &0i128);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("emrg_wd"),), contract_balance);
    }

    /// Migrate this contract to a new version. Admin-only.
    /// Version must be incremented by exactly 1. Running migrate() with
    /// `to_version` equal to the current version is a safe no-op (idempotent).
    pub fn migrate(env: Env, admin: Address, to_version: u32) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let current = VERSION;
        if to_version == current {
            return;
        }
        assert!(
            to_version == current + 1,
            "version must be incremented by exactly 1"
        );

        // Future migration logic goes here
        env.events()
            .publish((symbol_short!("migrated"), admin), to_version);
    }

    // ── Yield strategy ────────────────────────────────────────────────────

    /// Set the yield strategy contract address. Treasury-only, requires yield_enabled.
    pub fn set_yield_strategy(env: Env, admin: Address, strategy: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        let yield_enabled: bool = storage.get(&DataKey::YieldEnabled).unwrap_or(false);
        assert!(yield_enabled, "yield disabled");
        storage.set(&DataKey::YieldStrategy, &strategy);

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("set_strat"),), strategy);
    }

    /// Deploy `amount` of pool funds to the yield strategy contract.
    pub fn deploy_to_yield(env: Env, admin: Address, amount: i128) {
        admin.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let strategy: Address = storage
            .get(&DataKey::YieldStrategy)
            .expect("no strategy set");

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
        assert!(total >= amount, "insufficient pool balance");

        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &strategy,
            &amount,
        );

        let _: () = env.invoke_contract(
            &strategy,
            &symbol_short!("deploy"),
            soroban_sdk::vec![&env, soroban_sdk::IntoVal::into_val(&amount, &env)],
        );

        let deployed: i128 = storage.get(&DataKey::DeployedToYield).unwrap_or(0);
        storage.set(&DataKey::DeployedToYield, &(deployed + amount));

        Self::bump_config_state_internal(&env);

        env.events().publish((symbol_short!("deployed"),), amount);
    }

    /// Harvest yield from the strategy and distribute proportionally.
    pub fn harvest_yield(env: Env, admin: Address) {
        admin.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        let strategy: Address = storage
            .get(&DataKey::YieldStrategy)
            .expect("no strategy set");

        let yield_amount: i128 = env.invoke_contract(
            &strategy,
            &symbol_short!("harvest"),
            soroban_sdk::vec![&env],
        );

        if yield_amount > 0 {
            let total: i128 = storage.get(&DataKey::TotalBalance).unwrap();
            let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
            for m in members.iter() {
                let bal: i128 = storage.get(&DataKey::Balance(m.clone())).unwrap_or(0);
                if bal > 0 && total > 0 {
                    let share = (yield_amount * bal) / total;
                    let bal_key = DataKey::Balance(m.clone());
                    storage.set(&bal_key, &(bal + share));
                    storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
            storage.set(&DataKey::TotalBalance, &(total + yield_amount));
            env.events()
                .publish((symbol_short!("harvested"),), yield_amount);
        }

        Self::bump_config_state_internal(&env);
    }

    pub fn bump_state(env: Env) {
        Self::bump_config_state_internal(&env);
        let storage = env.storage().persistent();
        if storage.has(&DataKey::Members) {
            let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
            for member in members.iter() {
                let key = DataKey::Balance(member.clone());
                if storage.has(&key) {
                    storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
        }
    }

    fn bump_config_state_internal(env: &Env) {
        let storage = env.storage().persistent();
        storage.extend_ttl(&DataKey::Token, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Admin, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Treasury, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Members, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::MinimumDeposit, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::WithdrawalFeeBps, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::TreasuryFeeBps, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::YieldEnabled, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::TotalBalance, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Active, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::Paused, LEDGER_THRESHOLD, LEDGER_BUMP);
        storage.extend_ttl(&DataKey::DeployedToYield, LEDGER_THRESHOLD, LEDGER_BUMP);

        if storage.has(&DataKey::YieldStrategy) {
            storage.extend_ttl(&DataKey::YieldStrategy, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::ReputationTracker) {
            storage.extend_ttl(&DataKey::ReputationTracker, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::SupportedTokens) {
            storage.extend_ttl(&DataKey::SupportedTokens, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::GovernanceContract) {
            storage.extend_ttl(&DataKey::GovernanceContract, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::PenaltyPercentage) {
            storage.extend_ttl(&DataKey::PenaltyPercentage, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::YieldVault) {
            storage.extend_ttl(&DataKey::YieldVault, LEDGER_THRESHOLD, LEDGER_BUMP);
            storage.extend_ttl(&DataKey::YieldShares, LEDGER_THRESHOLD, LEDGER_BUMP);
            storage.extend_ttl(&DataKey::YieldCostBasis, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::YieldBufferBps) {
            storage.extend_ttl(&DataKey::YieldBufferBps, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::YieldLocked) {
            storage.extend_ttl(&DataKey::YieldLocked, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    /// Point this pool at a deployed ReputationTracker contract so deposits
    /// are reported for the on-chain reputation system.
    /// Restricted to pool members; safe to call more than once.
    pub fn set_reputation_tracker(env: Env, caller: Address, tracker: Address) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(Self::is_member(&members, &caller), "not a member");
        storage.set(&DataKey::ReputationTracker, &tracker);
        Self::bump_config_state_internal(&env);
    }

    // ── Yield vault allocation ────────────────────────────────────────────

    /// Move idle pot capital into a vault. Callable by the pool admin or by the
    /// registered governance contract (via an approved `Custom` proposal).
    ///
    /// A configurable share of the pot (`YieldBufferBps`, 20% by default) always
    /// stays liquid, so ordinary member withdrawals keep working. The amount is
    /// capped by that buffer; larger requests revert rather than illiquidating
    /// the pool.
    pub fn apply_yield_allocation(env: Env, caller: Address, vault: Address, amount: i128) {
        caller.require_auth();

        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        let gov: Option<Address> = storage.get(&DataKey::GovernanceContract);
        assert!(
            caller == stored_admin || gov.is_some_and(|g| g == caller),
            "not authorized"
        );

        let yield_enabled: bool = storage.get(&DataKey::YieldEnabled).unwrap_or(false);
        assert!(yield_enabled, "yield disabled");

        let paused: bool = storage.get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "pool paused");

        let locked: bool = storage.get(&DataKey::YieldLocked).unwrap_or(false);
        assert!(!locked, "yield locked");

        assert!(amount > 0, "amount must be > 0");

        let headroom = Self::max_allocatable(&env);
        assert!(amount <= headroom, "buffer would be violated");

        // Effects: record the vault and our share position before interacting.
        storage.set(&DataKey::YieldVault, &vault);

        // Interactions: move the underlying asset in, then mint shares.
        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &vault,
            &amount,
        );
        let shares =
            VaultClient::new(&env, &vault).deposit(&env.current_contract_address(), &amount);
        assert!(shares > 0, "no shares minted");

        let prev_shares: i128 = storage.get(&DataKey::YieldShares).unwrap_or(0);
        storage.set(&DataKey::YieldShares, &(prev_shares + shares));
        let prev_cost: i128 = storage.get(&DataKey::YieldCostBasis).unwrap_or(0);
        storage.set(&DataKey::YieldCostBasis, &(prev_cost + amount));

        Self::bump_config_state_internal(&env);

        jointsave_yield_vault::allocated(&env, &vault, amount, shares);
    }

    /// Pull capital back out of the vault. Callable by the pool admin, the
    /// registered governance contract, or any pool member: increasing the pot's
    /// liquidity can only help, so no vote is required.
    ///
    /// Returns the assets actually recovered. If the vault cannot honour the
    /// full request it degrades to a partial redemption rather than reverting;
    /// the caller can see how much came back.
    pub fn apply_yield_deallocation(env: Env, caller: Address, amount: i128) -> i128 {
        caller.require_auth();

        let storage = env.storage().persistent();
        let admin: Address = storage.get(&DataKey::Admin).unwrap();
        let gov: Option<Address> = storage.get(&DataKey::GovernanceContract);
        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(
            caller == admin
                || gov.is_some_and(|g| g == caller)
                || Self::is_member(&members, &caller),
            "not authorized"
        );

        assert!(amount > 0, "amount must be > 0");

        let received = Self::deallocate_internal(&env, amount);
        Self::bump_config_state_internal(&env);
        received
    }

    /// Emergency control: when locked, no new allocation is permitted (existing
    /// capital can still be de-allocated).
    pub fn set_yield_locked(env: Env, admin: Address, locked: bool) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        storage.set(&DataKey::YieldLocked, &locked);
        Self::bump_config_state_internal(&env);
        jointsave_yield_vault::lock_set(&env, locked);
    }

    /// Realise any gain in the vault position and credit it to members pro-rata
    /// by their principal balance. Callable by the admin, the governance
    /// contract, or any member.
    ///
    /// Returns the amount distributed. Distributions use floor division, so any
    /// rounding remainder stays in the pot (as still-unrealised yield) rather
    /// than over-crediting a member.
    pub fn sync_yield(env: Env, caller: Address) -> i128 {
        caller.require_auth();

        let storage = env.storage().persistent();
        let admin: Address = storage.get(&DataKey::Admin).unwrap();
        let gov: Option<Address> = storage.get(&DataKey::GovernanceContract);
        let members: Vec<Address> = storage.get(&DataKey::Members).unwrap();
        assert!(
            caller == admin
                || gov.is_some_and(|g| g == caller)
                || Self::is_member(&members, &caller),
            "not authorized"
        );

        let vault: Option<Address> = storage.get(&DataKey::YieldVault);
        let Some(vault) = vault else {
            return 0;
        };
        let shares: i128 = storage.get(&DataKey::YieldShares).unwrap_or(0);
        let cost_basis: i128 = storage.get(&DataKey::YieldCostBasis).unwrap_or(0);
        if shares <= 0 {
            return 0;
        }

        let price = VaultClient::new(&env, &vault).share_price();
        let position = shares * price / SHARE_SCALE;
        if position <= cost_basis {
            // No gain to realise (flat or underwater).
            return 0;
        }
        let realised = position - cost_basis;

        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap_or(0);
        if total <= 0 {
            return 0;
        }

        let mut distributed: i128 = 0;
        for m in members.iter() {
            let bal: i128 = storage.get(&DataKey::Balance(m.clone())).unwrap_or(0);
            if bal > 0 {
                let share = realised * bal / total;
                if share > 0 {
                    let bal_key = DataKey::Balance(m.clone());
                    storage.set(&bal_key, &(bal + share));
                    storage.extend_ttl(&bal_key, LEDGER_THRESHOLD, LEDGER_BUMP);
                    distributed += share;
                }
            }
        }

        if distributed > 0 {
            storage.set(&DataKey::TotalBalance, &(total + distributed));
            // Only the cost of what we actually credited is removed from the
            // cost basis, leaving the rounding remainder to be swept next time.
            storage.set(&DataKey::YieldCostBasis, &(cost_basis + distributed));
        }

        Self::bump_config_state_internal(&env);
        jointsave_yield_vault::synced(&env, distributed);
        distributed
    }

    /// Redeem up to `amount` assets from the vault. Returns the assets actually
    /// received (which may be less than `amount` if the vault is illiquid or the
    /// pool holds too few shares). Never reverts on a shortfall.
    fn deallocate_internal(env: &Env, amount: i128) -> i128 {
        let storage = env.storage().persistent();
        let vault: Option<Address> = storage.get(&DataKey::YieldVault);
        let shares: i128 = storage.get(&DataKey::YieldShares).unwrap_or(0);
        let Some(vault) = vault else {
            return 0;
        };
        if shares <= 0 || amount <= 0 {
            return 0;
        }

        let client = VaultClient::new(env, &vault);
        let price = client.share_price();
        if price <= 0 {
            return 0;
        }

        // Shares needed to raise `amount`, rounded up so we never under-pull.
        let needed = mul_div_ceil(amount, SHARE_SCALE, price);
        let mut to_redeem = if needed < shares { needed } else { shares };
        let redeemable = client.max_redeemable();
        if to_redeem > redeemable {
            to_redeem = redeemable;
        }
        if to_redeem <= 0 {
            // Fully illiquid right now: recover nothing rather than reverting.
            return 0;
        }

        let received = client.withdraw(&env.current_contract_address(), &to_redeem);

        // Burn redeemed shares and remove their proportional cost basis.
        let cost_basis: i128 = storage.get(&DataKey::YieldCostBasis).unwrap_or(0);
        let removed_cost = cost_basis * to_redeem / shares;
        storage.set(&DataKey::YieldShares, &(shares - to_redeem));
        storage.set(&DataKey::YieldCostBasis, &(cost_basis - removed_cost));

        jointsave_yield_vault::deallocated(env, amount, received, to_redeem);
        received
    }

    /// Set the minimum liquid share of the pot, in basis points (0-10000).
    pub fn set_yield_buffer(env: Env, admin: Address, bps: u32) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        assert!(bps <= BPS_DENOMINATOR, "buffer must be <= 10000");
        storage.set(&DataKey::YieldBufferBps, &bps);
        Self::bump_config_state_internal(&env);
        jointsave_yield_vault::buffer_set(&env, bps);
    }

    /// How much idle capital can currently be allocated without breaching the
    /// liquidity buffer.
    fn max_allocatable(env: &Env) -> i128 {
        let storage = env.storage().persistent();
        let total: i128 = storage.get(&DataKey::TotalBalance).unwrap_or(0);
        let buffer_bps: u32 = storage
            .get(&DataKey::YieldBufferBps)
            .unwrap_or(DEFAULT_BUFFER_BPS);
        let token_addr: Address = storage.get(&DataKey::Token).unwrap();
        let liquid = token::Client::new(env, &token_addr).balance(&env.current_contract_address());

        let target_liquid = mul_div_ceil(total, buffer_bps as i128, BPS_DENOMINATOR as i128);
        if liquid > target_liquid {
            liquid - target_liquid
        } else {
            0
        }
    }

    // ── DAO governance ────────────────────────────────────────────────────

    /// Register the DAO governance contract allowed to apply proposals.
    pub fn set_governance_contract(env: Env, admin: Address, governance: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");

        storage.set(&DataKey::GovernanceContract, &governance);
        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("gov_set"), admin), governance);
    }

    /// Apply a governance-approved parameter change. Callable by the pool
    /// admin directly or by the registered governance contract via CPI.
    ///
    /// Proposal types (symbols):
    ///   - "change_deposit_amount" -> minimum deposit in stroops (> 0)
    ///   - "add_penalty"           -> penalty percentage 0-100
    ///   - "remove_penalty"        -> clears penalty percentage
    pub fn apply_governance_proposal(
        env: Env,
        caller: Address,
        proposal_type: Symbol,
        new_value: i128,
    ) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        let gov: Option<Address> = storage.get(&DataKey::GovernanceContract);
        assert!(
            caller == stored_admin || gov.is_some_and(|g| g == caller),
            "not authorized"
        );

        let change_deposit = Symbol::new(&env, "change_deposit_amount");
        let add_penalty = Symbol::new(&env, "add_penalty");
        let remove_penalty = Symbol::new(&env, "remove_penalty");

        if proposal_type == change_deposit {
            assert!(new_value > 0, "minimum must be > 0");
            storage.set(&DataKey::MinimumDeposit, &new_value);
        } else if proposal_type == add_penalty {
            assert!((0..=100).contains(&new_value), "penalty must be 0-100");
            storage.set(&DataKey::PenaltyPercentage, &(new_value as u32));
        } else if proposal_type == remove_penalty {
            storage.set(&DataKey::PenaltyPercentage, &0u32);
        } else {
            panic!("unsupported proposal type");
        }

        Self::bump_config_state_internal(&env);

        env.events()
            .publish((symbol_short!("gov_appl"), proposal_type), new_value);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    pub fn get_version(_env: Env) -> u32 {
        VERSION
    }

    pub fn migrated_from(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::MigratedFrom)
    }

    pub fn balance_of(env: Env, member: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(member))
            .unwrap_or(0)
    }

    pub fn total_balance(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalBalance)
            .unwrap_or(0)
    }

    /// Decimals of the pool's token, recorded at initialize time. Defaults to 7
    /// (native XLM) for pools created before multi-token support.
    pub fn token_decimals(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::TokenDecimals)
            .unwrap_or(7)
    }

    pub fn members(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Members)
            .unwrap_or(Vec::new(&env))
    }

    pub fn is_active(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Active)
            .unwrap_or(false)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().persistent().get(&DataKey::Admin).unwrap()
    }

    pub fn yield_strategy(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::YieldStrategy)
    }

    pub fn deployed_to_yield(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::DeployedToYield)
            .unwrap_or(0)
    }

    pub fn reputation_tracker(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::ReputationTracker)
    }

    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::SupportedTokens)
            .unwrap_or(Vec::new(&env))
    }

    /// Address of the attached DAO governance contract, if any.
    pub fn governance_contract(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::GovernanceContract)
    }

    /// Current minimum deposit in stroops.
    pub fn minimum_deposit(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::MinimumDeposit)
            .unwrap_or(0)
    }

    /// Penalty percentage applied to missed deposits (0 by default).
    pub fn penalty_percentage(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PenaltyPercentage)
            .unwrap_or(0)
    }

    /// Address of the vault holding the pool's allocated capital, if any.
    pub fn yield_vault(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::YieldVault)
    }

    /// Shares the pool holds in the yield vault.
    pub fn yield_shares(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::YieldShares)
            .unwrap_or(0)
    }

    /// Assets the pool has deposited into the vault (cost basis).
    pub fn yield_cost_basis(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::YieldCostBasis)
            .unwrap_or(0)
    }

    /// Minimum liquid share of the pot, in basis points.
    pub fn yield_buffer_bps(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::YieldBufferBps)
            .unwrap_or(DEFAULT_BUFFER_BPS)
    }

    /// Whether new allocations are currently blocked.
    pub fn yield_locked(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::YieldLocked)
            .unwrap_or(false)
    }

    /// Idle capital that can be allocated right now without breaching the buffer.
    pub fn max_allocatable_amount(env: Env) -> i128 {
        Self::max_allocatable(&env)
    }

    /// Current value of the pool's vault position, in assets. Reads the vault's
    /// live share price; returns 0 when nothing is allocated.
    pub fn yield_position(env: Env) -> i128 {
        let storage = env.storage().persistent();
        let vault: Option<Address> = storage.get(&DataKey::YieldVault);
        let Some(vault) = vault else {
            return 0;
        };
        let shares: i128 = storage.get(&DataKey::YieldShares).unwrap_or(0);
        if shares <= 0 {
            return 0;
        }
        let price = VaultClient::new(&env, &vault).share_price();
        shares * price / SHARE_SCALE
    }

    /// Unrealised gain in the vault position (position value minus cost basis).
    pub fn unrealised_yield(env: Env) -> i128 {
        let position = Self::yield_position(env.clone());
        let cost_basis: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::YieldCostBasis)
            .unwrap_or(0);
        if position > cost_basis {
            position - cost_basis
        } else {
            0
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /// If a supported-token allowlist has been configured, require `token` to
    /// be on it. No-op while the allowlist is empty (default/back-compat).
    fn assert_token_supported(env: &Env, token: &Address) {
        let supported: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::SupportedTokens)
            .unwrap_or(Vec::new(env));
        if !supported.is_empty() {
            let mut found = false;
            for t in supported.iter() {
                if t == *token {
                    found = true;
                    break;
                }
            }
            assert!(found, "token not supported");
        }
    }

    fn is_member(members: &Vec<Address>, who: &Address) -> bool {
        for m in members.iter() {
            if m == *who {
                return true;
            }
        }
        false
    }

    /// O(n^2) pairwise scan — member lists are small, so this is cheaper
    /// than maintaining a separate index just to dedupe at init time.
    fn has_duplicate_members(members: &Vec<Address>) -> bool {
        for i in 0..members.len() {
            let a = members.get(i).unwrap();
            for j in (i + 1)..members.len() {
                if a == members.get(j).unwrap() {
                    return true;
                }
            }
        }
        false
    }

    /// Best-effort reputation report. A missing/misconfigured tracker must
    /// never block the pool's core deposit flow.
    fn reputation_tracker_addr(env: &Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::ReputationTracker)
    }

    fn report_update_score(
        env: &Env,
        member: &Address,
        deposit_success: bool,
        pool_completed: bool,
    ) {
        if let Some(tracker) = Self::reputation_tracker_addr(env) {
            let pool = env.current_contract_address();
            env.invoke_contract::<()>(
                &tracker,
                &Symbol::new(env, "update_score"),
                soroban_sdk::vec![
                    env,
                    pool.into_val(env),
                    member.into_val(env),
                    deposit_success.into_val(env),
                    pool_completed.into_val(env)
                ],
            );
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod fuzz_tests;

/// `ceil(a * b / d)` with checked integer math. Used for the liquidity buffer
/// so the required liquid floor is never under-estimated.
fn mul_div_ceil(a: i128, b: i128, d: i128) -> i128 {
    let product = a.checked_mul(b).expect("math overflow");
    product.checked_add(d - 1).expect("math overflow") / d
}
