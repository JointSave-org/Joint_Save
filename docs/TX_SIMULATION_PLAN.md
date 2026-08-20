# Transaction Simulation (Dry Run) — Implementation Plan

**Branch:** `feat/tx-simulation-dry-run`
**Issue:** Pre-validate contract interactions before wallet signing via Soroban RPC `simulateTransaction`

---

## Audit Summary

### Current State
- **Single transaction funnel**: All contract interactions flow through `submitTx()` in `hooks/useJointSaveContracts.ts:179-248`
- **Simulation already happens** at line 198 (`server.simulateTransaction(tx)`) but is used only for auth assembly — never shown to users
- **No user-facing pre-validation**: Errors surface *after* the wallet popup, when the tx is already submitted
- **No i18n**: All UI strings are hardcoded in English (no `t()` calls exist)
- **Dialog pattern**: shadcn/ui `Dialog` component (Radix) used throughout `group-actions.tsx`
- **Error pattern**: `toastManager.error(msg)` after `catch`

### Contract Error Strings (from smart contract `assert!` calls)
These are the raw error strings that simulation will surface:

| Error string | Pool types | Context |
|---|---|---|
| `"pool paused"` | All | Deposit, withdraw, add/remove member, trigger payout |
| `"not a member"` | All | Deposit, withdraw, leave, trigger payout |
| `"already deposited this round"` | Rotational | Deposit |
| `"deadline passed"` | Target | Deposit |
| `"deadline not passed"` | Target | Refund |
| `"target not reached yet"` | Target | Withdraw |
| `"nothing to withdraw"` | Target | Withdraw |
| `"insufficient balance"` | Flexible | Withdraw |
| `"below minimum deposit"` | Flexible | Deposit |
| `"not admin"` | All | Pause, unpause, add/remove member, refund |
| `"pool not paused"` | All | Unpause |
| `"already a member"` | All | Add member |
| `"pool inactive"` | All | Any action |
| `"amount must be > 0"` | Target, Flexible | Deposit, withdraw |
| `"yield disabled"` | Flexible | Distribute yield |
| `"insufficient pool balance"` | Flexible | Deploy to yield |

---

## File Plan

### 1. `frontend/lib/tx-simulator.ts` (NEW)
**Purpose**: Simulation engine — calls Soroban RPC, returns structured result, caches.

```
Structure:
├── simulateTransaction(txXdr: string): Promise<SimulationOutcome>
├── SimulationCache (Map<string, { result, timestamp }>)
└── getCachedSimulation(txXdr: string): SimulationOutcome | null
```

**Key types:**
```ts
interface SimulationCost {
  cpuInstructions: number
  memoryBytes: number
  feeN stroops: number  // converted from resource fee
}

interface SimulationOutcome {
  success: boolean
  error?: string           // raw Soroban error string
  errorKey?: string        // normalized key for error mapping
  cost?: SimulationCost
  result?: xdr.ScVal      // return value from simulation
}

interface SimulationCacheEntry {
  outcome: SimulationOutcome
  timestamp: number
}
```

**Logic:**
1. Hash the XDR string (simple `btoa` or string hash)
2. Check cache — if < 30s old, return cached
3. Create `rpc.Server` via existing `getRpc()` from `useJointSaveContracts.ts`
4. Call `server.simulateTransaction(tx)` (using the `Transaction` object, not XDR string — since `getRpc()` returns an `rpc.Server`)
5. If `rpc.Api.isSimulationError(simResult)` → parse the error string through `contract-errors.ts`
6. If success → extract resource costs from `simResult.cost` / `simResult.resourceFee`
7. Cache and return

**Note:** The function signature should accept a `Transaction` object (not `string`) since that's what `server.simulateTransaction()` expects. The XDR hash for caching can be derived from `tx.toXDR()`.

### 2. `frontend/lib/contract-errors.ts` (NEW)
**Purpose**: Map raw Soroban contract error strings → user-friendly messages.

```
Structure:
├── ContractErrorCode (enum/const)
├── mapContractError(rawError: string): { key: ContractErrorCode, message: string }
└── FRIENDLY_ERROR_MESSAGES (Record<ContractErrorCode, string>)
```

**Mapping table (raw → friendly):**

