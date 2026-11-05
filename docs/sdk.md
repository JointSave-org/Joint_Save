# JointSave SDK — Integration Guide

`@jointsave/sdk` is a typed TypeScript client for JointSave savings pools on
Stellar Soroban. This guide covers the architecture, signer contract, network
switching, error taxonomy, testing, and security. For the complete public
surface, see the [SDK README](../sdk/README.md). For contract functions, see the
[contract API reference](contract-api.md). For REST models, see the
[HTTP API guide](api/README.md).

## Architecture

The SDK has six layers, all exported from the package root:

| Layer | Responsibility | Network access |
| --- | --- | --- |
| Config & constants | Networks, contract ids, units | None |
| Utilities | BigInt-safe amounts, addresses, ledger/time | None |
| ScVal & clients | Encode calls, simulate reads, sign/submit writes | Soroban RPC |
| Gating | Deterministic action eligibility from a snapshot | None |
| Diagnostics & recovery | Error taxonomy, redacted logs, retry, hash lookup | RPC for lookup |
| Data client | Paginated HTTP read models | App/indexer HTTP |

`JointSaveClient` is a facade. `factory`, `pool`, `governance`, `reputation`,
and `yieldVault` are created lazily. Reads use a dummy source account and
`simulateTransaction`; writes load the real account, call
`prepareTransaction` (fees + Soroban resources), invoke the injected signer,
submit, and poll to confirmation.

The SDK never reads environment variables, never stores keys, and never
imports a wallet library. That keeps it usable in browsers, Node, workers, and
tests with the same code.

## Install and configure

```bash
pnpm add @jointsave/sdk
```

```ts
import { JointSaveClient } from "@jointsave/sdk";

const client = new JointSaveClient({
  network: "testnet",
  contractIds: {
    factory: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
    reputation: "C…", // optional
    governance: "C…", // optional
    yieldVault: "C…", // optional
  },
});
```

Only `factory` is required. Optional contracts throw `MISSING_CONTRACT` when a
method needs an id that was not configured.

## Signer contract

```ts
import type { SignTransaction } from "@jointsave/sdk";

const signer: SignTransaction = async (xdr, options) => {
  // options: { networkPassphrase, accountId }
  return walletAdapter.signTransaction(xdr, {
    networkPassphrase: options.networkPassphrase,
  });
};
```

Rules:

- The input is an already-prepared transaction envelope. Do **not** rebuild or
  change fees, resources, or the sequence number.
- Return the signed envelope as base64 XDR.
- The passphrase must match the client's network. A mismatch fails at submit.
- The signer receives no secret key. Hardware wallets and browser extensions
  both fit this contract.
- If the user rejects, throw. The client wraps it as `SIGN_FAILED`; it never
  retries signing automatically.
- `accountId` is the transaction source. It must be the address the signer can
  authorize.

## Network switching

Networks are resolved from `NETWORKS`:

```ts
import { getNetworkConfig } from "@jointsave/sdk";

const testnet = getNetworkConfig("testnet");
const mainnet = getNetworkConfig("mainnet");
```

Each config includes `rpcUrl`, `horizonUrl`, `networkPassphrase`, `explorerUrl`,
and `nativeSacId`. Override endpoints when needed:

```ts
const client = new JointSaveClient({
  network: "mainnet",
  contractIds: { factory: mainnetFactoryId },
  rpcUrl: "https://my-rpc.example.com",
  horizonUrl: "https://my-horizon.example.com",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
});
```

Keep contract ids per network. A testnet factory id will not exist on mainnet.
The SDK does not guess or migrate ids between networks.

## Reading state

```ts
const registry = await client.factory.getPools();
const token = await client.factory.getToken();

const rotational = await client.pool.getRotationalState(poolId, member);
const target = await client.pool.getTargetState(poolId, member);
const flexible = await client.pool.getFlexibleState(poolId, member);
const balance = await client.pool.balanceOf("flexible", poolId, member);
```

Reads return native values. On-chain amounts are `bigint`; convert only at the
display boundary with `formatTokenAmount` / `fromBaseUnits`.

## Writing transactions

Every write takes `SendOptions`: `{ accountId, signer, fee?, timeoutSeconds?,
confirmTimeoutMs? }`.

```ts
const result = await client.pool.deposit(
  "flexible",
  poolId,
  { member, amount: toBaseUnits("25") },
  { accountId: member, signer }
);
```

`TxResult.status` is `pending | success | failed | timeout`. A `timeout` means
confirmation polling ended, not that the transaction failed. Use the returned
hash with `client.lookupTransaction(hash)` before doing anything else.

## Action gating

The gating engine is pure and deterministic. Build a snapshot from state you
already have, then ask for every action:

```ts
const snapshot = buildSnapshot({
  poolType: "target",
  status: "active",
  members,
  viewer,
  round: { deadlineSecs, completed: false, paidOut: false },
  balances,
  depositAmount,
  minimumDeposit,
  nowSecs: Math.floor(Date.now() / 1000),
});

const gates = computeActionEligibility(snapshot);
```

