# API Rate Limits

All routes under `frontend/app/api/` are protected by a lightweight
in-memory sliding-window rate limiter (`frontend/lib/rate-limit.ts`).

## Limits

| Category  | Limit        | Window   | Endpoints                                                                                                        |
| --------- | ------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| **Read**  | 30 req / min | 1 minute | `GET /api/pools` `GET /api/analytics` `GET /api/notifications` `GET /api/user-profile`                           |
| **Write** | 10 req / min | 1 minute | `POST /api/pools` `PATCH /api/pools` `POST /api/join-requests` `PUT /api/user-profile` `POST /api/notifications` |

## Key selection

The rate-limit key is resolved in priority order:

1. **Wallet address** (preferred) — read from the `wallet` query parameter or
   the `X-Wallet-Address` request header. Wallet addresses are validated
   on-chain before any write succeeds, making them the most reliable identity.
2. **IP address** (fallback) — taken from the first value in `X-Forwarded-For`,
   or `unknown` when no IP can be determined. Used only when no wallet address
   is present (e.g. unauthenticated explore browsing).

## Response on limit exceeded

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1719432000

{
  "error": "TOO_MANY_REQUESTS",
  "message": "Rate limit exceeded. Please slow down.",
  "retryAfterSec": 42
}
```

## Reasoning for chosen limits

### 30 req/min for reads

A user actively navigating the dashboard might:

- Load the pools list (1 request)
- Open a pool detail (1 request)
- Check analytics (1 request)
- Poll notifications (1 request every few seconds)

Even with aggressive polling, 30 requests per minute — roughly one every
2 seconds — comfortably covers all legitimate browsing patterns while
blocking scrapers and denial-of-service attempts against the Supabase
service-role key.

### 10 req/min for writes

Write actions (create pool, submit join request, update profile) are
intentionally rare in normal usage. A user creates a pool once per session
and submits join requests infrequently. 10 per minute is generous enough to
allow retries after a transient network error but tight enough to prevent
replay attacks, accidental double-submits from a buggy client, or automated
pool-spam against the service-role key.

## Implementation notes

- **No external dependency** — uses a plain `Map<string, number[]>` with
  per-key timestamp arrays. Appropriate for a single-instance Next.js
  deployment; for multi-instance deployments, replace the store with Redis.
- **Memory safety** — timestamps older than the window are pruned on every
  request, preventing unbounded growth.
- **Sliding window** — each request checks how many timestamps fall within
  the last `windowMs` milliseconds, giving smooth enforcement without the
  burst-at-boundary problem of fixed windows.
