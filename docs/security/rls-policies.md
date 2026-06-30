# Row Level Security – Access Model

This document records the intended access model for every Supabase table in
JointSave. All tables have RLS explicitly enabled. The companion migration is
`supabase/migrations/20260624000000_rls_lockdown.sql`.

---

## Auth model

JointSave authenticates users by Stellar wallet address (Freighter, xBull,
etc.). It does **not** use Supabase Auth, so no Supabase JWT is present in
client-side requests. All client calls use the plain anon key.

Because of this, RLS policies that rely on `request.jwt.claims` cannot be used
for client-originated reads or writes. The approach taken is:

- **Sensitive writes** (user_profiles, notifications, join_requests,
  pool_activity, pool_members, deposit_reminders) go through Next.js API routes
  that use the service-role key. The service-role key bypasses RLS entirely, so
  these writes always succeed regardless of policies.
- **RLS policies** act as a safety net: they block anyone who tries to read or
  write sensitive data by hitting the Supabase REST API directly with the anon
  key (e.g. from a browser console).
- **Public data** (pools, pool_members, pool_activity, pool_daily_metrics,
  pool_health_scores, join_requests) has an explicit `USING (true)` SELECT
  policy, matching the current app behaviour where these lists are visible
  without a wallet.

---

## Table-by-table access model

### `pools`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| SELECT    | ✅ allowed (public explore) | ✅ |
| INSERT    | ❌ blocked | ✅ via `/api/pools` |
| UPDATE    | ❌ blocked | ✅ |
| DELETE    | ❌ blocked | ✅ |

### `pool_members`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| SELECT    | ✅ allowed (pool detail view) | ✅ |
| INSERT/UPDATE/DELETE | ❌ blocked | ✅ via `/api/pools` |

### `pool_activity`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| SELECT    | ✅ allowed (activity feed) | ✅ |
| INSERT    | ❌ blocked — prevents fake activity rows | ✅ via Edge Functions |
| UPDATE/DELETE | ❌ blocked | ✅ |

### `pool_daily_metrics` / `pool_health_scores`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| SELECT    | ✅ allowed (analytics charts) | ✅ |
| INSERT/UPDATE/DELETE | ❌ blocked | ✅ via scheduled Edge Functions |

### `user_profiles`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| SELECT    | ❌ blocked — no direct read of another wallet's email | ✅ via `/api/user-profile` |
| INSERT/UPDATE | ❌ blocked | ✅ via `/api/user-profile` |
| DELETE    | ❌ blocked | ✅ |

### `notifications`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| SELECT    | ❌ blocked — notification feed is private | ✅ via `/api/notifications` |
| INSERT    | ❌ blocked — created by Edge Functions only | ✅ |
| UPDATE (mark-read) | ❌ blocked | ✅ via `/api/notifications` |

Realtime `postgres_changes` subscriptions still work with the anon key because
Supabase Realtime uses channel-level security that is separate from RLS.

### `join_requests`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| SELECT    | ✅ allowed (filtered by poolId/requester in the API route) | ✅ |
| INSERT    | ❌ blocked | ✅ via `/api/join-requests` |
| UPDATE (accept/decline) | ❌ blocked — prevents self-approval | ✅ via `/api/join-requests` |
| DELETE    | ❌ blocked | ✅ |

### `deposit_reminders`

| Operation | Anon key | Service-role |
|-----------|----------|-------------|
| All ops   | ❌ blocked | ✅ via `send-deposit-reminders` Edge Function |

---

## Security test checklist

Run these from a browser console using only the anon key to confirm the lockdown:

```js
const { createClient } = supabase
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// 1. Read another wallet's email — expect empty array (RLS blocks all direct reads)
const { data } = await client.from('user_profiles').select('email')
console.assert(data?.length === 0, 'user_profiles should be empty for anon reads')

// 2. Insert a fake pool_activity row — expect RLS error
const { error } = await client.from('pool_activity').insert({
  pool_id: '<any-pool-id>', activity_type: 'deposit', user_address: '<your-wallet>', amount: 9999
})
console.assert(error !== null, 'pool_activity insert should be blocked')

// 3. Approve own join_request — expect RLS error (no UPDATE policy)
const { error: e2 } = await client.from('join_requests')
  .update({ status: 'accepted' }).eq('requester_address', '<your-wallet>')
console.assert(e2 !== null, 'join_requests self-approval should be blocked')

// 4. Read another user's notifications — expect empty array
const { data: notifs } = await client.from('notifications').select('*')
console.assert(notifs?.length === 0, 'notifications should be empty for anon reads')
```

All four assertions should pass.
