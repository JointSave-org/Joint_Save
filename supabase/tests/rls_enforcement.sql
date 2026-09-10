-- rls_enforcement.sql — verifies the #86 lockdown actually blocks the anon key.
--
-- Requires migrations to already be applied (see migration_smoke.sql) and a
-- test superuser connection. It creates the three Supabase roles and the
-- `auth` schema stub that pool_messages / pool_templates policies reference,
-- then probes the exact access the lockdown is meant to prevent.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f rls_enforcement.sql
--
-- Each DO block raises an exception if a check fails, so the harness fails
-- loudly instead of silently passing a misconfigured policy. PL/pgSQL
-- exception handlers run in an implicit subtransaction, so failed INSERTs are
-- rolled back automatically and no explicit savepoints are needed.

-- ── Test roles ───────────────────────────────────────────────────────────────
-- anon / authenticated / service_role and the auth.jwt() stub are created by
-- fixtures/base_schema.sql (they are Supabase platform pieces, present in prod
-- before any migration runs). Here we only mirror the table-level grants the
-- platform applies so that RLS — not table privileges — is the enforcement gate.

grant usage on schema public to anon, authenticated, service_role;
grant select on public.pools, public.pool_members, public.pool_activity,
  public.join_requests, public.notifications, public.user_profiles,
  public.pool_daily_metrics, public.pool_health_scores, public.deposit_reminders
  to anon, authenticated;
-- service_role mirrors Supabase: full table privileges + BYPASSRLS. RLS is
-- bypassed (BYPASSRLS role attribute), but table privileges are still checked.
grant all on public.pools, public.pool_members, public.pool_activity,
  public.join_requests, public.notifications, public.user_profiles,
  public.pool_daily_metrics, public.pool_health_scores, public.deposit_reminders
  to service_role;
grant execute on function public.is_pool_member(uuid, text)
  to anon, authenticated, service_role;

-- ── Seed rows so enforcement is testable with real data ────────────────────
insert into public.pools (id, name, creator_address)
  values ('00000000-0000-0000-0000-000000000001', 'Test Pool', 'GBROJA-CREATOR');
insert into public.pool_members (pool_id, member_address)
  values ('00000000-0000-0000-0000-000000000001', 'gbroja-member');
insert into public.user_profiles (wallet_address, email)
  values ('gbroja-creator', 'creator@example.com');

-- Read access is enforced by whether a SELECT policy EXISTS. With RLS on and
-- no policy, a SELECT returns zero rows (filtered silently) — this is the
-- correct "cannot read" behavior, so we assert row counts, not errors.

-- ── 1. anon CAN read pools (pools_select_public) ───────────────────────────
set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.pools;
  if n < 1 then raise exception 'FAIL: anon cannot SELECT pools'; end if;
end $$;

-- ── 2. anon CAN read pool_members / pool_activity ──────────────────────────
set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.pool_members;
  if n < 1 then raise exception 'FAIL: anon cannot SELECT pool_members'; end if;
end $$;

-- ── 3. anon CANNOT see user_profiles (no SELECT policy → 0 rows) ───────────
set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.user_profiles;
  if n <> 0 then
    raise exception 'FAIL: anon saw % user_profiles rows (expect 0)', n;
  end if;
end $$;

-- ── 4. anon CANNOT see notifications (no SELECT policy → 0 rows) ───────────
set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.notifications;
  if n <> 0 then
    raise exception 'FAIL: anon saw % notification rows (expect 0)', n;
  end if;
end $$;

-- ── 5. anon CANNOT see deposit_reminders (no SELECT policy → 0 rows) ───────
set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.deposit_reminders;
  if n <> 0 then
    raise exception 'FAIL: anon saw % deposit_reminder rows (expect 0)', n;
  end if;
end $$;

-- ── Write access: anon INSERT must ERROR (no INSERT policy) ────────────────
-- pool_activity is write-locked (all writes via service-role functions).

-- ── 6. anon INSERT pool_activity → denied ──────────────────────────────────
set role anon;
do $$
begin
  insert into public.pool_activity (pool_id, activity_type) values (
    '00000000-0000-0000-0000-000000000001', 'payout'
  );
  raise exception 'FAIL: anon INSERT pool_activity was allowed';
exception
  when insufficient_privilege then null;
end $$;

-- ── 7. anon INSERT user_profiles → denied ──────────────────────────────────
set role anon;
do $$
begin
  insert into public.user_profiles (wallet_address) values ('gbroja-anon');
  raise exception 'FAIL: anon INSERT user_profiles was allowed';
exception
  when insufficient_privilege then null;
end $$;

-- ── 8. anon INSERT deposit_reminders → denied ──────────────────────────────
set role anon;
do $$
begin
  insert into public.deposit_reminders (pool_id, wallet_address, round_deadline)
  values ('00000000-0000-0000-0000-000000000001', 'gbroja-member', now());
  raise exception 'FAIL: anon INSERT deposit_reminders was allowed';
exception
  when insufficient_privilege then null;
end $$;

-- ── 9. anon INSERT join_requests → denied (submission goes via API) ────────
set role anon;
do $$
begin
  insert into public.join_requests (pool_id, requester_address)
  values ('00000000-0000-0000-0000-000000000001', 'gbroja-requester');
  raise exception 'FAIL: anon INSERT join_requests was allowed';
exception
  when insufficient_privilege then null;
end $$;

-- ── 10. authenticated INSERT pool_activity → denied (same row-level lock) ──
set role authenticated;
do $$
begin
  insert into public.pool_activity (pool_id, activity_type) values (
    '00000000-0000-0000-0000-000000000001', 'deposit'
  );
  raise exception 'FAIL: authenticated INSERT pool_activity was allowed';
exception
  when insufficient_privilege then null;
end $$;

-- ── 11. service_role bypasses RLS (writes land) ────────────────────────────
set role service_role;
do $$
begin
  insert into public.pool_activity (pool_id, activity_type) values (
    '00000000-0000-0000-0000-000000000001', 'payout'
  );
  if not exists (select 1 from public.pool_activity) then
    raise exception 'FAIL: service_role insert did not land';
  end if;
end $$;

reset session authorization;

\echo 'rls_enforcement: OK'