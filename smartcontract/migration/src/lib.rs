#![no_std]

use soroban_sdk::{contracttype, Address, Env};

/// Storage key for contract version.
#[contracttype]
pub enum MigrationDataKey {
    Version,
    MigratedFrom,
}

/// Trait that all migratable JointSave contracts must implement.
///
/// Each contract owns its version constant and migration logic.
/// The framework provides:
/// - Step-by-step version enforcement (no skipping)
/// - Idempotent migration safety
/// - Lineage tracking via `migrated_from`
pub trait Migratable {
    /// Execute migration logic from `from_version` to `to_version`.
    /// Called internally by `migrate()`. Each contract implements
    /// the specific state transformations needed.
    fn migrate(env: Env, from_version: u32, to_version: u32);

    /// Return the current contract version.
    fn version(env: Env) -> u32;
}

/// Validate that a version upgrade is exactly one step.
/// Panics if `to_version != from_version + 1`.
pub fn validate_version_step(from_version: u32, to_version: u32) {
    assert!(
        to_version == from_version + 1,
        "version must be incremented by exactly 1: cannot go from {} to {}",
        from_version,
        to_version
    );
}

/// Store the migrated_from address for lineage tracking.
pub fn set_migrated_from(env: &Env, old_address: &Address) {
    env.storage()
        .persistent()
        .set(&MigrationDataKey::MigratedFrom, old_address);
}

/// Read the migrated_from address, if any.
pub fn get_migrated_from(env: &Env) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&MigrationDataKey::MigratedFrom)
}
