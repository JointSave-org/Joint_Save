# JointSave Read API

`openapi.json` is the versioned HTTP contract for the read models consumed by
`@jointsave/sdk`'s `DataClient`. The app and the indexer serve the same JSON
shapes, so an integrator can switch origins without changing their types.

## Versioning

- `/api/v1/protocol/summary` is explicitly versioned. Breaking changes get a
  new path (`/api/v2/...`) and the old path stays available for at least one
  release cycle.
- The remaining routes are pre-1.0 read endpoints. They are additive-only where
  possible; routes marked `x-experimental` in `openapi.json` may change shape.
- The SDK version and the API version are independent. `DataClient` normalizes
  missing optional fields to documented defaults instead of throwing.

## Pagination

Collections use cursor pagination:

```json
{
  "items": [],
  "nextCursor": "opaque-or-null",
  "hasMore": false,
  "total": 0
}
```

- `nextCursor` is opaque. Do not parse or construct it.
- `total` is optional.
- `limit` is a hint; servers may return fewer rows.
- Legacy endpoints that return a bare array are treated as a single page.

## Errors

Non-2xx responses use:

```json
{ "error": "Human-readable message", "code": "MACHINE_READABLE_CODE" }
```

`DataClient` raises `DataClientError` with `status`, `code`, `requestId`, and
the parsed `body`. Transport failures use `NETWORK_ERROR`, `TIMEOUT`, or
`ABORTED` and have `status: null`. Contract failures are never retried blindly;
use `mayHaveReachedServer()` + `client.lookupTransaction(hash)` first.

## Request ids

`DataClient` adds `x-request-id` when Web Crypto is available. The id is a
random UUID and never contains wallet identity. Use `onRequestId` to attach it
to your own telemetry.

## Route notes

- `GET /api/pools/{id}` is the preferred detail route. The current app also
  serves `GET /api/pools?id={id}`; `DataClient.getPool()` falls back on 404.
- `GET /api/pools/history` is the canonical event history. The current app
  returns daily sparkline balances from it, so `DataClient.getPoolHistory()`
  falls back to `GET /api/pools/{id}/activity` for event rows.
- `GET /api/reputation` and `GET /api/governance` are `x-experimental`; the
  current app exposes leaderboard and vote-mirror data on those paths.
- Contract tests live in
  `sdk/src/data/__tests__/httpContract.test.ts` and validate fixtures against
  the schemas in `openapi.json`.

## Updating the contract

1. Change `openapi.json` first.
2. Update `sdk/src/data/models.ts` and `client.ts` normalizers.
3. Add or update fixtures in the contract test.
4. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm check:api` from
   `sdk/`.
