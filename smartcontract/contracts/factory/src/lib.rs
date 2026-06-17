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
    }

    /// Update treasury address (admin only).
    pub fn set_treasury(env: Env, new_treasury: Address) {
        let storage = env.storage().persistent();
        let admin: Address = storage.get(&DataKey::Admin).unwrap();
        admin.require_auth();
        storage.set(&DataKey::Treasury, &new_treasury);
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

