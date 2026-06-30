# Storage TTL Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Time-To-Live (TTL) storage management across all 5 smart contracts and expose TTL warning states and extension capabilities in the frontend to prevent critical state expiry.

**Architecture:** Add constants `LEDGER_THRESHOLD` and `LEDGER_BUMP` to all contracts. Implement a public `bump_state` function on each contract to extend the TTL of all persistent storage keys. Call this function at the end of every state-changing method. In the frontend, fetch the contract's `Admin` storage key liveUntilLedger metadata to display remaining days, warn when TTL is under 7 days, and provide a button to invoke `bump_state`.

**Tech Stack:** Rust (Soroban SDK v21.0.0), Next.js (TypeScript, React), Stellar SDK, Tailwind CSS, Radix UI.

---

### Task 1: Factory Contract TTL Bumping

**Files:**
- Modify: `smartcontract/contracts/factory/src/lib.rs`
- Test: `smartcontract/contracts/factory/src/tests.rs`

**Step 1: Write the failing test**
In `smartcontract/contracts/factory/src/tests.rs`, add a test to verify `bump_state` exists and increases the TTL of the keys.
```rust
#[test]
fn test_bump_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, JointSaveFactory);
    let client = JointSaveFactoryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &token, &treasury);

    // Get initial TTL of Admin key (should be initialized/default)
    let initial_ttl = env.as_contract(&contract_id, || {
        env.storage().persistent().ttl(&super::DataKey::Admin)
    });

    // Call bump_state
    client.bump_state();

    // Verify TTL was extended to at least LEDGER_BUMP
    let final_ttl = env.as_contract(&contract_id, || {
        env.storage().persistent().ttl(&super::DataKey::Admin)
    });
    assert!(final_ttl >= 2592000); // LEDGER_BUMP
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p jointsave-factory`
Expected: FAIL with "no method named `bump_state` found"

**Step 3: Write minimal implementation**
In `smartcontract/contracts/factory/src/lib.rs`, define the constants and implement `bump_state`:
```rust
const LEDGER_THRESHOLD: u32 = 518400;  // ~30 days
const LEDGER_BUMP: u32 = 2592000;       // ~150 days

// Inside impl JointSaveFactory:
    pub fn bump_state(env: Env) {
        let storage = env.storage().persistent();
        let keys = [
            DataKey::Admin,
            DataKey::Token,
            DataKey::Treasury,
            DataKey::Rotational,
            DataKey::Target,
            DataKey::Flexible,
        ];
        for key in keys.iter() {
            if storage.has(key) {
                storage.extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
    }
```
And add `Self::bump_state(env.clone());` to the end of state-changing functions:
- `initialize`
- `register_rotational`
- `register_target`
- `register_flexible`
- `set_treasury`

**Step 4: Run test to verify it passes**
Run: `cargo test -p jointsave-factory`
Expected: PASS

**Step 5: Commit**
```bash
git add smartcontract/contracts/factory/src/lib.rs smartcontract/contracts/factory/src/tests.rs
git commit -m "feat(factory): implement storage TTL bump logic and bump_state"
```

---

### Task 2: Reputation Tracker TTL Bumping

**Files:**
- Modify: `smartcontract/contracts/reputation/src/lib.rs`
- Test: `smartcontract/contracts/reputation/src/test.rs`

**Step 1: Write the failing test**
In `smartcontract/contracts/reputation/src/test.rs`, add a test to verify `bump_state` extends TTL.
```rust
#[test]
fn test_bump_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, ReputationTracker);
    let client = ReputationTrackerClient::new(&env, &contract_id);
    
    // Call bump_state (even if empty, should compile and run)
    client.bump_state();
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p jointsave-reputation`
Expected: FAIL with "no method named `bump_state` found"

