# JointSave Contract Migration Guide

## Overview

JointSave contracts support safe versioning and migration. Each contract tracks its version and can be upgraded without redeploying the entire system.

## Architecture

### Version Tracking

Every JointSave contract includes:

- `VERSION` constant (currently `1` for all contracts)
- `get_version()` view function — returns the current version
- `migrated_from` view function — returns the previous contract address (if migrated)

### Migration Functions

Pool contracts (Rotational, Target, Flexible) and Factory include:

```rust
migrate(admin: Address, to_version: u32)
```

**Requirements:**
- Caller must be the admin
- Target version must be exactly `current_version + 1`
- No version skipping allowed

**Properties:**
- Idempotent — running `migrate(2)` twice is safe
- Admin-only — unauthorized callers are rejected
- Event-emitting — emits `migrated` event on success

### Migration Lineage

When a contract is migrated from one address to another, the `migrated_from` field stores the previous contract address for lineage tracing.

## Creating a New Migration

### 1. Bump the VERSION constant

In each contract's `lib.rs`:

```rust
const VERSION: u32 = 2; // was 1
```

### 2. Add migration logic

In the `migrate()` function, add state transformations:

```rust
pub fn migrate(env: Env, admin: Address, to_version: u32) {
    admin.require_auth();
    let storage = env.storage().persistent();
    let stored_admin: Address = storage.get(&DataKey::Admin).unwrap();
    assert!(admin == stored_admin, "not admin");

    let current = VERSION;
    assert!(to_version == current + 1, "version must be incremented by exactly 1");

    // Example: add a new storage key for v2
    if to_version == 2 {
        storage.set(&DataKey::NewFeature, &default_value);
    }

    env.events().publish(
        (symbol_short!("migrated"), admin),
        to_version,
    );
}
```

### 3. Update tests

Add tests for the new version:

```rust
#[test]
fn test_get_version_returns_2() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);
    assert_eq!(client.get_version(), 2);
}
```

### 4. Build and test

```bash
cargo fmt --all -- --check
cargo build
cargo test
```

## Testing on Testnet

### Prerequisites

1. Deploy the new WASM to testnet
2. Have the admin secret key
3. Have the contract ID

### Steps

1. **Verify current version:**
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --fn get_version \
     --rpc-url https://soroban-testnet.stellar.org \
     --network testnet
   ```

2. **Upload new WASM:**
   ```bash
   soroban contract upload \
     --wasm target/wasm32-unknown-unknown/release/jointsave_rotational.wasm \
     --secret-key <ADMIN_SECRET> \
     --rpc-url https://soroban-testnet.stellar.org \
     --network testnet
   ```

3. **Upgrade the contract:**
   ```bash
   soroban contract upgrade \
     --id <CONTRACT_ID> \
     --wasm-hash <NEW_WASM_HASH> \
     --secret-key <ADMIN_SECRET> \
     --rpc-url https://soroban-testnet.stellar.org \
     --network testnet
   ```

4. **Verify migration:**
   ```bash
   soroban contract invoke \
     --id <CONTRACT_ID> \
     --fn get_version \
     --rpc-url https://soroban-testnet.stellar.org \
     --network testnet
   ```

### Example Script

See `migrations/migrate_rotational_v1_to_v2.sh` for a complete migration script.

## Verifying Migration Success

After migration, verify:

1. **Version updated:**
   ```bash
   soroban contract invoke --id <ID> --fn get_version ...
   # Should return 2
   ```

2. **Existing state preserved:**
   ```bash
   soroban contract invoke --id <ID> --fn is_active ...
   soroban contract invoke --id <ID> --fn members ...
   # Should return expected values
   ```

3. **New features work:**
   ```bash
   soroban contract invoke --id <ID> --fn new_function ...
   # Should work without errors
   ```

4. **Events emitted:**
   Check the transaction logs for the `migrated` event.

## Rollback Considerations

**Soroban contracts cannot be downgraded.** If a migration introduces a critical bug:

1. **Emergency pause:** Use the existing `pause()` function to freeze the contract
2. **Emergency withdraw:** Use `emergency_withdraw()` to recover funds
3. **Deploy fresh:** Deploy a new contract with the previous version's WASM
4. **Update Factory:** Register the new contract in the Factory

**Mitigation strategies:**

- Test migrations thoroughly on testnet before mainnet
- Keep backup WASM hashes for previous versions
- Use the pause mechanism as a safety net
- Consider migration dry-runs on testnet

## Frontend Compatibility

The frontend checks contract versions and displays warnings when:

- The contract version is newer than the frontend's known version
- Features may not be available

See `frontend/lib/constants.ts` for version constants and `frontend/hooks/useJointSaveContracts.ts` for version checking logic.

## Contract-Specific Notes

### Factory
- `register_migration(admin, old_factory)` — records migration lineage
- `migrate(admin, to_version)` — upgrades factory logic

### Rotational Pool
- `migrate(admin, to_version)` — upgrades pool logic
- State: members, rounds, deposits preserved across migration

### Target Pool
- `migrate(admin, to_version)` — upgrades pool logic
- State: members, balances, target preserved across migration

### Flexible Pool
- `migrate(admin, to_version)` — upgrades pool logic
- State: members, balances, yield config preserved across migration

### Reputation Tracker
- No `migrate()` function — read-only tracking contract
- Version tracked via `get_version()` only

### Yield Strategy
- No `migrate()` function — standalone strategy contract
- Version tracked via `get_version()` only