| Raw error | Code | Friendly message |
|---|---|---|
| `"pool paused"` | `POOL_PAUSED` | "This pool is currently paused. Deposits are not accepted." |
| `"not a member"` | `NOT_A_MEMBER` | "You are not a member of this pool." |
| `"already deposited this round"` | `ALREADY_DEPOSITED` | "You have already deposited for this round." |
| `"amount must be > 0"` / `"below minimum deposit"` | `INSUFFICIENT_BALANCE` | "Your wallet balance is insufficient for this deposit." |
| `"deadline passed"` | `DEADLINE_PASSED` | "The deposit deadline has passed. Contact your pool admin." |
| `"not admin"` | `UNAUTHORIZED` | "Only the pool admin can perform this action." |
| `"target not reached yet"` | `TARGET_NOT_REACHED` | "The pool target has not been reached yet. Withdrawals are locked." |
| `"nothing to withdraw"` | `NOTHING_TO_WITHDRAW` | "You have no balance to withdraw from this pool." |
| `"insufficient balance"` | `INSUFFICIENT_BALANCE` | "Your wallet balance is insufficient for this action." |
| `"pool not paused"` | `POOL_NOT_PAUSED` | "This pool is not currently paused." |
| `"already a member"` | `ALREADY_A_MEMBER` | "This address is already a member of this pool." |
| `"pool inactive"` | `POOL_INACTIVE` | "This pool is no longer active." |
| `"insufficient pool balance"` | `INSUFFICIENT_POOL_BALANCE` | "The pool does not have enough funds for this action." |
| `"yield disabled"` | `YIELD_DISABLED` | "Yield distribution is not enabled for this pool." |
| (unknown) | `UNKNOWN` | "Transaction would fail: {raw error}" |

### 3. `frontend/lib/constants.ts` (MODIFY)
**Add:**
```ts
export const SIMULATION_CACHE_TTL_MS = 30_000 as const
export const SIMULATION_TIMEOUT_MS = 10_000 as const
```

### 4. `frontend/components/shared/tx-simulation-dialog.tsx` (NEW)
**Purpose**: Modal shown after clicking a transaction button, with 3 phases.

**Phases:**
1. **Simulating**: Spinner + "Simulating transaction..."
2. **Success**: "Transaction looks good! Estimated fee: X XLM. Sign to confirm?"
3. **Failure**: "Transaction would fail: [friendly error]. No changes will be made."
4. **Unavailable** (network error): "Simulation unavailable. Transaction may fail on-chain. Proceed anyway?"

**Props:**
```ts
interface TxSimulationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  simulation: SimulationOutcome | null
  isSimulating: boolean
  onConfirm: () => void
  onCancel: () => void
  txLabel?: string  // "Deposit", "Withdraw", etc.
}
```

