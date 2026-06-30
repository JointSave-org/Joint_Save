# JointSave Architecture Documentation

## Project Overview

JointSave is a decentralized community savings platform built on Stellar's Soroban smart contract platform. It enables trusted groups to automate contributions, payouts, and transparency through blockchain technology, solving traditional problems in informal savings groups like missed payments, fraud, and lack of transparency.

The platform supports three distinct savings models:
- Rotational Mode: Members take turns receiving the full pool payout
- Target Pool Mode: Groups save toward a shared financial goal
- Flexible Pool Mode: Members deposit anytime with optional yield distribution

## System Architecture

### High-Level Architecture

```
  User (Browser / Wallet)
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│                   Frontend  ·  Next.js 14               │
│                                                         │
│   Landing Page   │   Dashboard   │   Group Detail       │
│   ─────────────────────────────────────────────         │
│   Stellar Wallets Kit  (Freighter · xBull · Lobstr)     │
└────────────────────────┬────────────────────────────────┘
                         │  signed transactions / view calls
          ┌──────────────┴──────────────┐
          ▼                             ▼
┌──────────────────┐         ┌─────────────────────┐
│  Stellar RPC     │         │   Supabase           │
│  (Soroban)       │         │   (PostgreSQL)        │
│                  │         │                      │
│  simulate tx     │         │  pool metadata       │
│  send tx         │         │  member lists        │
│  view calls      │         │  activity feed       │
└────────┬─────────┘         └─────────────────────┘
         │  on-chain execution
         ▼
┌─────────────────────────────────────────────────────────┐
│               Soroban Smart Contracts  ·  Rust/WASM     │
│                                                         │
│  ┌─────────────┐  ┌────────────┐  ┌────────────┐       │
│  │   Factory   │  │ Rotational │  │   Target   │       │
│  │  (registry) │  │    Pool    │  │    Pool    │       │
│  └─────────────┘  └────────────┘  └────────────┘       │
│                        ┌────────────┐                   │
│                        │  Flexible  │                   │
│                        │    Pool    │                   │
│                        └────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

**Data flow summary:**

| Step | What happens |
|------|-------------|
| 1. User action | User clicks deposit/withdraw/create in the frontend |
| 2. Build tx | Frontend builds a Soroban transaction via Stellar SDK |
| 3. Sign | Stellar Wallets Kit prompts user's wallet to sign |
| 4. Submit | Signed tx sent to Stellar RPC; result polled until confirmed |
| 5. On-chain | Smart contract executes, updates balances & emits events |
| 6. Off-chain | Activity recorded in Supabase for fast UI queries |
| 7. Refresh | Frontend re-fetches on-chain state and updates UI |

### Technology Stack

Frontend:
- Next.js 14 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Stellar SDK v15.0.1
- Stellar Wallets Kit
- Supabase client

Smart Contracts:
- Rust (Soroban SDK)
- WASM compilation target
- Stellar testnet deployment

Infrastructure:
- Vercel (frontend hosting)
- GitHub Actions (CI/CD)
- Supabase (database)
- Stellar Testnet


## Smart Contract Layer

> For the complete API reference (functions, events, storage keys, error conditions, and CLI examples) see **[docs/contract-api.md](docs/contract-api.md)**.

### Factory Contract

The Factory contract acts as the central registry for all deployed pool contracts. It enables inter-contract coordination and discovery.

Contract Address: `CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI`

Key Functions:
- `initialize(admin, token, treasury)`: One-time setup after deployment
- `register_rotational(caller, pool_id)`: Register a deployed rotational pool
- `register_target(caller, pool_id)`: Register a deployed target pool
- `register_flexible(caller, pool_id)`: Register a deployed flexible pool
- `set_treasury(new_treasury)`: Update treasury address (admin only)
- `all_rotational()`, `all_target()`, `all_flexible()`: Query registered pools

Storage:
- Admin address
- Token address (native XLM or custom token)
- Treasury address
- Lists of registered pool contract IDs (BytesN<32>)

### Rotational Pool Contract

Members take turns receiving the full pool payout. Each round has a fixed deposit amount and duration.

WASM Hash: `d350a325d8734263a3d7150c875555d8956e13a527fb3497d5141b8b3f3d2c74`

Key Functions:
- `initialize(token, members, deposit_amount, round_duration, treasury_fee_bps, relayer_fee_bps, treasury)`: Setup pool parameters
- `deposit(member)`: Member deposits their fixed contribution for current round
- `trigger_payout(relayer)`: Execute payout when round duration expires
- `is_active()`, `current_round()`, `members()`, `has_deposited(member)`, `next_payout_time()`: View functions

Lifecycle:
1. Initialize with member list and deposit amount
2. Each round: members deposit fixed amount
3. After round_duration: trigger_payout distributes funds to current beneficiary
4. Advance to next round until all members have received payout
5. Pool becomes inactive after final round

Fee Structure:
- Treasury fee (basis points): deducted from total collected
- Relayer fee (basis points): paid to caller of trigger_payout

### Target Pool Contract

Groups save toward a shared financial goal. Funds unlock when target is reached before deadline.

WASM Hash: `133a62226501fc5443e70007d79deeeb0b33fdf8c85c7fcd3cf16293bb5c7292`

Key Functions:
- `initialize(token, admin, members, target_amount, deadline)`: Setup goal and deadline
- `deposit(member, amount)`: Member contributes any amount toward target
- `withdraw(member)`: Withdraw proportional share after target is reached
- `refund(admin)`: Admin refunds all members if deadline passes without reaching target
- `balance_of(member)`, `total_deposited()`, `is_unlocked()`, `target_amount()`: View functions

Lifecycle:
1. Initialize with target amount and deadline (ledger sequence)
2. Members deposit variable amounts
3. Auto-unlock when total_deposited >= target_amount
4. Members withdraw proportional shares
5. If deadline passes without reaching target: admin triggers refund

### Flexible Pool Contract

Members deposit anytime with optional yield distribution. Most flexible savings model.

WASM Hash: `df6ff088fd79f13d8d03e72160434517fdb4a83b8c7bfdd887be4369805e0d6b`

Key Functions:
- `initialize(token, members, minimum_deposit, withdrawal_fee_bps, yield_enabled, treasury, treasury_fee_bps)`: Setup pool parameters
- `deposit(member, amount)`: Member deposits any amount >= minimum
- `withdraw(member, amount)`: Member withdraws with fee deduction
- `distribute_yield(admin, yield_amount)`: Distribute yield proportionally to all members
- `balance_of(member)`, `total_balance()`, `members()`, `is_active()`: View functions

Features:
- Variable deposit amounts (must meet minimum)
- Withdrawal fees (basis points)
- Optional yield distribution from external DeFi integrations
- Proportional yield allocation based on balance


### Storage TTL (Time-To-Live) Management

To prevent critical contract state expiry under Soroban's state archival rules, all persistent storage entries utilize a Time-To-Live (TTL) management strategy:

- **Bumping Thresholds**:
  - `LEDGER_THRESHOLD = 518400` (~30 days): Bumping is triggered if the remaining TTL falls below this sequence count.
  - `LEDGER_BUMP = 2592000` (~150 days): Storage entries have their TTL extended to this maximum.

- **Optimized O(1) Automatic Bumping**:
  To prevent gas exhaustion and out-of-gas (DoS) vulnerabilities on hot transaction paths, automatic state bumping is highly optimized:
  - Configuration/global keys are bumped collectively in an O(1) helper function `bump_config_state_internal` at the end of every state-changing method.
  - Member-specific keys (like individual `Balance` or transient flags like `HasDeposited`) are bumped individually in O(1) time within the methods that modify them (e.g. `deposit`, `withdraw`).

- **Administrative Sweep**:
  - Each contract exposes a public `bump_state(env: Env)` endpoint with no authentication required.
  - Calling this sweeps the contract, executing an O(N) loop to extend the TTL of all configuration keys and all registered member balance keys. This is useful for reviving long-lived pools that have had no user interaction for a long period.

- **Frontend Exposing & Warnings**:
  - The frontend caches and tracks `ttlDays` using the centralized `PoolDataProvider` context.
  - If a pool's storage lease is close to expiry (TTL < 7 days), the pool details view displays a warning alert banner with an "Extend Storage" button to allow users to trigger the manual `bump_state` sweep transaction.


## Frontend Architecture

### Application Structure

```
frontend/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Landing page
│   ├── layout.tsx                # Root layout with providers
│   ├── globals.css               # Global styles
│   ├── dashboard/
│   │   ├── page.tsx              # Dashboard with tabs
│   │   ├── create/[type]/
│   │   │   └── page.tsx          # Create pool form (rotational/target/flexible)
│   │   └── group/[id]/
│   │       └── page.tsx          # Group detail page
│   └── api/
│       └── pools/
│           └── route.ts          # API route for pool data
├── components/
│   ├── landing/                  # Landing page components
│   │   ├── hero.tsx
│   │   ├── features.tsx
│   │   ├── how-it-works.tsx
│   │   ├── security.tsx
│   │   ├── cta.tsx
│   │   ├── header.tsx
│   │   └── footer.tsx
│   ├── dashboard/                # Dashboard components
│   │   ├── dashboard-header.tsx
│   │   ├── dashboard-tabs.tsx
│   │   ├── my-groups.tsx         # Live on-chain balance enrichment
│   │   ├── profile.tsx           # Real stats from DB + on-chain
│   │   ├── transactions.tsx
│   │   └── create-group.tsx
│   ├── create-group/             # Pool creation forms
│   │   ├── rotational-form.tsx
│   │   ├── target-form.tsx
│   │   └── flexible-form.tsx
│   ├── group/                    # Group detail components
│   │   ├── group-details.tsx     # Live on-chain state display
│   │   ├── group-members.tsx
│   │   ├── group-actions.tsx     # Deposit/withdraw/payout actions
│   │   └── group-activity.tsx
│   ├── ui/                       # shadcn/ui components (57 files)
│   ├── web3-provider.tsx         # Stellar wallet integration
│   └── theme-provider.tsx        # Dark mode support
├── hooks/
│   ├── useJointSaveContracts.ts  # Main contract interaction hook (600+ lines)
│   ├── use-mobile.ts
│   └── use-toast.ts
├── lib/
│   ├── supabase.ts               # Supabase client & helpers
│   └── utils.ts                  # Utility functions
└── public/                       # Static assets
```

### Key Components

Landing Page:
- Hero section with CTA
- Features showcase
- How it works explanation
- Security highlights
- Footer with links

Dashboard:
- Tab navigation (My Groups, Create Group, Transactions, Profile)
- My Groups: displays user's pools with live on-chain balances
- Profile: real stats derived from DB queries and on-chain data
- Create Group: type selection and form routing

Group Detail:
- Live on-chain state display (balance, status, members)
- Action buttons (deposit, withdraw, trigger payout)
- Member list with contribution tracking
- Activity feed from Supabase


## Contract Interaction Layer

### useJointSaveContracts Hook

The central hook for all blockchain interactions. Located at `frontend/hooks/useJointSaveContracts.ts`.

Key Features:
- Deploy pool contracts from WASM hashes
- Initialize pools with parameters
- Register pools with factory
- Execute pool actions (deposit, withdraw, payout)
- Fetch live on-chain state (read-only view calls)
- Handle transaction signing and submission
- Poll for transaction confirmation

### Deployment Flow

1. Deploy Pool Contract:
   ```typescript
   const { deploy } = useDeployPool()
   const contractId = await deploy('rotational') // or 'target', 'flexible'
   ```
   - Uses `Operation.createCustomContract` with WASM hash
   - Generates random salt for unique contract ID
   - Returns new contract address

2. Initialize Pool:
   ```typescript
   const { initRotational } = useInitializePool()
   await initRotational(contractId, {
     token, members, depositAmount, roundDuration,
     treasuryFeeBps, relayerFeeBps, treasury
   })
   ```
   - Calls contract's `initialize` method
   - Sets up pool parameters in contract storage

3. Register with Factory:
   ```typescript
   const { register } = useRegisterPool('rotational')
   await register(callerAddress, contractId)
   ```
   - Registers pool in factory's on-chain registry
   - Non-fatal if factory not initialized (wrapped in try/catch)

4. Save to Database:
   ```typescript
   await supabase.from('pools').insert({
     contract_address: contractId,
     pool_type: 'rotational',
     // ... other metadata
   })
   ```
   - Stores pool metadata for fast queries
   - Links pool to creator and members

### Transaction Flow

All write operations follow this pattern:

1. Build Transaction:
   ```typescript
   const tx = new TransactionBuilder(account, {
     fee: BASE_FEE,
     networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
   })
     .addOperation(contract.call(method, ...args))
     .setTimeout(TX_TIMEOUT) // 300 seconds
     .build()
   ```

2. Simulate:
   ```typescript
   const simResult = await server.simulateTransaction(tx)
   if (rpc.Api.isSimulationError(simResult)) {
     throw new Error(`Simulation failed: ${simResult.error}`)
   }
   ```

3. Assemble & Sign:
   ```typescript
   const preparedTx = rpc.assembleTransaction(tx, simResult).build()
   const { signedTxXdr } = await kit.signTransaction(preparedTx.toXDR(), {
     networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
   })
   ```

4. Submit:
   ```typescript
   const result = await server.sendTransaction(
     new Transaction(signedTxXdr, STELLAR_NETWORK_PASSPHRASE)
   )
   ```

5. Poll for Confirmation:
   ```typescript
   let getResult = await server.getTransaction(result.hash)
   while (getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
     await new Promise(r => setTimeout(r, 1500))
     getResult = await server.getTransaction(result.hash)
   }
   ```

### Read-Only State Fetching

View calls don't require signing or fees:

```typescript
export async function fetchTargetState(
  contractId: string,
  userAddress?: string
): Promise<TargetPoolState> {
  const [unlockedVal, totalVal, targetVal] = await Promise.all([
    viewCall(contractId, "is_unlocked"),
    viewCall(contractId, "total_deposited"),
    viewCall(contractId, "target_amount"),
  ])
  
  let userBalance = 0n
  if (userAddress) {
    const balVal = await viewCall(contractId, "balance_of", addressVal(userAddress))
    userBalance = scValToBigInt(balVal)
  }
  
  return {
    isUnlocked: unlockedVal.b(),
    totalDeposited: scValToBigInt(totalVal),
    targetAmount: scValToBigInt(targetVal),
    userBalance,
  }
}
```

Used in:
- Group detail page: display live balances and status
- My Groups dashboard: enrich pool cards with on-chain data
- Profile page: calculate user's total saved across all pools


## Data Flow

### Pool Creation Flow

```
User fills form → Deploy contract → Initialize contract → Register with factory → Save to DB → Redirect to group page
```

Detailed steps:

1. User selects pool type (rotational/target/flexible)
2. User fills form with parameters:
   - Rotational: members, deposit amount, round duration, fees
   - Target: members, target amount, deadline
   - Flexible: members, minimum deposit, withdrawal fee, yield settings
3. Frontend validates input
4. Deploy contract from WASM hash
5. Initialize contract with parameters
6. Register contract with factory (non-fatal)
7. Save pool metadata to Supabase:
   - contract_address (uppercase, preserved)
   - pool_type
   - pool_name
   - creator_id
   - members array
   - parameters JSON
8. Create pool_members records for each member
9. Redirect to group detail page

### Deposit Flow (Rotational)

```
User clicks Deposit → Build tx → Simulate → Sign → Submit → Poll → Update UI
```

1. User navigates to group detail page
2. Frontend fetches on-chain state: `has_deposited(user)`
3. If not deposited: show Deposit button
4. User clicks Deposit
5. Build transaction calling `deposit(member)`
6. Simulate transaction
7. User signs in wallet
8. Submit transaction
9. Poll for confirmation
10. Record activity in Supabase
11. Refresh on-chain state
12. Update UI to show deposit confirmed

### Deposit Flow (Target/Flexible)

Similar to rotational, but user specifies amount:

1. User enters amount
2. Build transaction calling `deposit(member, amount)`
3. Follow same simulate → sign → submit → poll flow
4. On-chain state updates automatically
5. Frontend refetches state to show new balance

### Payout Flow (Rotational)

```
Relayer clicks Trigger Payout → Check time → Build tx → Sign → Submit → Distribute funds → Advance round
```

1. Frontend checks `next_payout_time` from on-chain state
2. If current time >= next_payout_time: enable Trigger Payout button
3. User (relayer) clicks button
4. Build transaction calling `trigger_payout(relayer)`
5. Contract logic:
   - Count deposits
   - Calculate fees (treasury + relayer)
   - Transfer payout to current beneficiary
   - Transfer fees to treasury and relayer
   - Reset deposit flags
   - Advance to next round or mark inactive
6. Record payout activity in Supabase
7. Refresh on-chain state
8. Update UI

### Withdrawal Flow (Target)

```
User clicks Withdraw → Check unlocked → Build tx → Sign → Submit → Transfer funds
```

1. Frontend checks `is_unlocked` from on-chain state
2. If unlocked: enable Withdraw button
3. User clicks Withdraw
4. Build transaction calling `withdraw(member)`
5. Contract transfers user's proportional share
6. Record activity in Supabase
7. Refresh on-chain state
8. Update UI


## Database Schema (Supabase)

### pools table

Stores pool metadata for fast queries and UI display.

```sql
CREATE TABLE pools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_address TEXT NOT NULL UNIQUE,  -- Uppercase preserved
  pool_type TEXT NOT NULL,                -- 'rotational', 'target', 'flexible'
  pool_name TEXT NOT NULL,
  description TEXT,
  creator_id UUID REFERENCES auth.users(id),
  token_address TEXT NOT NULL,            -- Uppercase preserved
  target_amount NUMERIC,                  -- For target pools
  deposit_amount NUMERIC,                 -- For rotational pools
  round_duration INTEGER,                 -- For rotational pools (seconds)
  minimum_deposit NUMERIC,                -- For flexible pools
  deadline_ledger INTEGER,                -- For target pools
  treasury_fee_bps INTEGER,
  relayer_fee_bps INTEGER,
  withdrawal_fee_bps INTEGER,
  yield_enabled BOOLEAN,
  status TEXT DEFAULT 'active',           -- 'active', 'completed', 'cancelled'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### pool_members table

