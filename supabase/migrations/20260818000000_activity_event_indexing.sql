-- On-chain event indexing (issue #210): enrich pool_activity rows with the
-- on-chain data needed to verify a transaction on Stellar Explorer, and track
-- indexing progress per pool so re-index runs never re-read old ledgers.
--
-- `pool_activity.tx_hash` already exists (see ARCHITECTURE.md schema), so only
-- the enrichment columns are added here. Backfill note: SQL cannot call
-- Horizon, so historical rows are enriched lazily by the first
-- POST /api/pools/[id]/index-events run for each pool (it fills
-- on_chain_timestamp / block_number / fee_charged for any row that already has
-- a tx_hash).

alter table public.pool_activity
  add column if not exists on_chain_timestamp timestamptz;

alter table public.pool_activity
  add column if not exists block_number bigint;

-- Fee in stroops as reported by Horizon's fee_charged.
alter table public.pool_activity
  add column if not exists fee_charged bigint;

-- Indexes for the new per-pool filter/sort query patterns.
create index if not exists idx_pool_activity_pool_created
  on public.pool_activity (pool_id, created_at desc);

create index if not exists idx_pool_activity_pool_type
  on public.pool_activity (pool_id, activity_type);

-- One row per pool recording how far indexing has progressed.
-- (The issue sketch uses `pool_id text`; a uuid FK is used instead so rows are
-- cleaned up with their pool and cannot reference a nonexistent one.)
create table if not exists public.event_index_log (
  id bigserial primary key,
  pool_id uuid not null unique references public.pools(id) on delete cascade,
  last_indexed_ledger bigint not null default 0,
  indexed_at timestamptz not null default now()
);

-- RLS: public read (the activity feed shows "Last indexed"), writes via the
-- service-role key only — same model as pool_activity in
-- 20260624000000_rls_lockdown.sql.
alter table public.event_index_log enable row level security;

create policy "event_index_log_select_public"
  on public.event_index_log for select
  using (true);

-- No INSERT/UPDATE/DELETE policy = anon callers cannot forge indexing state.
