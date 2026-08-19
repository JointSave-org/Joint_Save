# JointSave — Smart Contract API Reference

Complete API reference for the four Soroban contracts powering JointSave on Stellar.

**Network:** Stellar Testnet  
**RPC:** `https://soroban-testnet.stellar.org`  
**Explorer:** [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet)

---

## Table of Contents

- [Factory Contract](#factory-contract)
- [Rotational Pool Contract](#rotational-pool-contract)
- [Target Pool Contract](#target-pool-contract)
- [Flexible Pool Contract](#flexible-pool-contract)

---

## Factory Contract

### Overview

Central on-chain registry for all deployed JointSave pool contracts. Because Soroban contracts cannot deploy other contracts at runtime, pool contracts are deployed separately (via CLI or SDK) and then registered here. The factory stores the global token address, treasury, and the lists of all registered pool contract IDs.

**Use when:** discovering all pools of a given type, or verifying that a pool contract was registered by a trusted caller.

**Deployed address (testnet):** `CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI`

### Deployment

The factory is deployed directly from its WASM (not from a hash):

```bash
FACTORY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/jointsave_factory.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet)

stellar contract invoke \
  --id $FACTORY_ID \
  --source ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin GADMIN... \
  --token native \
  --treasury GTREASURY...
```

### Functions

| Function | Parameters | Returns | Auth Required | Description |
|---|---|---|---|---|
| `initialize` | `admin: Address`, `token: Address`, `treasury: Address` | `()` | `admin` | One-time setup after deployment. Sets admin, token, treasury, and initializes empty pool lists. |
| `register_rotational` | `caller: Address`, `pool_id: BytesN<32>` | `()` | `caller` | Appends a deployed rotational pool contract ID to the registry. |
| `register_target` | `caller: Address`, `pool_id: BytesN<32>` | `()` | `caller` | Appends a deployed target pool contract ID to the registry. |
| `register_flexible` | `caller: Address`, `pool_id: BytesN<32>` | `()` | `caller` | Appends a deployed flexible pool contract ID to the registry. |
| `set_treasury` | `new_treasury: Address` | `()` | stored `Admin` | Replaces the treasury address. Admin-only. |
| `token` | — | `Address` | None | Returns the configured token address. |
| `treasury` | — | `Address` | None | Returns the current treasury address. |
| `all_rotational` | — | `Vec<BytesN<32>>` | None | Returns all registered rotational pool IDs. |
| `all_target` | — | `Vec<BytesN<32>>` | None | Returns all registered target pool IDs. |
| `all_flexible` | — | `Vec<BytesN<32>>` | None | Returns all registered flexible pool IDs. |

### Events

| Event Topic | Event Body | Emitted When |
|---|---|---|
| `("rot_reg", caller: Address)` | `pool_id: BytesN<32>` | A rotational pool is registered. |
| `("tgt_reg", caller: Address)` | `pool_id: BytesN<32>` | A target pool is registered. |
| `("flx_reg", caller: Address)` | `pool_id: BytesN<32>` | A flexible pool is registered. |

### Storage Keys

| Key | Type | Lifetime | Description |
|---|---|---|---|
| `Admin` | `Address` | Persistent | Factory administrator address. |
| `Token` | `Address` | Persistent | SPL token address used across all pools. |
| `Treasury` | `Address` | Persistent | Treasury address to receive protocol fees. |
| `Rotational` | `Vec<BytesN<32>>` | Persistent | List of registered rotational pool contract IDs. |
| `Target` | `Vec<BytesN<32>>` | Persistent | List of registered target pool contract IDs. |
| `Flexible` | `Vec<BytesN<32>>` | Persistent | List of registered flexible pool contract IDs. |

### Error Conditions

| Assertion | Trigger Condition |
|---|---|
| (implicit auth panic) | `initialize` called by non-`admin` address. |
| (implicit auth panic) | `register_*` called without `caller` signature. |
| (implicit auth panic) | `set_treasury` called by non-`admin` address. |

> **Note:** `initialize` uses `admin.require_auth()` so the admin must be the transaction source or have authorized the call. Subsequent view calls like `token()` and `all_rotational()` panic with `unwrap()` if called before `initialize` (storage key absent).

### Example CLI Invocations

```bash
# Query token address
stellar contract invoke \
  --id CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI \
  --network testnet \
  -- token

# Register a rotational pool
stellar contract invoke \
  --id CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI \
  --source CALLER_SECRET_KEY \
  --network testnet \
  -- register_rotational \
  --caller GCALLER... \
  --pool_id <32-byte-hex-pool-id>

# List all registered target pools
stellar contract invoke \
  --id CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI \
  --network testnet \
  -- all_target

# Update treasury (admin only)
stellar contract invoke \
  --id CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI \
  --source ADMIN_SECRET_KEY \
  --network testnet \
  -- set_treasury \
  --new_treasury GNEWTREASURY...
```

---

## Rotational Pool Contract

### Overview

Implements a rotating savings group (known as a "tanda", "chit fund", or "susu" in various cultures). Members contribute a fixed amount each round; the full pot is paid out to one member per round in order. The pool ends after every member has received a payout.

**Use when:** a group of trusted members wants to take turns receiving a lump-sum payout funded by all members' equal contributions.

**WASM Hash (testnet):** `d350a325d8734263a3d7150c875555d8956e13a527fb3497d5141b8b3f3d2c74`

### Deployment

Pool contracts are deployed from an installed WASM hash, not from a file:

```bash
# Deploy a new rotational pool instance
NEW_POOL=$(stellar contract deploy \
  --wasm-hash d350a325d8734263a3d7150c875555d8956e13a527fb3497d5141b8b3f3d2c74 \
  --source CALLER_SECRET_KEY \
  --network testnet)

# Initialize (values are examples)
stellar contract invoke \
  --id $NEW_POOL \
  --source CALLER_SECRET_KEY \
  --network testnet \
  -- initialize \
  --token native \
  --members '["GMEMBER1...", "GMEMBER2...", "GMEMBER3..."]' \
  --deposit_amount 10000000 \
  --round_duration 604800 \
  --treasury_fee_bps 100 \
  --relayer_fee_bps 50 \
  --treasury GTREASURY...
```

> `deposit_amount` is in stroops (1 XLM = 10,000,000 stroops).  
> `round_duration` is in seconds.  
> Fee params are in basis points (100 bps = 1%).

### Functions

| Function | Parameters | Returns | Auth Required | Description |
|---|---|---|---|---|
| `initialize` | `token: Address`, `members: Vec<Address>`, `deposit_amount: i128`, `round_duration: u64`, `treasury_fee_bps: u32`, `relayer_fee_bps: u32`, `treasury: Address` | `()` | None | One-time setup. Sets all pool parameters, initializes `CurrentRound = 0`, and sets `NextPayoutTime = now + round_duration`. |
| `deposit` | `member: Address` | `()` | `member` | Member transfers `deposit_amount` tokens to the pool for the current round. Each member may deposit once per round. |
| `trigger_payout` | `relayer: Address` | `()` | `relayer` | Executes the payout for the current round. Distributes treasury fee, relayer fee, and net payout to current beneficiary. Advances the round or marks the pool inactive after the final round. |
| `is_active` | — | `bool` | None | Returns whether the pool is still running. |
| `current_round` | — | `u32` | None | Returns the zero-based index of the current round (also the index of the current beneficiary in the members list). |
| `members` | — | `Vec<Address>` | None | Returns the ordered member list. |
| `has_deposited` | `member: Address` | `bool` | None | Returns whether `member` has deposited for the current round. |
| `next_payout_time` | — | `u64` | None | Returns the Unix timestamp after which `trigger_payout` may be called. |
| `set_supported_tokens` | `admin: Address`, `tokens: Vec<Address>` | `()` | `admin` | Sets the allowed token allowlist. Once non-empty, `deposit` requires the pool's `Token` to be on this list (e.g. native XLM's SAC or USDC's SAC on Stellar). |
| `get_supported_tokens` | — | `Vec<Address>` | None | Returns the configured token allowlist. Empty by default (unrestricted). |

### Events

| Event Topic | Event Body | Emitted When |
|---|---|---|
| `("deposit", member: Address)` | `amount: i128` | A member completes their deposit for the round. |
| `("payout", beneficiary: Address)` | `net_amount: i128` | Payout distributed to current round's beneficiary (after fees). |
| `("complete",)` | `"pool_done": Symbol` | Final round completed; pool becomes inactive. |

### Storage Keys

| Key | Type | Lifetime | Description |
|---|---|---|---|
| `Token` | `Address` | Persistent | Token contract address. |
| `Treasury` | `Address` | Persistent | Treasury address for fee collection. |
| `Members` | `Vec<Address>` | Persistent | Ordered list of members; index = round number. |
| `DepositAmount` | `i128` | Persistent | Fixed deposit required from each member per round. |
| `RoundDuration` | `u64` | Persistent | Duration of each round in seconds. |
| `TreasuryFeeBps` | `u32` | Persistent | Treasury fee in basis points. |
| `RelayerFeeBps` | `u32` | Persistent | Relayer fee in basis points. |
| `CurrentRound` | `u32` | Persistent | Index of the active round. |
| `NextPayoutTime` | `u64` | Persistent | Unix timestamp when next payout becomes eligible. |
| `Active` | `bool` | Persistent | Whether the pool is accepting deposits and payouts. |
| `HasDeposited(Address)` | `bool` | Persistent (cleared each round) | Per-member deposit flag. Removed from storage after each `trigger_payout`. |
| `SupportedTokens` | `Vec<Address>` | Persistent | Allowlist of token contract addresses `deposit` will accept once set via `set_supported_tokens`. |

### Error Conditions

| Assertion Message | Trigger Condition |
|---|---|
| `"need >=2 members"` | `members.len() < 2` in `initialize`. |
| `"deposit must be > 0"` | `deposit_amount <= 0` in `initialize`. |
| `"round_duration must be > 0"` | `round_duration == 0` in `initialize`. |
| `"pool inactive"` | `deposit` or `trigger_payout` called after pool is marked inactive. |
| `"not a member"` | `deposit` called by an address not in the members list. |
| `"already deposited this round"` | `deposit` called by a member who already deposited this round. |
| `"too early"` | `trigger_payout` called before `NextPayoutTime` has elapsed. |
| `"no deposits this round"` | `trigger_payout` called when no member deposited this round. |
| `"token not supported"` | `deposit` called while `SupportedTokens` is non-empty and the pool's `Token` is not on the list. |

### Example CLI Invocations

```bash
export POOL=<rotational-pool-contract-id>

# Check if pool is active
stellar contract invoke --id $POOL --network testnet -- is_active

# Check current round
stellar contract invoke --id $POOL --network testnet -- current_round

# Check next payout time
stellar contract invoke --id $POOL --network testnet -- next_payout_time

# Check if a member has deposited this round
stellar contract invoke --id $POOL --network testnet \
  -- has_deposited --member GMEMBER1...

# Member deposits for current round
stellar contract invoke --id $POOL --source MEMBER_SECRET --network testnet \
  -- deposit --member GMEMBER1...

# Trigger payout (once round_duration has elapsed)
stellar contract invoke --id $POOL --source RELAYER_SECRET --network testnet \
  -- trigger_payout --relayer GRELAYER...
```

---

## Target Pool Contract

### Overview

Goal-based savings pool. Members deposit freely toward a shared target amount before a deadline (expressed as a ledger sequence number). When the total deposited reaches the target, funds unlock and members can withdraw their proportional share. If the deadline passes without hitting the target, the admin can trigger a full refund.

**Use when:** a group wants to save toward a specific collective goal (e.g., equipment purchase, shared event) with a deadline.

**WASM Hash (testnet):** `133a62226501fc5443e70007d79deeeb0b33fdf8c85c7fcd3cf16293bb5c7292`

### Deployment

```bash
NEW_POOL=$(stellar contract deploy \
  --wasm-hash 133a62226501fc5443e70007d79deeeb0b33fdf8c85c7fcd3cf16293bb5c7292 \
  --source CALLER_SECRET_KEY \
  --network testnet)

stellar contract invoke \
  --id $NEW_POOL \
  --source CALLER_SECRET_KEY \
  --network testnet \
  -- initialize \
  --token native \
  --admin GADMIN... \
  --members '["GMEMBER1...", "GMEMBER2..."]' \
  --target_amount 500000000 \
  --deadline 12345678
```

> `target_amount` is in stroops.  
> `deadline` is a Stellar ledger sequence number (not a Unix timestamp). Check current ledger via Horizon: `GET /ledgers?order=desc&limit=1`.

### Functions

| Function | Parameters | Returns | Auth Required | Description |
|---|---|---|---|---|
| `initialize` | `token: Address`, `admin: Address`, `members: Vec<Address>`, `target_amount: i128`, `deadline: u32` | `()` | None | One-time setup. Sets token, admin, members, target, and deadline. Initializes `TotalDeposited = 0`, `Active = true`, `Unlocked = false`. |
| `deposit` | `member: Address`, `amount: i128` | `()` | `member` | Transfers `amount` from member to the pool. Auto-unlocks the pool if this deposit brings `TotalDeposited >= target_amount`. |
| `withdraw` | `member: Address` | `()` | `member` | Transfers the member's full deposited balance back to them. Only callable after the pool is unlocked. |
| `refund` | `admin: Address` | `()` | stored `Admin` | Refunds all members their individual balances. Only callable by admin, only after deadline has passed, and only if the target was never reached. |
| `balance_of` | `member: Address` | `i128` | None | Returns the member's current deposited balance. |
| `total_deposited` | — | `i128` | None | Returns total tokens deposited across all members. |
| `is_unlocked` | — | `bool` | None | Returns whether the target has been reached and withdrawals are open. |
| `target_amount` | — | `i128` | None | Returns the savings target in stroops. |
| `set_supported_tokens` | `admin: Address`, `tokens: Vec<Address>` | `()` | `admin` | Sets the allowed token allowlist. Once non-empty, `deposit` requires the pool's `Token` to be on this list (e.g. native XLM's SAC or USDC's SAC on Stellar). |
| `get_supported_tokens` | — | `Vec<Address>` | None | Returns the configured token allowlist. Empty by default (unrestricted). |

### Events

| Event Topic | Event Body | Emitted When |
|---|---|---|
| `("deposit", member: Address)` | `amount: i128` | A member successfully deposits. |
| `("unlocked",)` | `new_total: i128` | Pool reaches or exceeds the target; withdrawals open. |
| `("withdraw", member: Address)` | `amount: i128` | Member withdraws their full balance. |
| `("refunded",)` | `()` | Admin triggers refund; all member balances returned. |

### Storage Keys

| Key | Type | Lifetime | Description |
|---|---|---|---|
| `Token` | `Address` | Persistent | Token contract address. |
| `Admin` | `Address` | Persistent | Pool administrator (can trigger refund). |
| `Members` | `Vec<Address>` | Persistent | List of authorized members. |
| `TargetAmount` | `i128` | Persistent | Collective savings goal in stroops. |
| `Deadline` | `u32` | Persistent | Ledger sequence number after which refund becomes available. |
| `TotalDeposited` | `i128` | Persistent | Running total of all member deposits. |
| `Active` | `bool` | Persistent | Whether the pool accepts deposits (set to `false` on `refund`). |
| `Unlocked` | `bool` | Persistent | Whether the target has been reached; gates `withdraw`. |
| `Balance(Address)` | `i128` | Persistent | Individual member deposit balance. |
| `SupportedTokens` | `Vec<Address>` | Persistent | Allowlist of token contract addresses `deposit` will accept once set via `set_supported_tokens`. |

### Error Conditions

| Assertion Message | Trigger Condition |
|---|---|
| `"need >=2 members"` | `members.len() < 2` in `initialize`. |
| `"target must be > 0"` | `target_amount <= 0` in `initialize`. |
| `"pool inactive"` | `deposit` called after the pool is marked inactive (post-refund). |
| `"not a member"` | `deposit` called by an address not in the members list. |
| `"amount must be > 0"` | `deposit` called with `amount <= 0`. |
| `"deadline passed"` | `deposit` called after `ledger.sequence() > deadline`. |
| `"token not supported"` | `deposit` called while `SupportedTokens` is non-empty and the pool's `Token` is not on the list. |
| `"target not reached yet"` | `withdraw` called before `Unlocked == true`. |
| `"nothing to withdraw"` | `withdraw` called by a member with zero balance. |
| `"not admin"` | `refund` called by an address other than the stored admin. |
| `"target reached, use withdraw"` | `refund` called after pool is already unlocked. |
| `"deadline not passed"` | `refund` called before `ledger.sequence() > deadline`. |

### Example CLI Invocations

```bash
export POOL=<target-pool-contract-id>

# Check savings target
stellar contract invoke --id $POOL --network testnet -- target_amount

# Check total deposited so far
stellar contract invoke --id $POOL --network testnet -- total_deposited

# Check if target reached and withdrawals open
stellar contract invoke --id $POOL --network testnet -- is_unlocked

# Check a member's balance
stellar contract invoke --id $POOL --network testnet \
  -- balance_of --member GMEMBER1...

# Member deposits toward goal
stellar contract invoke --id $POOL --source MEMBER_SECRET --network testnet \
  -- deposit --member GMEMBER1... --amount 50000000

# Member withdraws (only after target reached)
stellar contract invoke --id $POOL --source MEMBER_SECRET --network testnet \
  -- withdraw --member GMEMBER1...

# Admin refunds all (only after deadline passed, target not reached)
stellar contract invoke --id $POOL --source ADMIN_SECRET --network testnet \
  -- refund --admin GADMIN...
```

---

## Flexible Pool Contract

### Overview

Open-ended savings pool with variable deposit amounts, withdrawal fees, and optional proportional yield distribution. Members can deposit any amount above the minimum and withdraw at any time, paying a fee that goes to the treasury. An admin/relayer can distribute externally earned yield proportionally to all members with a balance.

**Use when:** a group wants a shared savings pool without fixed amounts or schedules, optionally connected to a yield source.

**WASM Hash (testnet):** `df6ff088fd79f13d8d03e72160434517fdb4a83b8c7bfdd887be4369805e0d6b`

### Deployment

```bash
NEW_POOL=$(stellar contract deploy \
  --wasm-hash df6ff088fd79f13d8d03e72160434517fdb4a83b8c7bfdd887be4369805e0d6b \
  --source CALLER_SECRET_KEY \
  --network testnet)

stellar contract invoke \
  --id $NEW_POOL \
  --source CALLER_SECRET_KEY \
  --network testnet \
  -- initialize \
  --token native \
  --members '["GMEMBER1...", "GMEMBER2..."]' \
  --minimum_deposit 1000000 \
  --withdrawal_fee_bps 50 \
  --yield_enabled true \
  --treasury GTREASURY... \
  --treasury_fee_bps 100
```

> `minimum_deposit` is in stroops.  
> Fee params are in basis points (100 bps = 1%).  
> `yield_enabled false` disables `distribute_yield` entirely.

### Functions

| Function | Parameters | Returns | Auth Required | Description |
|---|---|---|---|---|
| `initialize` | `token: Address`, `members: Vec<Address>`, `minimum_deposit: i128`, `withdrawal_fee_bps: u32`, `yield_enabled: bool`, `treasury: Address`, `treasury_fee_bps: u32` | `()` | None | One-time setup. Initializes all pool parameters. Sets `TotalBalance = 0`, `Active = true`. |
| `deposit` | `member: Address`, `amount: i128` | `()` | `member` | Transfers `amount` from member to pool. Amount must be >= `MinimumDeposit`. Updates member's individual balance and `TotalBalance`. |
| `withdraw` | `member: Address`, `amount: i128` | `()` | `member` | Withdraws `amount` from member's balance. Deducts `withdrawal_fee_bps` fee sent to treasury; net transferred to member. |
| `distribute_yield` | `admin: Address`, `yield_amount: i128` | `()` | `admin` | Distributes `yield_amount` tokens proportionally to all members with a positive balance. Only callable when `YieldEnabled = true`. Caller is `admin` — any address with auth can call this (no stored admin check beyond `require_auth`). |
| `balance_of` | `member: Address` | `i128` | None | Returns the member's current balance including any distributed yield. |
| `total_balance` | — | `i128` | None | Returns the total tokens held by the pool. |
| `members` | — | `Vec<Address>` | None | Returns the list of authorized members. |
| `is_active` | — | `bool` | None | Returns whether the pool is active. |
| `set_supported_tokens` | `admin: Address`, `tokens: Vec<Address>` | `()` | `admin` | Sets the allowed token allowlist. Once non-empty, `deposit` requires the pool's `Token` to be on this list (e.g. native XLM's SAC or USDC's SAC on Stellar). |
| `get_supported_tokens` | — | `Vec<Address>` | None | Returns the configured token allowlist. Empty by default (unrestricted). |

### Events

| Event Topic | Event Body | Emitted When |
|---|---|---|
| `("deposit", member: Address)` | `amount: i128` | A member deposits tokens. |
| `("withdraw", member: Address)` | `net_amount: i128` | A member withdraws (body is the net amount after fee). |
| `("yield",)` | `yield_amount: i128` | Yield is distributed to member balances. |

### Storage Keys

| Key | Type | Lifetime | Description |
|---|---|---|---|
| `Token` | `Address` | Persistent | Token contract address. |
| `Treasury` | `Address` | Persistent | Treasury address for withdrawal fee collection. |
| `Members` | `Vec<Address>` | Persistent | List of authorized members. |
| `MinimumDeposit` | `i128` | Persistent | Minimum deposit amount in stroops. |
| `WithdrawalFeeBps` | `u32` | Persistent | Fee charged on withdrawals in basis points. |
| `TreasuryFeeBps` | `u32` | Persistent | Treasury fee in basis points (stored for reference; used by caller/frontend). |
| `YieldEnabled` | `bool` | Persistent | Whether `distribute_yield` is callable. |
| `TotalBalance` | `i128` | Persistent | Sum of all member balances. |
| `Active` | `bool` | Persistent | Whether the pool is active. |
| `Balance(Address)` | `i128` | Persistent | Individual member balance including yield. |
| `SupportedTokens` | `Vec<Address>` | Persistent | Allowlist of token contract addresses `deposit` will accept once set via `set_supported_tokens`. |

### Error Conditions

| Assertion Message | Trigger Condition |
|---|---|
| `"need >=2 members"` | `members.len() < 2` in `initialize`. |
| `"minimum must be > 0"` | `minimum_deposit <= 0` in `initialize`. |
| `"pool inactive"` | `deposit` called when `Active == false`. |
| `"not a member"` | `deposit` called by an address not in the members list. |
| `"below minimum deposit"` | `deposit` called with `amount < MinimumDeposit`. |
| `"amount must be > 0"` | `withdraw` called with `amount <= 0`. |
| `"insufficient balance"` | `withdraw` called with `amount > member's balance`. |
| `"token not supported"` | `deposit` called while `SupportedTokens` is non-empty and the pool's `Token` is not on the list. |
| `"yield disabled"` | `distribute_yield` called when `YieldEnabled == false`. |
| `"yield must be > 0"` | `distribute_yield` called with `yield_amount <= 0`. |
| `"no balance"` | `distribute_yield` called when `TotalBalance == 0`. |

### Example CLI Invocations

```bash
export POOL=<flexible-pool-contract-id>

# Check pool status
stellar contract invoke --id $POOL --network testnet -- is_active

# Check total balance in pool
stellar contract invoke --id $POOL --network testnet -- total_balance

# Check a member's balance
stellar contract invoke --id $POOL --network testnet \
  -- balance_of --member GMEMBER1...

# List all members
stellar contract invoke --id $POOL --network testnet -- members

# Member deposits
stellar contract invoke --id $POOL --source MEMBER_SECRET --network testnet \
  -- deposit --member GMEMBER1... --amount 10000000

# Member withdraws partial amount (fee deducted automatically)
stellar contract invoke --id $POOL --source MEMBER_SECRET --network testnet \
  -- withdraw --member GMEMBER1... --amount 5000000

# Distribute yield to all members (yield_enabled must be true)
stellar contract invoke --id $POOL --source ADMIN_SECRET --network testnet \
  -- distribute_yield --admin GADMIN... --yield_amount 1000000
```

---

## Fee Formula Reference

All fee calculations use basis points (bps). 100 bps = 1%.

```
fee     = (amount × fee_bps) / 10000
net     = amount − fee
```

**Rotational payout example** — 3 members × 10 XLM = 30 XLM collected, treasury_fee_bps = 100, relayer_fee_bps = 50:

```
treasury_cut = (30_000_000 × 100) / 10000 = 300_000 stroops (0.03 XLM)
relayer_cut  = (30_000_000 × 50)  / 10000 = 150_000 stroops (0.015 XLM)
payout       = 30_000_000 − 300_000 − 150_000 = 29_550_000 stroops (2.955 XLM)
```

**Flexible withdrawal example** — withdraw 10 XLM, withdrawal_fee_bps = 50:

```
fee = (10_000_000 × 50) / 10000 = 50_000 stroops (0.005 XLM)
net = 10_000_000 − 50_000 = 9_950_000 stroops (0.995 XLM)
```

---

## Units & Conversions

| Term | Value |
|---|---|
| 1 XLM | 10,000,000 stroops |
| 1 basis point (bps) | 0.01% |
| 100 bps | 1% |
| Deadline unit | Ledger sequence number (not Unix timestamp) |
| Round duration unit | Seconds (compared to `ledger().timestamp()`) |
