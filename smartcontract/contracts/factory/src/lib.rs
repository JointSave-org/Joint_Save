#![no_std]

//! JointSave Factory
//!
//! Acts as a registry for all JointSave pools deployed on Stellar.
//! Because Soroban contracts cannot deploy other contracts at runtime,
//! pool contracts are deployed separately (via CLI / SDK) and then
//! registered here. The factory stores the token address, treasury,
//! and lists of all registered pool contract IDs.

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, Vec, symbol_short,
};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Treasury,
    Rotational,
    Target,
    Flexible,
}

const LEDGER_THRESHOLD: u32 = 518400;
const LEDGER_BUMP: u32 = 2592000;

#[contract]
pub struct JointSaveFactory;

#[contractimpl]
impl JointSaveFactory {
    /// Initialize the factory. Must be called once after deployment.
    pub fn initialize(env: Env, admin: Address, token: Address, treasury: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Treasury, &treasury);
        storage.set(&DataKey::Rotational, &Vec::<BytesN<32>>::new(&env));
        storage.set(&DataKey::Target, &Vec::<BytesN<32>>::new(&env));
        storage.set(&DataKey::Flexible, &Vec::<BytesN<32>>::new(&env));
        Self::bump_state(env.clone());
    }

    /// Register a deployed rotational pool contract.
    pub fn register_rotational(env: Env, caller: Address, pool_id: BytesN<32>) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let mut list: Vec<BytesN<32>> = storage.get(&DataKey::Rotational).unwrap();
        list.push_back(pool_id.clone());
        storage.set(&DataKey::Rotational, &list);
        env.events()
            .publish((symbol_short!("rot_reg"), caller), pool_id);
        Self::bump_state(env.clone());
    }

    /// Register a deployed target pool contract.
    pub fn register_target(env: Env, caller: Address, pool_id: BytesN<32>) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let mut list: Vec<BytesN<32>> = storage.get(&DataKey::Target).unwrap();
        list.push_back(pool_id.clone());
        storage.set(&DataKey::Target, &list);
        env.events()
            .publish((symbol_short!("tgt_reg"), caller), pool_id);
        Self::bump_state(env.clone());
    }

    /// Register a deployed flexible pool contract.
    pub fn register_flexible(env: Env, caller: Address, pool_id: BytesN<32>) {
        caller.require_auth();
        let storage = env.storage().persistent();
        let mut list: Vec<BytesN<32>> = storage.get(&DataKey::Flexible).unwrap();
        list.push_back(pool_id.clone());
        storage.set(&DataKey::Flexible, &list);
        env.events()
            .publish((symbol_short!("flx_reg"), caller), pool_id);
        Self::bump_state(env.clone());
    }

    /// Update treasury address (admin only).
    pub fn set_treasury(env: Env, new_treasury: Address) {
        let storage = env.storage().persistent();
        let admin: Address = storage.get(&DataKey::Admin).unwrap();
        admin.require_auth();
        storage.set(&DataKey::Treasury, &new_treasury);
        Self::bump_state(env.clone());
    }

    /// Emit a pause_all event signalling all registered pools should be paused.
    /// Individual pool admins must call pause() on each contract separately.
    pub fn pause_all(env: Env, admin: Address) {
        admin.require_auth();
        let storage = env.storage().persistent();
        let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
        assert!(admin == stored_admin, "not admin");
        env.events().publish((symbol_short!("pause_all"), admin), ());
    }

    pub fn bump_state(env: Env) {
        let storage = env.storage().persistent();
        if storage.has(&DataKey::Admin) {
            storage.extend_ttl(&DataKey::Admin, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::Token) {
            storage.extend_ttl(&DataKey::Token, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::Treasury) {
            storage.extend_ttl(&DataKey::Treasury, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::Rotational) {
            storage.extend_ttl(&DataKey::Rotational, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::Target) {
            storage.extend_ttl(&DataKey::Target, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if storage.has(&DataKey::Flexible) {
            storage.extend_ttl(&DataKey::Flexible, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    // ── Views ──────────────────────────────────────────────────────────────

    pub fn token(env: Env) -> Address {
        env.storage().persistent().get(&DataKey::Token).unwrap()
    }

    pub fn treasury(env: Env) -> Address {
        env.storage().persistent().get(&DataKey::Treasury).unwrap()
    }

    pub fn all_rotational(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::Rotational)
            .unwrap_or(Vec::new(&env))
    }

    pub fn all_target(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::Target)
            .unwrap_or(Vec::new(&env))
    }

    pub fn all_flexible(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::Flexible)
            .unwrap_or(Vec::new(&env))
    }
}

#[cfg(test)]
mod tests;

