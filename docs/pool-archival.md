# Pool Archival and Cleanup

_Issue [#212](https://github.com/JointSave-org/Joint_Save/issues/212)_

As the platform grows, finished and abandoned pools accumulate in Explore and
My Groups. Archival moves those pools out of the default discovery views and
makes them read-only, without losing anything.

**Archival never deletes data.** An archived pool keeps every row it owned —
metadata, members, activity, daily metrics, messages, disputes. Its detail
page still renders, its activity feed is still readable, and CSV/PDF export
still works. The on-chain contract is immutable and completely unaffected;
archival is a Supabase-side visibility flag and nothing more. Every archival
is reversible by the pool admin in one click.

---

## Data model

`supabase/migrations/20260828000000_pool_archival.sql`

### `pools` — new columns

| Column                   | Type          | Notes                                                     |
| ------------------------ | ------------- | --------------------------------------------------------- |
| `archived_at`            | `timestamptz` | Null for active pools. The single source of truth.         |
| `archive_reason`         | `text`        | One of the four reasons below. Moves with `archived_at`.   |
| `completed_at`           | `timestamptz` | Anchors the 7-day completion grace period.                 |
| `emergency_withdrawn_at` | `timestamptz` | Anchors the 30-day emergency grace period.                 |

`completed_at` and `emergency_withdrawn_at` did not exist before this feature.
Without them the grace periods could not be applied — a pool would be archived
the moment its status flipped. Existing completed pools are backfilled from
`updated_at` so the first sweep gives them a grace period rather than
archiving them all at once. `pools.status` also gained
`emergency_withdrawn` alongside `active`, `completed`, and `paused`.

A `CHECK` constraint keeps `archived_at` and `archive_reason` in lockstep, so
no row can claim to be archived without saying why.

### `archive_log` — audit trail

One row per archive **and** per unarchive, automated or manual:

| Column         | Notes                                                    |
| -------------- | -------------------------------------------------------- |
| `pool_id`      | FK to `pools`, cascades on delete                        |
| `action`       | `archived` or `unarchived`                               |
| `reason`       | Same vocabulary as `pools.archive_reason`                |
| `triggered_by` | `cron`, or the wallet address that triggered it          |
| `automated`    | `true` for the daily sweep                               |
| `note`         | Free text — the sweep records the age that qualified it  |

Public `SELECT` (why a pool was archived is part of its visible history),
service-role writes only, matching `pool_activity` and `disputes`.

### Indexes

Explore and My Groups both filter on `archived_at IS NULL`, so the default
queries are backed by **partial** indexes covering only the active set:

- `idx_pools_active_created` — Explore feed
- `idx_pools_active_creator` — My Groups
- `idx_pools_archival_sweep` — the cron's own candidate scan
- `idx_pools_archived_at` — the Archived tab

Because the partial indexes only ever hold unarchived rows, the default views
get *faster* as pools are archived, not slower.

---

## Archival criteria

Implemented as pure functions in `frontend/lib/archival.ts`, so they are
testable without a database (`frontend/lib/archival.test.ts`, 30 tests).

| Reason                | Condition                                                                          |
| --------------------- | ---------------------------------------------------------------------------------- |
| `completed`           | `status = 'completed'` and `completed_at` older than **7 days**                     |
| `emergency_withdrawn` | `status = 'emergency_withdrawn'` and `emergency_withdrawn_at` older than **30 days** |
| `inactive_90d`        | `status = 'active'`, no `pool_activity` for **90 days**, **and** the pool holds no funds |
| `admin_archived`      | Never automated — only ever set by the manual endpoint                             |

### Why the inactivity rule checks the balance

"No activity for 90 days" on its own is not enough. A pool sitting quietly on
real member deposits is not dead, it is waiting — and hiding it from the
people whose money is in it would be a trust problem, not a cleanup. So
`inactive_90d` additionally requires the pool to hold nothing: never funded,
or fully withdrawn. The balance is derived from the activity feed (deposits
minus withdrawals and payouts), the same aggregation `/api/analytics` and the
metrics cron use, so all three agree on what "empty" means.

Two more guards in the same spirit:

- **Paused pools are exempt.** Pausing is a deliberate admin decision, and the
  sweep must not quietly undo it.
- **Unparseable or future timestamps fail closed** — a bad date keeps a pool
  visible rather than hiding it.

---

## The daily sweep

`POST` / `GET /api/cron/archive-pools`, scheduled in `vercel.json` at
**02:00 UTC**. Vercel Cron issues a `GET`, so `GET` is the real handler and
`POST` delegates to it for manual runs.

Each run:

1. Selects unarchived pools and their activity in two queries (not one query
   per pool).
2. Applies `evaluateArchival` to each.
3. Sets `archived_at` / `archive_reason`, re-asserting `archived_at IS NULL`
   in the `WHERE` so a manual archive landing mid-run is not overwritten.
4. Writes an `archive_log` row.
5. Notifies the pool admin with the reason in plain language and how to
   restore the pool.
6. Heartbeats into `cron_job_logs`, so it appears in `/api/cron/health`.

**Idempotent** — archived pools are excluded from the query *and* re-checked
by `evaluateArchival`, so a double run is a no-op.

**Safety valve** — a run that wants to archive more than 200 pools stops and
reports instead. At that volume a bad backfill or a clock problem is likelier
than a genuine cliff of dead pools, and the failure mode would be an emptied
Explore page.

`archive_log` and notification failures are collected and returned, not
thrown: neither should roll back an archival that already succeeded.

Auth is the same `Bearer ${CRON_SECRET}` header the other crons use.

### Running it by hand

```bash
curl -X POST https://<host>/api/cron/archive-pools \
  -H "Authorization: Bearer $CRON_SECRET"
```

Response:

```json
{ "scanned": 412, "archived": 7, "byReason": { "completed": 5, "inactive_90d": 2 }, "errors": [] }
```

---

## API

| Endpoint                          | Notes                                                             |
| --------------------------------- | ----------------------------------------------------------------- |
| `GET /api/pools?archived=`        | Omitted → active only (default). `true` → both. `only` → archived only. |
| `PUT /api/pools/[id]/archive`     | `{ admin_address, reason?, note? }` — pool creator only            |
| `PUT /api/pools/[id]/unarchive`   | `{ admin_address, note? }` — pool creator only                     |

The `archived` param applies to all four list branches of `GET /api/pools`
(explore, creator, member, fallback). The creator and explore branches filter
in the query so the partial indexes are used; the member branch filters after
the join, because `pools` is an embedded relation PostgREST cannot filter
without dropping the membership rows being paginated.

### Read-only enforcement

Hiding buttons is presentation, not enforcement. `lib/server/archival-guard.ts`
blocks writes aimed at an archived pool at the API boundary, returning `409`
with the archival reason:

- `PATCH /api/pools` (field updates and activity logging)
- `POST /api/pools/deposit`
- `POST /api/pools/messages`

A stale tab, a bookmarked request, or a direct `curl` therefore cannot mutate
an archived pool. `GET` paths are deliberately untouched — archived pools stay
fully readable and exportable.

---

## UI

- **Explore** — a "Show archived" switch, off by default. Archived pools
  render as grayed-out compact cards with an "Archived" badge.
- **My Groups** — "Active" and "Archived" tabs. The archived tab fetches
  lazily, only once opened, and pages independently of the active tab.
- **`components/shared/archived-pool-card.tsx`** — the compact row: name,
  type, badge, reason, completion date, member count, final TVL, and
  "View History". It skips the on-chain read, health badge, and sparkline that
  `PoolCard` performs — an archived pool's numbers are final, so per-card RPC
  calls would buy nothing and would make a long archived list expensive.
- **Pool detail page** — an archived pool leads with a banner stating that it
  is archived, why, and that nothing was lost. The actions column, lending
  tab, and yield dashboard do not mount at all; details, members, activity,
  audit logs, and export are unchanged, with the activity feed labelled
  historical. Admins see "Restore pool" in the banner, and a confirmed
  "Archive pool" control on active pools.

Tab and toggle state live in the URL, so an archived view survives a refresh
and a back navigation from a pool's history page.

All strings are translated in `messages/en.json` and `messages/es.json`.

---

## Rollback

The feature is a visibility layer, so backing it out is low-risk:

1. Remove the `/api/cron/archive-pools` entry from `vercel.json` to stop new
   archivals.
2. `UPDATE public.pools SET archived_at = NULL, archive_reason = NULL;`
   restores every pool to discovery. `archive_log` retains the history of what
   had been archived and why.

The columns and table can be left in place — they are additive and nullable.