Each decision has `{ allowed, reason }`. Reasons are stable strings
(`not_member`, `pool_paused`, `below_minimum`, …). `describeGateReason` returns
user-facing copy. The engine never reads the clock; pass `nowSecs`.

Gating is a UX/preflight layer. Contracts remain the source of truth.

## Error taxonomy

### `JointSaveError`

| Code | Meaning | Retry? |
| --- | --- | --- |
| `MISSING_CONTRACT` | Required contract id not configured | No |
| `INVALID_ARGUMENT` | Bad amount, id, or parameter | No |
| `UNSUPPORTED` | Action not valid for this pool type | No |
| `ACCOUNT_ERROR` | Account/sequence load failed | Only if transient |
| `SIMULATION_FAILED` | Simulation/prepare failed | Only if transient |
| `SIGN_FAILED` | Wallet rejected or signing failed | No |
| `SUBMIT_FAILED` | RPC rejected the submission | Depends on cause |
| `TIMEOUT` | Confirmation did not arrive | Look up the hash |
| `DECODE_FAILED` | Missing/unreadable return value | No |
| `RPC_ERROR` | Transport/RPC failure on a read | Yes, if transient |

### `DataClientError`

`status` is the HTTP status or `null`; `code` is the server's machine code or
`HTTP_<status>` / `TIMEOUT` / `ABORTED` / `NETWORK_ERROR` /
`INVALID_ARGUMENT`; `requestId` is the generated diagnostic id.

### Contract diagnostics

`classifyContractError` maps host assertions to stable codes such as
`POOL_PAUSED`, `NOT_A_MEMBER`, `ALREADY_DEPOSITED`, `DEADLINE_PASSED`,
`INSUFFICIENT_BALANCE`, `UNAUTHORIZED`, and `YIELD_DISABLED`. It returns
`null` for failures that are not contract errors.

## Recovery flow

1. Call `isRetryable(error)` for idempotent reads. Use `withRpcRetry` for the
   retry loop.
2. For writes, call `mayHaveReachedServer(error)`.
3. If it may have landed, **do not resubmit**. Call
   `client.lookupTransaction(hash, { timeoutMs })`.
4. `pending` means keep polling the same hash. `not_found` after a single
   check means it was never seen. `timeout` means RPC calls kept failing.
5. Only resubmit after a deterministic failure or a confirmed `not_found` with
   a fresh sequence number.

Logs are redacted by default. `consoleTxLogger` emits one line per
`build`/`simulate`/`sign`/`submit`/`confirm`/`error` phase. Pass
`createRedactingLogger(logger, { includeAddresses: true })` only when your
telemetry policy allows addresses; secrets are always redacted.

## Testing advice

- Inject a structural `SorobanServer` into `JointSaveClient` to test reads and
  writes without a network. The interface is exported as `SorobanServer`.
- Use `nativeToScVal`/`scValToNative` in test servers to avoid hand-building
  XDR.
- Use a stub signer that returns the input XDR for type-level tests; use a real
  keypair only in isolated integration tests.
- For `DataClient`, pass a fake `fetch` and assert method, URL, headers,
  timeout, and error mapping. No network is required.
- Keep gating tests clock-free by passing `nowSecs`.

## Security notes

- Never log secret seeds. The SDK redacts `S…` strings and, by default, `G…` /
  `C…` addresses.
- Never pass a secret key to the SDK. Signers receive prepared XDR only.
- Validate user-supplied contract ids and addresses before calling
  (`isValidContractId`, `isValidStellarAccount`, `isValidSorobanAddress`).
- Treat `requestId` as telemetry, not identity. It is a random UUID.
- Confirm the network passphrase when switching between testnet and mainnet.
- Simulation is not a guarantee. Contracts can still fail between simulation
  and execution; handle `failed` and contract diagnostics.

## Parity with the frontend

The SDK mirrors the contract behavior used by
`frontend/hooks/useJointSaveContracts.ts` and the app's contract-error
taxonomy, but it is intentionally smaller:

| Frontend | SDK |
| --- | --- |
| React Query cache and hooks | Plain async clients; bring your own cache |
| Wallet Kit + tx queue | Injected `SignTransaction`; bring your own queue |
| Number display helpers | BigInt-safe `formatTokenAmount` / `fromBaseUnits` |
| App API routes | `DataClient` with typed models and route fallbacks |
| Supabase metadata | Not included; pass metadata through your app |
| Proposal enums encoded as symbols | Correct Soroban unit-enum encoding (`Vec<Symbol>`) |

The HTTP layer returns display-unit numbers because the app database stores
whole-token values; the on-chain layer always uses `bigint` base units. Do not
mix the two without converting.

## More documentation

- [SDK README](../sdk/README.md) — install, quick start, API groups
- [Contract API reference](contract-api.md) — functions, events, errors
- [HTTP API guide](api/README.md) and [OpenAPI 3.1 contract](api/openapi.json)
- [Yield allocation threat model](security/yield-allocation-threat-model.md)
- [RLS access model](security/rls-policies.md)
- [Transaction simulation plan](TX_SIMULATION_PLAN.md)