**Step 3: Write minimal implementation**
In `smartcontract/contracts/reputation/src/lib.rs`, update `DataKey` to include `Members`:
```rust
#[contracttype]
pub enum DataKey {
    Score(Address),
    DepositsMade(Address),
    RoundsTracked(Address),
    Members,
}
```
Define constants:
```rust
const LEDGER_THRESHOLD: u32 = 518400;  // ~30 days
const LEDGER_BUMP: u32 = 2592000;       // ~150 days
```
Implement `track_member` helper and `bump_state`:
```rust
    fn track_member(env: &Env, member: &Address) {
        let storage = env.storage().persistent();
        let key = DataKey::Members;
        let mut members: Vec<Address> = storage.get(&key).unwrap_or_else(|| Vec::new(env));
        let mut exists = false;
        for m in members.iter() {
            if m == *member {
                exists = true;
                break;
            }
        }
        if !exists {
            members.push_back(member.clone());
            storage.set(&key, &members);
        }
    }

    pub fn bump_state(env: Env) {
        let storage = env.storage().persistent();
        let key = DataKey::Members;
        if storage.has(&key) {
            storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        if let Some(members) = storage.get::<_, Vec<Address>>(&key) {
            for m in members.iter() {
                let score_key = DataKey::Score(m.clone());
                let dep_key = DataKey::DepositsMade(m.clone());
                let round_key = DataKey::RoundsTracked(m.clone());

                if storage.has(&score_key) {
                    storage.extend_ttl(&score_key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
                if storage.has(&dep_key) {
                    storage.extend_ttl(&dep_key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
                if storage.has(&round_key) {
                    storage.extend_ttl(&round_key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
        }
    }
```
Add `Self::track_member(&env, &member);` and `Self::bump_state(env.clone());` at the end of:
- `record_deposit`
- `record_payout_received`
- `record_missed_round`

**Step 4: Run test to verify it passes**
Run: `cargo test -p jointsave-reputation`
Expected: PASS

**Step 5: Commit**
```bash
git add smartcontract/contracts/reputation/src/lib.rs smartcontract/contracts/reputation/src/test.rs
git commit -m "feat(reputation): implement storage TTL bump logic and track_member"
```

---

### Task 3: Rotational Pool TTL Bumping

**Files:**
- Modify: `smartcontract/contracts/rotational/src/lib.rs`
- Test: `smartcontract/contracts/rotational/src/tests.rs`

**Step 1: Write the failing test**
In `smartcontract/contracts/rotational/src/tests.rs` (or `test.rs`), add a test verifying `bump_state` compiles and extends TTL.
```rust
#[test]
fn test_bump_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);
    // Should fail compilation initially because bump_state doesn't exist
    client.bump_state();
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p jointsave-rotational`
Expected: FAIL with "no method named `bump_state` found"

**Step 3: Write minimal implementation**
In `smartcontract/contracts/rotational/src/lib.rs`, add constants:
```rust
const LEDGER_THRESHOLD: u32 = 518400;  // ~30 days
const LEDGER_BUMP: u32 = 2592000;       // ~150 days
```
Implement `bump_state`:
```rust
    pub fn bump_state(env: Env) {
        let storage = env.storage().persistent();
        let keys = [
            DataKey::Token,
            DataKey::Admin,
            DataKey::Treasury,
            DataKey::Members,
            DataKey::DepositAmount,
            DataKey::RoundDuration,
            DataKey::TreasuryFeeBps,
            DataKey::RelayerFeeBps,
            DataKey::CurrentRound,
            DataKey::NextPayoutTime,
            DataKey::Active,
            DataKey::Paused,
            DataKey::ReputationTracker,
        ];
        for key in keys.iter() {
            if storage.has(key) {
                storage.extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
        if let Some(members) = storage.get::<_, Vec<Address>>(&DataKey::Members) {
            for member in members.iter() {
                let key = DataKey::HasDeposited(member.clone());
                if storage.has(&key) {
                    storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
        }
    }
```
Add `Self::bump_state(env.clone());` to the end of state-changing functions:
- `initialize`, `deposit`, `trigger_payout`, `add_member`, `remove_member`, `pause`, `unpause`, `emergency_withdraw`, `set_reputation_tracker`.

**Step 4: Run test to verify it passes**
Run: `cargo test -p jointsave-rotational`
Expected: PASS

**Step 5: Commit**
```bash
git add smartcontract/contracts/rotational/src/lib.rs smartcontract/contracts/rotational/src/tests.rs
git commit -m "feat(rotational): implement storage TTL bump logic"
```

---

### Task 4: Target Pool TTL Bumping

**Files:**
- Modify: `smartcontract/contracts/target/src/lib.rs`
- Test: `smartcontract/contracts/target/src/tests.rs`

**Step 1: Write the failing test**
In `smartcontract/contracts/target/src/tests.rs` (or `test.rs`), add a test for `bump_state`.
```rust
#[test]
fn test_bump_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TargetPool);
    let client = TargetPoolClient::new(&env, &contract_id);
    client.bump_state();
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p jointsave-target`
Expected: FAIL with "no method named `bump_state` found"