Links users to pools they're part of.

```sql
CREATE TABLE pool_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  user_address TEXT NOT NULL,             -- Stellar address
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(pool_id, user_address)
);
```

### pool_activity table

Records all pool transactions for activity feed.

```sql
CREATE TABLE pool_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  user_address TEXT NOT NULL,
  activity_type TEXT NOT NULL,            -- 'deposit', 'withdraw', 'payout', 'refund'
  amount NUMERIC,
  tx_hash TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Data Consistency Strategy

Hybrid approach: DB for metadata, blockchain for source of truth

- Database stores:
  - Pool metadata (name, description, creator)
  - Member lists for fast queries
  - Activity history for feeds
  - User profiles and settings

- Blockchain stores:
  - Current balances
  - Pool state (active, unlocked, round number)
  - Deposit flags
  - All financial data

- Frontend:
  - Fetches DB data for initial render (fast)
  - Enriches with on-chain data in parallel (accurate)
  - Displays loading states during on-chain fetch
  - Falls back to DB values if on-chain fetch fails

Example (My Groups component):
```typescript
// 1. Fast initial render from DB
const { data: pools } = await supabase.from('pools').select('*')

// 2. Enrich with live on-chain data
const enrichedPools = await Promise.all(
  pools.map(async (pool) => {
    try {
      const state = await fetchTargetState(pool.contract_address)
      return {
        ...pool,
        total_saved: stroopsToXlm(state.totalDeposited),
        progress: (state.totalDeposited / state.targetAmount) * 100
      }
    } catch {
      return pool // Fallback to DB values
    }
  })
)
```


## Wallet Integration

### Stellar Wallets Kit

JointSave uses Stellar Wallets Kit for multi-wallet support.

Supported Wallets:
- Freighter (browser extension)
- xBull (browser extension)
- Albedo (web-based)
- Lobstr (mobile + web)

Configuration (`frontend/components/web3-provider.tsx`):

```typescript
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FreighterModule,
  xBullModule,
  AlbedoModule,
  LobstrModule,
} from "@stellar/wallets-kit"

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER,
  modules: [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
  ],
})
```

Key Features:
- Automatic wallet detection
- Unified API across wallets
- Transaction signing
- Network switching
- Account management

### Authentication Flow

1. User clicks "Connect Wallet"
2. Wallet selector modal appears
3. User selects wallet (Freighter, xBull, etc.)
4. Wallet prompts for permission
5. User approves connection
6. Frontend receives public key
7. Store address in React context
8. Enable wallet-dependent features

### Transaction Signing

All write operations require wallet signature:

```typescript
const { signedTxXdr } = await kit.signTransaction(preparedTx.toXDR(), {
  networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
})
```

User sees:
- Transaction details in wallet
- Fee amount
- Contract being called
- Method and parameters
- Approve/Reject buttons


## Deployment

### Smart Contract Deployment

Contracts are deployed to Stellar Testnet using the deployment script.

Script: `smartcontract/scripts/deploy.sh`

```bash
#!/bin/bash
set -e

