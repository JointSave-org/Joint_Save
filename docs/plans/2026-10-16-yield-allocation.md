# Yield Allocation — Design Specification

**Status:** Proposed
**Scope:** `smartcontract/contracts/yield-vault` (new), `smartcontract/contracts/flexible`,
`smartcontract/contracts/governance`, `frontend/`

---

## 1. Goal

Let a savings group **optionally** put idle pot capital to work in a yield vault, without
ever trapping member funds. The feature is:

- **Opt-in per group.** Groups that do not enable it behave exactly as today. No state
  migration is performed for non-participating groups.
- **Vault-agnostic.** The pool talks to any contract implementing the adapter interface;
  no issuer, router, or asset is hard-coded.
- **Governed.** Moving pot capital into a vault requires a group vote, reusing the
  existing `governance` contract membership/quorum/proposal conventions.
- **Conservative.** A configurable share of the pot always stays liquid so ordinary
  withdrawals keep working.

## 2. Existing pieces we build on

| Piece | Location | What we reuse |
|---|---|---|
| Flexible pool yield plumbing | `contracts/flexible/src/lib.rs` | `YieldEnabled`, `YieldStrategy`, `DeployedToYield` keys, `deploy_to_yield`/`harvest_yield` CPI pattern |
| Strategy contract | `contracts/yield-strategy/` | Precedent for a pluggable on-chain yield target; **not** reused directly (it is a DEX-LP strategy with no share accounting) |
| Governance | `contracts/governance/src/lib.rs` | `create_proposal` / `vote` / `execute_proposal`, quorum math, `Custom` proposal type + `dispatch` |
| Governance UI | `frontend/components/governance/`, `frontend/hooks/useGovernance.ts`, `frontend/lib/governance.ts` | Create-proposal dialog, vote card, quorum helpers |
| Yield dashboard | `frontend/components/group/yield-dashboard.tsx` | Existing container we extend rather than duplicate |

We deliberately **do not** touch the closed `ProposalType` enum; allocation rides on the
existing `Custom` type (see §6).

## 3. Vault adapter interface

A new crate `contracts/yield-vault` defines the boundary. The pool depends only on this
interface, never on a concrete vault.

```rust
pub const SHARE_SCALE: i128 = 1_000_000_000; // 1e9, assets per SHARE_SCALE shares

#[contractclient(name = "VaultClient")]
pub trait VaultAdapter {
    /// Deposit `amount` of the vault's underlying asset on behalf of `from`.
    /// The caller must have transferred `amount` tokens to the vault first.
    /// Returns the number of shares minted (>= 0).
    fn deposit(env: Env, from: Address, amount: i128) -> i128;

    /// Redeem `shares` and send the proceeds to `to`.
    /// Returns the assets actually paid out. Callers must pass
    /// `shares <= max_redeemable()`.
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
```

Rules for any adapter implementation:

- **Integer math only.** No floats anywhere in the settlement path.
- **Rounding favours the vault/pool, never the withdrawing member.**
- `deposit` mints `amount * SHARE_SCALE / share_price` shares (floor); the first deposit
  mints `amount * SHARE_SCALE / SHARE_SCALE == amount` shares at price `SHARE_SCALE`.
- `withdraw` pays `shares * share_price / SHARE_SCALE` (floor) and burns exactly
  `shares`. A vault that cannot honour a redemption must keep `max_redeemable` honest so
  callers never request more than it can pay.
- Every state-changing entrypoint performs its auth check first and settles state before
  external transfers (checks-effects-interactions).

## 4. Mock vault (tests and local development)

`contracts/yield-vault/src/mock.rs` implements the adapter for tests and for local
dry-runs. It is **not** a production vault.

- `initialize(admin, token)`.
- `total_assets()` = live `token.balance(vault)`; tests simulate yield by minting the
  underlying token to the vault, which raises `share_price` for existing holders.
- `set_locked_assets(admin, amount)` simulates illiquidity: locked assets are excluded
  from `max_redeemable`, so the pool exercises partial-withdrawal handling deterministically.
- No hard-coded issuer/router/asset.

## 5. Pool-side allocation state and math