**Step 3: Write minimal implementation**
In `smartcontract/contracts/target/src/lib.rs`, add constants:
```rust
const LEDGER_THRESHOLD: u32 = 518400;  // ~30 days
const LEDGER_BUMP: u32 = 2592000;       // ~150 days
```
Implement `bump_state`:
```rust
    pub fn bump_state(env: Env) {
        let storage = env.storage().persistent();
        let keys = [
            DataKey::Token,
            DataKey::Admin,
            DataKey::Members,
            DataKey::TargetAmount,
            DataKey::Deadline,
            DataKey::TotalDeposited,
            DataKey::Active,
            DataKey::Unlocked,
            DataKey::Paused,
        ];
        for key in keys.iter() {
            if storage.has(key) {
                storage.extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
        if let Some(members) = storage.get::<_, Vec<Address>>(&DataKey::Members) {
            for member in members.iter() {
                let key = DataKey::Balance(member.clone());
                if storage.has(&key) {
                    storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
        }
    }
```
Add `Self::bump_state(env.clone());` to the end of state-changing functions:
- `initialize`, `deposit`, `withdraw`, `refund`, `add_member`, `remove_member`, `pause`, `unpause`, `emergency_withdraw`.

**Step 4: Run test to verify it passes**
Run: `cargo test -p jointsave-target`
Expected: PASS

**Step 5: Commit**
```bash
git add smartcontract/contracts/target/src/lib.rs smartcontract/contracts/target/src/tests.rs
git commit -m "feat(target): implement storage TTL bump logic"
```

---

### Task 5: Flexible Pool TTL Bumping

**Files:**
- Modify: `smartcontract/contracts/flexible/src/lib.rs`
- Test: `smartcontract/contracts/flexible/src/tests.rs`

**Step 1: Write the failing test**
In `smartcontract/contracts/flexible/src/tests.rs` (or `test.rs`), add a test for `bump_state`.
```rust
#[test]
fn test_bump_state() {
    let env = Env::default();
    let contract_id = env.register_contract(None, FlexiblePool);
    let client = FlexiblePoolClient::new(&env, &contract_id);
    client.bump_state();
}
```

**Step 2: Run test to verify it fails**
Run: `cargo test -p jointsave-flexible`
Expected: FAIL with "no method named `bump_state` found"

**Step 3: Write minimal implementation**
In `smartcontract/contracts/flexible/src/lib.rs`, add constants:
```rust
const LEDGER_THRESHOLD: u32 = 518400;  // ~30 days
const LEDGER_BUMP: u32 = 2592000;       // ~150 days
```
Implement `bump_state`:
```rust
    pub fn bump_state(env: Env) {
        let storage = env.storage().persistent();
        let keys = [
            DataKey::Token,
            DataKey::Admin,
            DataKey::Treasury,
            DataKey::Members,
            DataKey::MinimumDeposit,
            DataKey::WithdrawalFeeBps,
            DataKey::TreasuryFeeBps,
            DataKey::YieldEnabled,
            DataKey::TotalBalance,
            DataKey::Active,
            DataKey::Paused,
            DataKey::DeployedToYield,
            DataKey::YieldStrategy,
        ];
        for key in keys.iter() {
            if storage.has(key) {
                storage.extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
        if let Some(members) = storage.get::<_, Vec<Address>>(&DataKey::Members) {
            for member in members.iter() {
                let key = DataKey::Balance(member.clone());
                if storage.has(&key) {
                    storage.extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
                }
            }
        }
    }
```
Add `Self::bump_state(env.clone());` to the end of state-changing functions:
- `initialize`, `deposit`, `withdraw`, `distribute_yield`, `add_member`, `remove_member`, `pause`, `unpause`, `emergency_withdraw`, `set_yield_strategy`, `deploy_to_yield`, `harvest_yield`.

**Step 4: Run test to verify it passes**
Run: `cargo test -p jointsave-flexible`
Expected: PASS

**Step 5: Commit**
```bash
git add smartcontract/contracts/flexible/src/lib.rs smartcontract/contracts/flexible/src/tests.rs
git commit -m "feat(flexible): implement storage TTL bump logic"
```

---

### Task 6: Frontend Hooks & API Updates

**Files:**
- Modify: `frontend/hooks/useJointSaveContracts.ts`
- Modify: `frontend/lib/data-layer/PoolDataProvider.tsx`

