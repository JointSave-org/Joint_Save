# @jointsave/sdk

Typed TypeScript client for [JointSave](https://github.com/JointSave-org/Joint_Save) savings pools on Stellar Soroban.

> Status: early scaffolding (`0.x`). The public API is being built out; expect additions until `1.0`.

## Install

```bash
pnpm add @jointsave/sdk
```

## Usage

Import from the package root only:

```ts
import { SDK_VERSION } from "@jointsave/sdk";

console.log(SDK_VERSION);
```

Deep imports (`@jointsave/sdk/dist/...`) are unsupported and may change without a major version bump.

## Read API

`DataClient` wraps the versioned HTTP read models served by the app/indexer.
It accepts your own `fetch` and works in Node 18+ and browsers.

```ts
import { DataClient } from "@jointsave/sdk";

const api = new DataClient({ baseUrl: "https://jointsave.app" });

const page = await api.listPools({ status: "active", limit: 20 });
const detail = await api.getPool(page.items[0].id);
const history = await api.getPoolHistory(page.items[0].id);
const analytics = await api.getProtocolSummary();
```

Monetary fields from the HTTP API are display-unit numbers, not base-unit
`bigint`. The HTTP contract lives in [`docs/api/openapi.json`](../docs/api/openapi.json)
and is covered by an Ajv contract test. Routes marked `x-experimental` may
change shape; `DataClient` normalizes missing optional fields to documented
defaults. Failures raise `DataClientError` with `status`, `code`, and
`requestId`.

## Reliability

Before retrying anything that writes, check whether the first attempt may have
reached the network. `isRetryable()` classifies transient vs. deterministic
failures; `mayHaveReachedServer()` flags ambiguous transport errors.

```ts
import { withRpcRetry } from "@jointsave/sdk";

const pools = await withRpcRetry(() => client.factory.getPools(), { retries: 3 });
```

A send that times out returns its hash. **Look the hash up before resubmitting**:

```ts
const result = await client.pool.deposit("rotational", poolId, { member }, options);

if (result.status === "timeout") {
  const lookup = await client.lookupTransaction(result.hash);
  // success | failed | pending | not_found | timeout
  // pending: wait and look up again; never resubmit blindly.
}
```

`summarizeSimulation()` and `classifyContractError()` turn raw simulation and
host output into log-safe values. Inject `consoleTxLogger` (or your own
`TxLogger`) to receive redacted `build`/`simulate`/`sign`/`submit`/`confirm`/
`error` events; addresses and secrets are removed by default.

## Development

This package is standalone and has its own lockfile.

```bash
cd sdk
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build         # emit dist/ + .d.ts
pnpm test          # vitest
pnpm check:api     # fail if internal symbols leak from the root barrel
```

## Public API policy

- `src/index.ts` is the only public entry point.
- New exports are deliberate and reviewed; internal helpers stay unexported.
- `pnpm check:api` fails the build when a denylisted symbol is exported from the root.
- Breaking changes require a major version bump and a migration note.

## License

MIT