New storage keys on the flexible pool (additive; absent keys default to "yield
de-allocation disabled / not allocated"):

| Key | Type | Meaning |
|---|---|---|
| `YieldVault` | `Address` | Active vault for this pool |
| `YieldShares` | `i128` | Shares the pool holds in the vault |
| `YieldCostBasis` | `i128` | Assets the pool deposited (for realised-yield accounting) |
| `YieldBufferBps` | `u32` | Minimum liquid share of the pot, basis points (default `2000` = 20%) |
| `YieldLocked` | `bool` | Emergency de-allocation-only mode |

**Liquid balance** `L = token.balance(pool)`.
**Pot total** `T = TotalBalance` (includes value deployed to the vault at cost basis plus
unrealised yield only after a sync).

**Maximum allocatable** (never breaches the buffer):

```
target_liquid = ceil(T * YieldBufferBps / 10_000)
max_allocatable = L - target_liquid        (0 if negative)
```

A `allocate` request larger than `max_allocatable` reverts with `buffer would be
violated`. Allocation therefore always leaves at least `YieldBufferBps` of the pot
withdrawable immediately.

**De-allocation** (member-triggered, `deallocate_yield(caller, amount)`):

1. `caller` must be a pool member.
2. Map the requested asset `amount` to shares, rounded **up**:
   `shares_needed = ceil(amount * SHARE_SCALE / share_price)`.
3. Cap `shares_needed` at `min(YieldShares, max_redeemable())`.
4. If the cap is `0`, revert with `vault illiquid` (clear error, funds stay safe).
5. Otherwise call `withdraw(pool, shares)` and add the returned assets to the liquid
   balance, decrementing `YieldShares` by the shares burned. A partially-filled request
   returns fewer assets than asked for **without reverting** — this is the graceful
   "partial withdrawal" path.

The pool never assumes it can redeem everything at once; it degrades to a partial
redemption instead of failing.

## 6. Governance flow (reuse `Custom`)

`ProposalType::Custom` already carries a free-form `parameters: Map<String, Bytes>`, and
`dispatch` currently does nothing for it. We extend `dispatch` so that a `Custom` proposal
whose parameters include an allocation action is routed to the pool's
`apply_yield_allocation`:

| Parameter key | Encoding | Value |
|---|---|---|
| `action` | 4-byte symbol (`alloc`/`dealloc`) | requested operation |
| `amount` | big-endian i128 (existing `encodeParamHex`) | assets to move |
| `vault` | 32-byte address or SAC bytes | target vault (`alloc` only) |

`dispatch` behaviour:

- If `parameters` contains `action` == `alloc` → CPI
  `pool.apply_yield_allocation(gov, vault, amount)`.
- If `action` == `dealloc` → CPI `pool.apply_yield_allocation(gov, zero, -amount)` (or an
  explicit de-allocate entrypoint).
- Otherwise → keep today's behaviour (return a `custom` result payload).

This keeps the enum, the stored proposal schema, and the frontend `ProposalType` mirror
unchanged. Existing deployed governance contracts are upgraded with `migrate()`.

## 7. Yield accounting and distribution

- The pool's vault position is valued as `shares * share_price / SHARE_SCALE`.
- **Realised yield** = current position value − `YieldCostBasis`.
- On `harvest`/`sync`, realised yield is credited to the pot and distributed pro-rata by
  each member's principal `Balance`, using floor division so any rounding remainder stays
  in the pot (favours the pot, never over-credits a member).
- `YieldCostBasis` is increased by the harvested amount so the same yield is not
  double-counted; the remainder always stays in the pool.

## 8. Safety requirements

- **Auth** on every state-changing entrypoint: admin or the registered governance
  contract only for allocation; any member for de-allocation.
- **Checked arithmetic** throughout (`checked_add`/`checked_sub`/`checked_mul`); overflow
  reverts. Release profile already has `overflow-checks = true`.
- **Checks-effects-interactions**: update `YieldShares`, `YieldCostBasis`, and member
  balances before any token/CPI transfer.
- **Reentrancy**: no external call happens before internal state is consistent; vault
  calls are treated as untrusted.
- **Events** for every fund movement: `ya_alloc`, `ya_deall`, `ya_sync`, `ya_bufset`,
  `ya_locked`.

## 9. Risks (documented, not hidden)

| Risk | Mitigation |
|---|---|
| **Vault custody** — funds sit in a third-party contract | Opt-in per group; vault address is proposed and voted on; emergency `YieldLocked` mode stops new allocations and forces de-allocation-only |
| **Share-value dependency** — a vault can lose value | `share_price` is read live; losses surface as reduced position value; pot never promises a return |
| **Illiquid withdrawal** — vault cannot redeem on demand | Liquidity buffer keeps a floor liquid; de-allocation degrades to partial and reverts with a clear error rather than trapping funds |
| **Rounding leakage** | All rounding favours the pot; remainders stay in the pool |
| **Unauthorised allocation** | Only the registered governance contract (or admin) may allocate; members can always de-allocate |

## 10. Deployment additions

- New wasm hash for `yield-vault` in `smartcontract/deployments/stellar-testnet.json`.
- `smartcontract/scripts/deploy.sh` builds and records it.
- Frontend env vars for the mock/real vault address (`NEXT_PUBLIC_YIELD_VAULT_ID`,
  optional — groups carry their own vault id once allocated).
- Flexible pool wasm hash bumped once the new entrypoints ship.

## 11. Commit mapping

1. `docs:` this specification.
2. `feat(contract):` adapter interface + types/errors/events.
3. `feat(contract):` mock vault.
4. `feat(contract):` allocation proposals + voting (extend governance `dispatch`).
5. `feat(contract):` allocate idle pot balance (enforce liquidity buffer).
6. `feat(contract):` de-allocation + buffer-safe withdraw.
7. `feat(contract):` pro-rata yield accounting/distribution.
8. `test(contract):` edge cases (illiquidity, rounding, double-vote, unauthorised, zero).
9. `feat(frontend):` bindings + client.
10. `feat(frontend):` service layer + data hooks.
11. `feat(frontend):` proposal creation flow.
12. `feat(frontend):` voting UI.
13. `feat(frontend):` yield dashboard (extend existing).
14. `feat(frontend):` withdraw/de-allocate flow with illiquidity states.
15. `test(frontend):` hook + component tests.
16. `docs:` threat model, README, testnet deploy script.
