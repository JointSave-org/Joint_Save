# JointSave HTTP & Indexer API Contract

## Overview

JointSave exposes read models through both the web app's REST endpoints (`/api/*`) and indexer/subgraph infrastructure. The `@jointsave/sdk` provides a first-class, typed **`DataClient`** that consumes these routes consistently across Node.js and browser environments.

This directory contains the authoritative **OpenAPI 3.1** specification (`openapi.json`) for all consumed endpoints.

---

## Specification File

- **`docs/api/openapi.json`**: Authoritative OpenAPI 3.1 definition detailing schemas, query parameters, responses, and error envelopes.

---

## Core Conventions

### 1. Versioning
- Stable public endpoints follow semantic URL paths (e.g. `/api/v1/protocol/summary`).
- Routes undergoing refinement are labeled with `x-stability: experimental` in the OpenAPI schema.
- Breaking schema changes to response bodies will increment the path prefix.

### 2. Pagination Contract
All paginated collection endpoints adhere to the universal `Page<T>` interface:

```typescript
export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly total?: number;
}
```

- When `hasMore` is `true`, `nextCursor` contains an opaque string token to be passed in subsequent requests as `?cursor=<nextCursor>`.
- When `hasMore` is `false`, `nextCursor` is `null`.

### 3. Error Envelope
Non-2xx HTTP responses return a structured JSON error body:

```json
{
  "success": false,
  "error": "Human-readable error description",
  "code": "MACHINE_READABLE_ERROR_CODE"
}
```

The SDK's `DataClient` intercepts these status codes and raises a typed `DataClientError`:

```typescript
try {
  await client.getPool("invalid-id");
} catch (err) {
  if (err instanceof DataClientError) {
    console.error(err.status); // e.g. 404
    console.error(err.code);   // e.g. "HTTP_404" or "POOL_NOT_FOUND"
    console.error(err.message);
  }
}
```

### 4. Diagnostic Tracing
Every outbound request issued by `DataClient` includes a unique, anonymized UUIDv4 in the `X-Request-Id` header. Integrators can tap into this via the `onRequestId` constructor callback for logging and telemetry.