# Build all contracts
stellar contract build

# Deploy factory
FACTORY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/jointsave_factory.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet)

# Install pool WASMs and get hashes
ROTATIONAL_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/jointsave_rotational.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet)

TARGET_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/jointsave_target.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet)

FLEXIBLE_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/jointsave_flexible.wasm \
  --source ADMIN_SECRET_KEY \
  --network testnet)

# Initialize factory
stellar contract invoke \
  --id $FACTORY_ID \
  --source ADMIN_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin ADMIN_ADDRESS \
  --token native \
  --treasury TREASURY_ADDRESS

# Save deployment info
echo "{
  \"factory\": \"$FACTORY_ID\",
  \"rotational_wasm\": \"$ROTATIONAL_HASH\",
  \"target_wasm\": \"$TARGET_HASH\",
  \"flexible_wasm\": \"$FLEXIBLE_HASH\",
  \"network\": \"testnet\",
  \"deployed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}" > deployments/stellar-testnet.json
```

Current Deployment (Testnet):
- Factory: `CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI`
- Rotational WASM: `d350a325d8734263a3d7150c875555d8956e13a527fb3497d5141b8b3f3d2c74`
- Target WASM: `133a62226501fc5443e70007d79deeeb0b33fdf8c85c7fcd3cf16293bb5c7292`
- Flexible WASM: `df6ff088fd79f13d8d03e72160434517fdb4a83b8c7bfdd887be4369805e0d6b`
- Network: Stellar Testnet
- Deployed: 2026-04-16

### Frontend Deployment

Frontend is deployed to Vercel with automatic deployments from GitHub.

Environment Variables:
```env
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_FACTORY_CONTRACT_ID=CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI
NEXT_PUBLIC_ROTATIONAL_WASM_HASH=d350a325d8734263a3d7150c875555d8956e13a527fb3497d5141b8b3f3d2c74
NEXT_PUBLIC_TARGET_WASM_HASH=133a62226501fc5443e70007d79deeeb0b33fdf8c85c7fcd3cf16293bb5c7292
NEXT_PUBLIC_FLEXIBLE_WASM_HASH=df6ff088fd79f13d8d03e72160434517fdb4a83b8c7bfdd887be4369805e0d6b
NEXT_PUBLIC_TOKEN_CONTRACT_ID=native
```

Build Command: `npm run build`
Output Directory: `.next`
Node Version: 18.x

### CI/CD Pipeline

GitHub Actions workflows:

1. Test Workflow (`.github/workflows/test.yml`):
   - Triggers on push/PR
   - Builds all 4 Soroban contracts
   - Verifies WASM artifacts
   - Runs contract tests

2. Deploy Workflow (`.github/workflows/deploy.yml`):
   - Manual trigger only
   - Builds contracts
   - Deploys to Stellar Testnet
   - Updates deployment JSON
   - Commits deployment info


## Security Considerations

### Smart Contract Security

Authorization:
- All write operations require `require_auth()` on caller
- Factory admin functions protected by admin address check
- Member-only operations verify membership before execution

Input Validation:
- Minimum member count (>=2)
- Positive amounts for deposits and targets
- Deadline validation (must be in future)
- Balance checks before withdrawals

Reentrancy Protection:
- State updates before external calls
- Token transfers use Stellar's built-in token contract
- No recursive calls between pool contracts

Fee Limits:
- Fee basis points capped at reasonable values
- Treasury and relayer fees deducted before payouts
- Withdrawal fees clearly communicated

### Frontend Security

Wallet Security:
- Never store private keys
- All signing happens in user's wallet
- Transaction details shown before signing
- Network passphrase validation

Input Sanitization:
- Form validation before submission
- Amount parsing with precision handling
- Address format validation (StrKey encoding)
- Contract ID normalization (uppercase)

API Security:
- Supabase Row Level Security (RLS) policies
- User authentication for sensitive operations
- Read-only public access for pool discovery
- Rate limiting on API routes

Transaction Safety:
- Simulation before signing (catch errors early)
- Timeout protection (300 seconds)
- Confirmation polling with retry limits
- Error handling with user-friendly messages

### Data Privacy

On-chain Data (Public):
- Pool parameters
- Member addresses
- Deposit amounts
- Transaction history
- All financial data

Off-chain Data (Supabase):
- Pool names and descriptions
- User profiles (optional)
- Activity metadata
- UI preferences

User Control:
- Users can participate with just a wallet address
- No email or personal info required
- Pseudonymous by default
- Optional profile enrichment


## Key Technical Decisions

### Why Stellar?

- Low transaction fees (~$0.00001 per operation)
- Fast finality (3-5 seconds)
- Energy efficient (no mining)
- Built-in token support
- Soroban smart contracts (Rust + WASM)
- Strong developer tooling

### Why Separate Deploy + Initialize?

Soroban contracts cannot deploy other contracts at runtime. The factory pattern requires:
1. Deploy pool contract from WASM hash
2. Initialize pool with parameters
3. Register pool ID with factory

This enables:
- Factory to track all pools on-chain
- Inter-contract coordination
- Upgradeable pool implementations (change WASM hash)
- Gas-efficient deployment (WASM uploaded once)

### Why Hybrid DB + Blockchain?

Database (Supabase):
- Fast queries for UI
- Full-text search
- User profiles
- Activity feeds
- Metadata storage

Blockchain (Stellar):
- Source of truth for balances
- Immutable transaction history
- Trustless execution
- No central authority
- Cryptographic guarantees

Hybrid approach:
- DB for fast initial render
- Blockchain for accurate financial data
- Parallel fetching for best UX
- Graceful fallbacks

### Why Uppercase Contract IDs?

Stellar strkeys (addresses starting with G or C) are case-insensitive in theory but the SDK requires uppercase for validation. Early bug: lowercasing addresses caused "Invalid contract ID" errors. Solution: preserve case from deployment, normalize to uppercase in SDK calls.

### Why 300 Second Timeout?

Initial 30-second timeout caused `txTooLate` errors when users took time to review transactions in their wallet. 300 seconds (5 minutes) provides comfortable buffer for:
- Wallet popup delays
- User review time
- Network congestion
- Mobile wallet switching

### Why Stellar SDK v15?

Upgraded from v12 to v15 to fix "Bad union switch: 1" XDR protocol mismatch. v15 changes:
- `SorobanRpc` → `rpc` namespace
- Updated XDR definitions
- Better TypeScript types
- Fixed protocol compatibility

### Why Explicit Wallet Modules?

Initial `allowAllModules()` caused MetaMask connection errors (MetaMask doesn't support Stellar). Solution: explicitly list Stellar-only wallets (Freighter, xBull, Albedo, Lobstr) to eliminate non-Stellar wallet interference.


## Performance Optimizations

### Frontend Performance

Code Splitting:
- Next.js automatic code splitting
- Dynamic imports for heavy components
- Route-based chunking
- Lazy loading for modals

Caching Strategy:
- Supabase query caching
- React Query for server state (future)
- Local storage for user preferences
- Service worker for offline support (future)

Parallel Data Fetching:
```typescript
// Fetch DB and on-chain data in parallel
const [dbPools, onChainStates] = await Promise.all([
  supabase.from('pools').select('*'),
  Promise.all(pools.map(p => fetchTargetState(p.contract_address)))
])
```

Optimistic Updates:
- Update UI immediately on user action
- Revert if transaction fails
- Show loading states during confirmation
- Toast notifications for feedback

### Smart Contract Optimization

Storage Efficiency:
- Use persistent storage for long-term data
- Minimize storage keys
- Pack data structures efficiently
- Clean up expired data

Gas Optimization:
- Batch operations where possible
- Minimize cross-contract calls
- Use view functions for reads (no fees)
- Efficient loop patterns

View Call Optimization:
- No signing required
- No fees charged
- Parallel fetching
- Cached results (frontend)

### Database Optimization

Indexes:
```sql
CREATE INDEX idx_pools_creator ON pools(creator_id);
CREATE INDEX idx_pools_type ON pools(pool_type);
CREATE INDEX idx_pool_members_user ON pool_members(user_address);
CREATE INDEX idx_pool_activity_pool ON pool_activity(pool_id);
CREATE INDEX idx_pool_activity_user ON pool_activity(user_address);
```

Query Optimization:
- Select only needed columns
- Use joins instead of multiple queries
- Limit results with pagination
- Filter at database level


## Error Handling

### Contract Errors

Common errors and solutions:

1. "Simulation failed: HostError: Error(WasmVm, InvalidAction)"
   - Cause: Contract logic assertion failed
   - Solution: Check contract state (is_active, has_deposited, etc.)
   - Example: Trying to deposit twice in same round

2. "Invalid contract ID: [lowercase-id]"
   - Cause: Contract ID not uppercase
   - Solution: Use `normalizeId()` to uppercase all IDs
   - Fixed in: `useJointSaveContracts.ts`

3. "txBadAuth"
   - Cause: Incorrect transaction signing
   - Solution: Use `new Transaction(signedTxXdr, passphrase)` not `TransactionBuilder.fromXDR`
   - Fixed in: v15 SDK upgrade

4. "txTooLate"
   - Cause: Transaction timeout too short
   - Solution: Increase timeout from 30s to 300s
   - Fixed in: `TX_TIMEOUT` constant

5. "Bad union switch: 1"
   - Cause: XDR protocol mismatch
   - Solution: Upgrade to Stellar SDK v15
   - Fixed in: `package.json`

### Frontend Error Handling

Try-Catch Blocks:
```typescript
try {
  const txHash = await deposit()
  toast.success('Deposit successful!')
} catch (error) {
  console.error('Deposit failed:', error)
  toast.error(error.message || 'Transaction failed')
}
```

Loading States:
```typescript
const [isLoading, setIsLoading] = useState(false)

