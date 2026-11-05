# @jointsave/sdk

[![npm](https://img.shields.io/npm/v/@jointsave/sdk.svg)](https://www.npmjs.com/package/@jointsave/sdk)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-7B61FF.svg)](https://stellar.org/soroban)

Typed TypeScript client for [JointSave](https://github.com/JointSave-org/Joint_Save)
savings pools on Stellar Soroban. It covers on-chain reads and signed writes,
BigInt-safe amount utilities, deterministic action gating, contract-error
diagnostics, transaction recovery, and paginated HTTP read models — without
bundling a wallet, React, or Supabase.

> Status: `0.x`. The public surface is documented and guarded, but may still
> change in a minor release. See [Versioning & stability](#versioning--stability).

## Install

```bash
pnpm add @jointsave/sdk
```

Requires Node 18+ or a modern browser. The only runtime dependency is
`@stellar/stellar-sdk`.

## Quick start

```ts
import {
  JointSaveClient,
  toBaseUnits,
  type SignTransaction,
} from "@jointsave/sdk";

const client = new JointSaveClient({
  network: "testnet",
  contractIds: {
    factory: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
  },
});

const member = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
// Replace with a pool contract id from your deployment.
const poolId = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const state = await client.pool.getRotationalState(poolId, member);
console.log(state.isActive, state.currentRound, state.members.length);

// `wallet` is your app's wallet adapter, not part of the SDK.
declare const wallet: {
  signTransaction(xdr: string, options: { networkPassphrase: string }): Promise<string>;
};

const signer: SignTransaction = async (xdr, { networkPassphrase }) => {
  return wallet.signTransaction(xdr, { networkPassphrase });
};

const result = await client.pool.deposit(
  "rotational",
  poolId,
  { member },
  { accountId: member, signer }
);

console.log(result.hash, result.status);
```

The SDK never reads `process.env`, never holds a secret key, and never opens a
wallet popup itself. You pass network config and an injected signer.

## Clients

`JointSaveClient` is a lazy facade; each group is available as a property:

| Group | Property | What it does |
| --- | --- | --- |
| Factory | `client.factory` | Registry reads, token/treasury/version, pool registration |
| Pools | `client.pool` | Per-type state, members, rounds, balances, deposit/withdraw/payout |
| Governance | `client.governance` | Proposals, votes, execution, yield-allocation proposals |
| Reputation | `client.reputation` | Member scores, legacy scores, leaderboard |
| Yield vault | `client.yieldVault` | Allocation state, vault info, allocate/deallocate/sync |
| Recovery | `client.lookupTransaction(hash)` | Poll a submitted hash without throwing |

Reads simulate against a dummy source account and return native values. Writes
load the account sequence, build and prepare the transaction (fees + Soroban
resources), call your signer, submit, and poll for confirmation. A write that
cannot confirm returns `{ hash, status: "timeout" }` — keep the hash.

Pool writes are type-aware:

```ts
await client.pool.deposit("rotational", poolId, { member }, options);
await client.pool.deposit("target", poolId, { member, amount }, options);
await client.pool.deposit("flexible", poolId, { member, amount }, options);
await client.pool.withdraw("target", poolId, { member }, options); // after unlock
await client.pool.withdraw("flexible", poolId, { member, amount }, options);
await client.pool.triggerPayout(poolId, relayer, options);
```

Rotational pools pay out through `triggerPayout`; direct member withdrawals are
rejected as `UNSUPPORTED`.

## Domain types

All on-chain monetary values are **base-unit `bigint`** (stroops / token base
units), never floating point. Types are exported from the root:

- Configuration: `NetworkName`, `NetworkConfig`, `ContractIds`, `JointSaveConfig`
- Pools: `PoolType`, `PoolStatus`, `PoolConfig`, `PoolState`,
  `RotationalPoolState`, `TargetPoolState`, `FlexiblePoolState`, `Round`
- Governance: `GovernanceProposal`, `GovernanceProposalType`,
  `GovernanceProposalStatus`, `YieldProposalInput`
- Yield: `YieldAllocationState`
- Reputation: `ReputationData`, `ReputationScore`
- Transactions: `TxResult`, `TxPhase`, `ReadResult<T>`
- HTTP reads: `Page<T>`, `PoolSummary`, `PoolDetail`, `PoolEvent`,
  `ProtocolSummary`, `ReputationProfile`, `GovernanceProposalSummary`,
  `PortfolioSummary`

## Utilities

```ts
import {
  formatPercent,
  formatTokenAmount,
  fromBaseUnits,
  shortAddress,
  toBaseUnits,
  daysToLedgers,
  ledgerToTimestamp,
  isPastDeadline,
} from "@jointsave/sdk";

toBaseUnits("12.5", 7); // 125_000_000n
fromBaseUnits(125_000_000n); // "12.5"
formatTokenAmount(3_420n, { decimals: 9 }); // "0.0₅342"
formatPercent(2_000); // "20%"
shortAddress("GAAA…"); // "GAAA…WXYZ"
```

`toBaseUnits(bigint)` treats its input as already in base units and returns it
unchanged. Amount conversion is integer-only; decimal strings never pass
through floating point.

## Action gating

`buildSnapshot` + `computeActionEligibility` produce a deterministic decision
for every action. The engine never reads the clock or the network.

```ts
import {
  buildSnapshot,
  computeActionEligibility,
  describeGateReason,
  isGateAllowed,
} from "@jointsave/sdk";

const snapshot = buildSnapshot({
  poolType: "rotational",
  status: "active",
  members: [member],
  viewer: member,
  round: { deadlineSecs, completed: false, paidOut: false, funded: true },
  balances: { [member]: toBaseUnits("10") },
  depositAmount: toBaseUnits("10"),
  minimumDeposit: toBaseUnits("1"),
  nowSecs,
});

const gates = computeActionEligibility(snapshot);
if (!isGateAllowed(gates, "deposit")) {
  console.warn(describeGateReason(gates.deposit.reason, { poolType: "rotational" }));
}
```

Use it for UI affordances and preflight checks. On-chain checks remain
authoritative.

## Diagnostics & recovery

```ts
import {
  classifyContractError,
  consoleTxLogger,
  mayHaveReachedServer,
  summarizeSimulation,
  withRpcRetry,
} from "@jointsave/sdk";

const client = new JointSaveClient({
  network: "testnet",
  contractIds: { factory },
  logger: consoleTxLogger, // redacts addresses and secrets by default
});

const pools = await withRpcRetry(() => client.factory.getPools(), { retries: 3 });
```

A timed-out write returns its hash. **Look it up before resubmitting**:

```ts
const result = await client.pool.deposit("rotational", poolId, { member }, options);

if (result.status === "timeout") {
  const lookup = await client.lookupTransaction(result.hash);
  // success | failed | pending | not_found | timeout
  if (lookup.state === "pending") {
    // Wait and look up the same hash again. Never resubmit blindly.
  }
}
```

- `isRetryable(error)` — transient vs. deterministic failures.
- `mayHaveReachedServer(error)` — ambiguous transport failures that may have
  landed; pair with a hash lookup.
- `withRpcRetry(fn)` — exponential backoff with jitter for idempotent calls.
- `summarizeSimulation(simulation)` — instructions/bytes/fee without XDR.
- `classifyContractError(error)` — maps host assertions to stable codes.
- `redactText`, `createRedactingLogger`, `consoleTxLogger` — log-safe output.

## Data client

`DataClient` wraps the app/indexer's HTTP read models. It uses `fetch` and
`AbortController` only, so it is safe in Node and browsers.

```ts
import { DataClient } from "@jointsave/sdk";

const api = new DataClient({
  baseUrl: "https://jointsave.app",
  onRequestId: (id) => telemetry.trace(id),
});

let cursor: string | undefined;
do {
  const page = await api.listPools({
    status: "active",
    limit: 20,
    ...(cursor ? { cursor } : {}),
  });
  for (const pool of page.items) console.log(pool.name);
  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

Methods: `listPools`, `getPool`, `getPoolHistory`, `getProtocolSummary`,
`getReputation`, `getReputationLeaderboard`, `getGovernanceProposals`,
`getPortfolioSummary`.

HTTP amounts are **display-unit numbers**, unlike on-chain `bigint`. The
versioned contract lives in [`docs/api/openapi.json`](../docs/api/openapi.json);
see the [HTTP API guide](../docs/api/README.md).

## Error model

| Type | Use |
| --- | --- |
| `JointSaveError` | Config, simulation, sign, submit, transport, decode failures. Has `code`, `method`, `contract`, `cause`. |
| `DataClientError` | Non-2xx/HTTP transport failures. Has `status`, `code`, `requestId`, `body`, `cause`. |
| `ContractErrorDiagnostic` | Stable contract-assertion taxonomy (`POOL_PAUSED`, `NOT_A_MEMBER`, …). |
| `TxLookup` | Recovery result; never throws raw RPC errors. |

`JointSaveErrorCode`: `MISSING_CONTRACT`, `INVALID_ARGUMENT`, `UNSUPPORTED`,
`ACCOUNT_ERROR`, `SIMULATION_FAILED`, `SIGN_FAILED`, `SUBMIT_FAILED`,
`TIMEOUT`, `DECODE_FAILED`, `RPC_ERROR`.
`DataClientError.code`: `HTTP_<status>`, `TIMEOUT`, `ABORTED`,
`NETWORK_ERROR`, `INVALID_ARGUMENT`, or the server's machine code.

The full integration guide — signer contract, network switching, testing,
security, and frontend parity — is in [`docs/sdk.md`](../docs/sdk.md).

## Versioning & stability

- The package follows semver. Before `1.0`, breaking changes may land in a
  **minor** release (`0.x.0`); after `1.0`, they require a major release.
- Additive exports are minor releases. Fixes are patch releases.
- Deprecated APIs are marked `@deprecated`, documented in
  [`CHANGELOG.md`](./CHANGELOG.md), and kept for at least one minor release
  before removal.
- `src/index.ts` is the only public entry point. Deep imports
  (`@jointsave/sdk/dist/...`) are unsupported and may break without notice.
- `pnpm check:api` fails if an internal symbol leaks through the root barrel.

## Development

This package is standalone and has its own lockfile.

```bash
cd sdk
pnpm install
pnpm typecheck            # tsc --noEmit
pnpm build                # emit dist/ + .d.ts
pnpm typecheck:examples   # examples compile against dist
pnpm test                 # vitest
pnpm check:api            # public-API guard (run after build)
```

Examples live in [`examples/`](./examples). They import only from the package
root and contain no secrets.

## License

MIT