**Step 1: Implement fetchPoolTtl and useBumpPoolState in useJointSaveContracts.ts**
Open `frontend/hooks/useJointSaveContracts.ts` and add `fetchPoolTtl` and `useBumpPoolState`:
```typescript
export async function fetchPoolTtl(contractId: string): Promise<number | null> {
  try {
    const server = getRpc()
    const ledgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(normalizeId(contractId)).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Admin")]),
        durability: xdr.ContractDataDurability.persistent(),
      })
    )
    const response = await server.getLedgerEntries(ledgerKey)
    if (response.entries && response.entries.length > 0) {
      const entry = response.entries[0]
      if (entry && "liveUntilLedger" in entry) {
        const liveUntilLedger = entry.liveUntilLedger as number
        const latestLedgerResponse = await server.getLatestLedger()
        const currentLedger = latestLedgerResponse.sequence
        const ttlLedgers = liveUntilLedger - currentLedger
        // ~17280 ledgers per day (5 seconds per ledger)
        const days = Math.max(0, Math.floor(ttlLedgers / 17280))
        return days
      }
    }
  } catch (err) {
    console.error("Error fetching pool TTL:", err)
  }
  return null
}

export function useBumpPoolState(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const bumpPoolState = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(new Contract(normalizeId(contractId)).call("bump_state"))
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { bumpPoolState, isLoading }
}
```

**Step 2: Update PoolDataProvider cache interface and state fetcher**
In `frontend/lib/data-layer/PoolDataProvider.tsx`:
- Import `fetchPoolTtl` from `@/hooks/useJointSaveContracts`.
- Add `ttlDays: number | null` to `PoolStateCache` interface.
- Add `ttlDays: number | null` to the default cached object in `setEntry` and `seedCache`.
- In `fetchPool`, push `fetchPoolTtl(contractAddr)` to `promises` and unpack it:
  ```typescript
  const [stateVal, pausedVal, adminVal, ttlVal] = await Promise.all(promises)
  // ...
  cacheRef.current[contractId] = {
    db: dbData,
    onchain: onchainState,
    isPaused,
    poolAdmin,
    ttlDays: ttlVal ?? null, // Save to cache
    lastFetched: fetchTime,
    isLoading: false,
    isStale: false,
    error: null,
  }
  ```
- Expose `ttlDays` in `usePoolData` return values.

**Step 3: Commit**
```bash
git add frontend/hooks/useJointSaveContracts.ts frontend/lib/data-layer/PoolDataProvider.tsx
git commit -m "feat(frontend): implement fetchPoolTtl and useBumpPoolState hooks"
```

---

### Task 7: Show TTL Status and Expose Manual Bump Action in Frontend

**Files:**
- Modify: `frontend/components/group/group-details.tsx`

**Step 1: Extract and display TTL Badge in group details**
In `frontend/components/group/group-details.tsx`, import `useBumpPoolState` and retrieve `ttlDays` from `usePoolData`:
```typescript
  const { data, isLoading, isStale, isPaused, ttlDays, error, refetch } =
    usePoolData(cacheKey);
```
Add a badge under the group name showing the TTL expiration status:
```tsx
              {ttlDays !== null && (
                <Badge variant="outline" className={`text-xs ${ttlDays < 7 ? "text-destructive border-destructive/40 bg-destructive/10" : ""}`}>
                  State expires in {ttlDays} days
                </Badge>
              )}
```

**Step 2: Show Warning Banner and "Extend Storage" Button when TTL < 7 days**
Add the warning banner next to the pausing banner:
```tsx
        {ttlDays !== null && ttlDays < 7 && !isPending(group.contract_address) && (
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-4 text-sm font-medium border border-amber-500/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>
                ⚠️ Pool storage is expiring soon (less than 7 days remaining). Please extend its storage life.
              </span>
            </div>
            <ExtendStorageButton contractId={group.contract_address} onSuccess={refetch} />
          </div>
        )}
```
Implement `ExtendStorageButton` using the `useBumpPoolState` hook to submit the transaction.

**Step 3: Commit**
```bash
git add frontend/components/group/group-details.tsx
git commit -m "feat(frontend): show TTL warnings and add Extend Storage action"
```

---

### Task 8: Update Architecture Documentation

**Files:**
- Modify: `ARCHITECTURE.md`

**Step 1: Document TTL Strategy in ARCHITECTURE.md**
Add a new subsection under `## Smart Contract Layer` explaining the TTL bumping logic, the threshold of ~30 days (`518400` ledgers) and bump of ~150 days (`2592000` ledgers), and how the frontend displays warnings and allows manual triggers of `bump_state`.

**Step 2: Commit**
```bash
git add ARCHITECTURE.md
git commit -m "docs: document Storage TTL Strategy in ARCHITECTURE.md"
```