const handleDeposit = async () => {
  setIsLoading(true)
  try {
    await deposit()
  } finally {
    setIsLoading(false)
  }
}
```

Graceful Degradation:
```typescript
// Fallback to DB values if on-chain fetch fails
try {
  const state = await fetchTargetState(contractId)
  return { ...pool, ...state }
} catch {
  return pool // Use DB values
}
```

User Feedback:
- Toast notifications for success/error
- Loading spinners during async operations
- Disabled buttons during processing
- Clear error messages


## Testing Strategy

### Smart Contract Testing

Unit Tests:
- Test each contract function in isolation
- Mock external dependencies
- Verify state changes
- Check authorization logic

Integration Tests:
- Test full deployment flow
- Test inter-contract calls (factory registration)
- Test multi-user scenarios
- Verify fee calculations

Test Framework:
- Soroban SDK test utilities
- Rust's built-in test framework
- GitHub Actions CI

Example Test:
```rust
#[test]
fn test_rotational_deposit() {
    let env = Env::default();
    let contract_id = env.register_contract(None, RotationalPool);
    let client = RotationalPoolClient::new(&env, &contract_id);
    
    // Initialize pool
    client.initialize(&token, &members, &amount, &duration, &fees, &treasury);
    
    // Test deposit
    client.deposit(&member1);
    assert!(client.has_deposited(&member1));
}
```

### Frontend Testing

Component Tests (Future):
- Jest + React Testing Library
- Test user interactions
- Mock wallet connections
- Verify UI state changes

E2E Tests (Future):
- Playwright or Cypress
- Test full user flows
- Real wallet integration (testnet)
- Screenshot comparisons

Manual Testing:
- Test on multiple wallets (Freighter, xBull)
- Test on mobile devices
- Test error scenarios
- Test network failures


## Future Enhancements

### Phase 2 – Enhancement

Yield Integrations:
- Connect flexible pools to Stellar DeFi protocols
- Automatic yield distribution
- Multiple yield strategies
- Risk-adjusted returns

Mobile App:
- React Native or Flutter
- Native wallet integration
- Push notifications for payouts
- Offline transaction queuing

Group Chat:
- In-app messaging per pool
- Encrypted communications
- Payment requests
- Activity notifications

Reputation System:
- On-chain reputation scores
- Deposit history tracking
- Payout reliability metrics
- Trust badges

### Phase 3 – Scale

Social Onboarding:
- Invite friends via link
- Social login options
- Profile customization
- Achievement system

Fiat On-Ramp:
- Credit card to XLM
- Bank transfer integration
- Local payment methods
- KYC compliance

Microloan Marketplace:
- Borrow against savings
- Peer-to-peer lending
- Credit scoring
- Collateralized loans

DAO Governance:
- Token-based voting
- Protocol parameter updates
- Treasury management
- Community proposals

### Technical Improvements

Smart Contracts:
- Upgradeable contract pattern
- Emergency pause functionality
- Multi-signature admin
- Automated yield strategies

Frontend:
- Progressive Web App (PWA)
- Offline support
- Real-time updates (WebSocket)
- Advanced analytics dashboard

Infrastructure:
- Mainnet deployment
- Multi-network support (testnet + mainnet)
- Decentralized hosting (IPFS)
- GraphQL API layer

Developer Experience:
- SDK for third-party integrations
- Webhook notifications
- REST API documentation
- Plugin system


## Appendix

### Glossary

Soroban: Stellar's smart contract platform using Rust and WASM

Strkey: Stellar's address encoding format (G... for accounts, C... for contracts)

Stroops: Smallest unit of XLM (1 XLM = 10,000,000 stroops)

WASM: WebAssembly, compilation target for Soroban contracts

Basis Points (bps): 1/100th of a percent (100 bps = 1%)

Ledger Sequence: Stellar's block number equivalent

XDR: External Data Representation, Stellar's serialization format

RPC: Remote Procedure Call, API for interacting with Stellar

Horizon: Stellar's REST API for historical data

Factory Pattern: Central registry contract that tracks deployed pool contracts

View Call: Read-only contract call that doesn't require signing or fees

### Useful Links

Documentation:
- Stellar Docs: https://developers.stellar.org
- Soroban Docs: https://soroban.stellar.org
- Stellar SDK: https://github.com/stellar/js-stellar-sdk
- Wallets Kit: https://github.com/stellar/stellar-wallets-kit

Tools:
- Stellar Laboratory: https://laboratory.stellar.org
- Stellar Expert: https://stellar.expert
- Freighter Wallet: https://freighter.app
- Stellar CLI: https://github.com/stellar/stellar-cli

Community:
- Stellar Discord: https://discord.gg/stellar
- Stellar Stack Exchange: https://stellar.stackexchange.com
- GitHub Discussions: https://github.com/stellar/soroban-docs/discussions

### Environment Setup

Prerequisites:
- Node.js 18+
- Rust 1.70+
- Stellar CLI
- Freighter wallet (or other Stellar wallet)

Smart Contract Setup:
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli

# Build contracts
cd smartcontract
stellar contract build
```

Frontend Setup:
```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local with your values
npm run dev
```

### Contact & Support

Project Repository: https://github.com/Sendi0011/Joint_Save
Live Demo: https://joint-save.vercel.app
Issues: https://github.com/Sendi0011/Joint_Save/issues

---

Document Version: 1.0
Last Updated: 2026-04-28
Network: Stellar Testnet
Status: Production Ready

