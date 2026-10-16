# Vault-Backed Yield Allocation – Threat Model

This document records the threat model for the optional **vault-backed yield
allocation** feature on `flexible` pools. It complements the design
specification in [`docs/plans/2026-10-16-yield-allocation.md`](../plans/2026-10-16-yield-allocation.md)
and the on-chain safety requirements described there.

The feature lets a group vote to move idle pool capital into an external,
yield-bearing Soroban vault (the "vault") behind a `VaultAdapter` interface.
Capital not allocated stays liquid so member withdrawals always work.

---

## 1. Scope and trust boundaries

| Component | Trust level | Notes |
| --- | --- | --- |
| `flexible` pool contract | Trusted | Holds member principal; enforces the liquidity buffer |
| `governance` contract | Trusted | Only address allowed to allocate/de-allocate on behalf of the group |
| Group admin / members | Semi-trusted | Admin can allocate; any member can de-allocate |
| **Yield vault** (adapter target) | **Untrusted** | Third-party contract; may lie about share price, refuse redemption, or be upgraded by its own admin |
| Vault token / asset | Untrusted | Value can move independently of the pool |

The pool treats every vault as untrusted: it reads the vault's reported
`share_price` and `max_redeemable`, never assumes a redemption will succeed,
and never holds a vault call before its own state is consistent.

---

## 2. Assets at risk

- **Member principal** (`TotalBalance`, per-member `Balance`) — the pool's first obligation.
- **Buffered liquidity** — the portion of the pot deliberately kept out of the vault.
- **Realised yield** — credited pro-rata only after it is actually available.
- **Governance integrity** — who may move capital, and under what threshold.

---

## 3. Threats and mitigations

### 3.1 Vault custody — funds sit in a third-party contract

| | |
| --- | --- |
| **Threat** | A malicious or compromised vault keeps, freezes, or diverts deposited capital. |
| **Impact** | High — loss of allocated principal. |
| **Mitigation** | Allocation is **opt-in per group** and the vault address is proposed and passed through governance. A `YieldLocked` emergency mode stops new allocations and allows de-allocation only. Capital is never allocated above `max_allocatable` (buffer enforced on-chain). |

### 3.2 Share-value dependency — a vault can lose value

| | |
| --- | --- |
| **Threat** | The vault's share price falls; the position is worth less than cost basis. |
| **Impact** | Medium — members receive less than they deposited into the vault. |
| **Mitigation** | `share_price` is read live, so losses surface immediately as reduced position value. The pot **never promises a return**; yield is credited only when realised (position value above cost basis). |

### 3.3 Illiquid withdrawal — vault cannot redeem on demand

| | |
| --- | --- |
| **Threat** | Members try to withdraw while most capital is in the vault and the vault cannot redeem. |
| **Impact** | High — members temporarily cannot access their funds. |
| **Mitigation** | A configurable **liquidity buffer** (default 20%) keeps a floor liquid. On withdrawal the pool auto-pulls from the vault; if the vault cannot redeem the whole amount, the call **reverts with a clear `"vault illiquid"` error** rather than trapping or silently short-changing funds. De-allocation degrades to a partial withdrawal. |

### 3.4 Rounding leakage

| | |
| --- | --- |
| **Threat** | Division/rounding lets a member or the vault extract more than its share. |
| **Impact** | Low — dust leakage per operation. |
| **Mitigation** | All arithmetic is **integer-only** and rounds **in favour of the pot** (floor division for member credit, ceiling for allocation). remainders stay in the pool, never over-crediting a member. |

### 3.5 Unauthorised allocation

| | |
| --- | --- |
| **Threat** | An attacker (or a rogue admin) moves capital into an attacker-controlled vault. |
| **Impact** | High — theft of principal. |
| **Mitigation** | Every state-changing entrypoint calls `require_auth`. Allocation requires **admin or the registered governance contract**; the vault address must be a valid 56-byte strkey. Members can always de-allocate. Non-governance callers cannot forge a proposal. |

### 3.6 Arithmetic overflow / underflow

| | |
| --- | --- |
| **Threat** | Crafted amounts overflow `i128` maths and wrap. |
| **Impact** | High — mis-accounting. |
| **Mitigation** | `checked_add` / `checked_sub` / `checked_mul` throughout; the release profile sets `overflow-checks = true`; overflow reverts. |

### 3.7 Reentrancy via the vault

| | |
| --- | --- |
| **Threat** | A malicious vault re-enters the pool during a CPI and observes inconsistent state. |
| **Impact** | Medium–High — double-spend of accounting. |
| **Mitigation** | **Checks-effects-interactions**: `YieldShares`, `YieldCostBasis`, and member balances are updated **before** any token/CPI transfer. No external call happens before internal state is consistent. |

### 3.8 De-allocation traps funds

| | |
| --- | --- |
| **Threat** | A vault that only partially redeems causes the pool to strand capital. |
| **Impact** | Medium. |
| **Mitigation** | De-allocation performs a **partial** withdrawal and records what was actually received; the remainder stays recorded as vault shares, so accounting never assumes a full exit. |

### 3.9 Event forgery / missing audit trail

| | |
| --- | --- |
| **Threat** | Fund movements are not attributable after the fact. |
| **Impact** | Low–Medium. |
| **Mitigation** | Every movement emits an event: `ya_alloc`, `ya_deall`, `ya_sync`, `ya_bufset`, `ya_locked`. Vault-side mock events are gated so they never leak into consumers' wasm. |

---

## 4. Out of scope

- Compromise of the Stellar network or Soroban host.
- Economic/game-theoretic attacks on the **external vault's own** design (the
  pool treats it as untrusted and caps exposure via the buffer).
- Frontend-only issues (phishing UI, wallet compromise) — see the general
  security documentation.

---

## 5. Residual risk

Members accept that any capital allocated to a vault is exposed to that vault's
counterparty, liquidity, and smart-contract risk. The pool limits — but cannot
eliminate — this exposure: the buffer bounds the illiquid portion, governance
gates the vault choice, and emergency locking enables an exit. Groups that do
not want this risk simply never allocate (the feature is opt-in and a pool with
no vault behaves exactly as before).