**Component structure:**
- Uses existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` from `@/components/ui/dialog`
- Uses `Loader2` spinner from lucide-react (already imported in group-actions.tsx)
- Uses `Button` from `@/components/ui/button`
- Fee display: Convert stroops → XLM (divide by 10,000,000)

### 5. `frontend/hooks/useJointSaveContracts.ts` (MODIFY)
**Changes:**
1. **Export `submitTx` with a `simulateOnly` option** — or better, add a new `simulateTx()` function that reuses the transaction building but only runs the simulation step
2. **Add a `useTxSimulation()` hook** that returns `{ simulate, simulation, isSimulating }` — wraps `simulateTransaction()` from `tx-simulator.ts`

**Approach — new export `buildTxForSimulation()`:**
Rather than modifying `submitTx()` (which is internal), add a helper that each hook can call:

```ts
// New exported function — builds the Transaction object without submitting
export async function buildTx(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<Transaction> {
  const address = /* from useStellar */ 
  const account = await getRpc().getAccount(address)
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(normalizeId(contractId)).call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build()
}
```

Then in each hook (e.g., `useRotationalDeposit`), the flow becomes:
```ts
// Before:
const deposit = async () => {
  const account = await getRpc().getAccount(address)
  const tx = new TransactionBuilder(account, ...).addOperation(...).setTimeout(...).build()
  return await submitTx(kit, tx, pendingTx)
}

// After:
const deposit = async (skipSimulation?: boolean) => {
  const tx = await buildTx(contractId, "deposit", addressVal(address))
  if (!skipSimulation) {
    const sim = await simulateTransaction(tx)
    if (!sim.success) throw new Error(sim.error) // or return sim for dialog
  }
  return await submitTx(kit, tx, pendingTx)
}
```

**However**, the cleaner approach that matches the issue requirements is to handle simulation at the **UI level** (`group-actions.tsx`), not inside the hooks. This way:
- The hook remains unchanged (it already simulates internally)
- The UI shows the simulation dialog *before* calling the hook
- If simulation fails, the hook is never called

**Recommended approach:**
- Add `simulateTransaction(tx: Transaction): Promise<SimulationOutcome>` to `tx-simulator.ts`
- Add `useTxSimulation()` hook that manages state
- In `group-actions.tsx`, wrap each handler with simulation check before calling the existing hooks
- Modify `submitTx()` to accept an optional `skipSimulation` flag (since it already simulates — we'd be simulating twice otherwise)

### 6. `frontend/components/group/group-actions.tsx` (MODIFY)
**Changes:**
1. Import `TxSimulationDialog`
2. Import `useTxSimulation` (or inline simulation state)
3. Add simulation state: `simOutcome`, `isSimulating`, `showSimDialog`
4. Wrap each handler (`handleDeposit`, `handleWithdrawClick`, `handleTriggerPayoutClick`, `handlePause`, `handleUnpause`, `handleAddMember`, `handleRemoveMember`, `handleLeavePool`) with simulation flow:

```ts
const handleDeposit = async () => {
  // ... existing guards (wallet connected, not pending, not paused) ...
  
  // Build tx for simulation
  const tx = buildTxForDeposit(...)  // new helper
  const outcome = await simulateTransaction(tx)
  
  setSimOutcome(outcome)
  setShowSimDialog(true)
  // Dialog handles the rest (confirm → call hook, or cancel)
}

const handleSimConfirm = async () => {
  setShowSimDialog(false)
  // Now proceed with actual hook call (deposit, withdraw, etc.)
  // Pass skipSimulation=true to avoid double-simulating
  await existingHandler()
}
```

5. Add `<TxSimulationDialog>` to the JSX

### 7. `frontend/components/shared/` (NEW DIRECTORY)
Create if it doesn't exist. `tx-simulation-dialog.tsx` goes here.

---

## Implementation Order

### Phase 1: Foundation (no UI changes)
1. `frontend/lib/constants.ts` — Add `SIMULATION_CACHE_TTL_MS`, `SIMULATION_TIMEOUT_MS`
2. `frontend/lib/contract-errors.ts` — Error mapping module
3. `frontend/lib/tx-simulator.ts` — Simulation engine with caching

### Phase 2: Hook Integration
4. `frontend/hooks/useJointSaveContracts.ts` — Add `buildTx()` helper, add `simulateOnly` support to `submitTx()`

### Phase 3: UI Components
5. `frontend/components/shared/tx-simulation-dialog.tsx` — Simulation dialog component
6. `frontend/components/group/group-actions.tsx` — Integrate simulation into all handlers

### Phase 4: Verification
7. Run `pnpm lint` and `pnpm build` to verify no regressions
8. Manual testing: trigger each pool action, verify simulation dialog appears

---

## Edge Cases & Graceful Degradation

| Scenario | Behavior |
|---|---|
| Network error during simulation | Show dialog phase 4 ("Simulation unavailable...Proceed anyway?"), user can opt in |
| Simulation timeout (>10s) | Treat as unavailable, proceed with warning |
| E2E mode (`NEXT_PUBLIC_E2E=true`) | Skip simulation entirely (existing E2E seam) |
| User cancels simulation dialog | Do nothing, return to pool page |
| Simulation succeeds but tx fails on-chain | Existing error handling catches this (polling loop) |
| Double-simulation prevention | Cache keyed on XDR hash, 30s TTL |
| Wallet not connected | Existing guard in handler prevents reaching simulation code |

---

## What We Are NOT Changing
- Smart contracts (no Rust changes)
- `submitTx()` core logic (only adding `skipSimulation` flag)
- `tx-queue.ts` (signing queue untouched)
- `pending-transactions.ts` (tracking untouched)
- `web3-provider.tsx` (wallet connection untouched)
- Toast system (errors still go through `toastManager`)
- No new npm dependencies (using existing `@stellar/stellar-sdk` rpc API)
