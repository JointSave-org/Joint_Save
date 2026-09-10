-- base_schema.sql — test fixture reproducing the tables that predate this
-- repo's migrations.
--
-- `supabase/migrations/*.sql` are ALTERs/backfills ON TOP of a base schema
-- that was originally created out-of-band (Supabase dashboard / seed) and is
-- NOT committed. This fixture reconstructs the base state the migrations
-- assume, derived from the `Database` type in frontend/lib/supabase.ts
-- (tables/columns that migrations never create themselves) so that the whole
-- migration chain can be smoke-tested against a fresh Postgres.
--
-- Tables recreated here: pools, pool_members, pool_activity.
-- Everything else is created by a migration, so it is intentionally absent.
--
-- Applied in the test harness BEFORE any migration file.

-- `gen_random_uuid()` is core since PostgreSQL 13; no extension needed.

create table public.pools (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  description            text,
  type                   text not null default 'rotational',
  status                 text not null default 'active',
  creator_address        text not null,
  contract_address       text not null default 'pending_deployment',
  token_address          text,
  token_symbol           text not null default 'XLM',
  token_decimals         integer not null default 7,
  supported_tokens       jsonb not null default '[]',
  total_saved            numeric not null default 0,
  target_amount          numeric,
  progress               numeric not null default 0,
  members_count          integer not null default 0,
  next_payout            timestamptz,
  next_recipient         text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  contribution_amount    numeric,
  round_duration         integer,
  frequency              text,
  schedule_config        jsonb not null default '{}',
  pause_reason           text,
  paused_at              timestamptz,
  deadline               timestamptz,
  minimum_deposit        numeric,
  withdrawal_fee         numeric,
  yield_enabled          boolean not null default true,
  archived_at            timestamptz,
  archive_reason         text,
  completed_at           timestamptz,
  emergency_withdrawn_at timestamptz,
  constraint pools_status_valid check (
    status in ('active', 'completed', 'paused', 'emergency_withdrawn')
  )
);

create table public.pool_members (
  id                  uuid primary key default gen_random_uuid(),
  pool_id             uuid not null references public.pools(id) on delete cascade,
  member_address      text not null,
  contribution_amount numeric not null default 0,
  status              text not null default 'pending',
  joined_at           timestamptz not null default now()
);

create table public.pool_activity (
  id             uuid primary key default gen_random_uuid(),
  pool_id        uuid not null references public.pools(id) on delete cascade,
  activity_type  text not null,
  user_address   text,
  amount         numeric,
  token_amount   numeric,
  description    text,
  tx_hash        text,
  created_at     timestamptz not null default now()
);

-- RLS: the lockdown migration (20260624000000) is what enables RLS + creates
-- the per-table SELECT policies. Base tables start with RLS DISABLED so the
-- migration's `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` statements are
-- what the smoke test verifies put it in place.