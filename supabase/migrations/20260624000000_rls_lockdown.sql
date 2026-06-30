-- Migration: Full RLS lockdown across all Supabase tables
-- Issue: #86 – database-backed RLS policies audit
--
-- Identity model: this app uses wallet addresses for identity, not Supabase Auth.
-- All client-side code uses the anon key with no JWT claims.
-- Writes to sensitive tables (user_profiles, notifications, pool_activity,
-- pool_members, pool_daily_metrics, pool_health_scores, deposit_reminders)
-- go through server-side Next.js API routes backed by the service-role key,
-- which bypasses RLS by design.
-- The policies below lock down direct anon-key access as a safety net.

-- ============================================================
-- pools
-- ============================================================
ALTER TABLE public.pools ENABLE ROW LEVEL SECURITY;

-- Public read — Explore page works without a wallet
CREATE POLICY "pools_select_public"
  ON public.pools FOR SELECT
  USING (true);

-- Writes go through /api/pools (service-role key); block direct anon writes
-- No INSERT/UPDATE/DELETE policy = denied for anon/authenticated without service-role

-- ============================================================
-- pool_members
-- ============================================================
ALTER TABLE public.pool_members ENABLE ROW LEVEL SECURITY;

-- Public read — member lists are shown in pool detail views
CREATE POLICY "pool_members_select_public"
  ON public.pool_members FOR SELECT
  USING (true);

-- All writes are via service-role API routes only

-- ============================================================
-- pool_activity
-- ============================================================
ALTER TABLE public.pool_activity ENABLE ROW LEVEL SECURITY;

-- Public read — activity feeds are shown in pool detail views
CREATE POLICY "pool_activity_select_public"
  ON public.pool_activity FOR SELECT
  USING (true);

-- All writes are via service-role Edge Functions only.
-- No INSERT policy = anon callers cannot insert fake activity rows.

-- ============================================================
-- pool_daily_metrics
-- ============================================================
ALTER TABLE public.pool_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pool_daily_metrics_select_public"
  ON public.pool_daily_metrics FOR SELECT
  USING (true);

-- ============================================================
-- pool_health_scores
-- ============================================================
ALTER TABLE public.pool_health_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pool_health_scores_select_public"
  ON public.pool_health_scores FOR SELECT
  USING (true);

-- ============================================================
-- user_profiles
-- ============================================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- No SELECT policy — direct anon reads are blocked.
-- The app reads via /api/user-profile (service-role key).
-- No INSERT/UPDATE/DELETE policy — all writes go through /api/user-profile.

-- ============================================================
-- notifications
-- ============================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- No SELECT policy — direct anon reads are blocked.
-- The app reads via /api/notifications (service-role key).
-- No INSERT/UPDATE/DELETE policy for anon callers.
-- Realtime subscriptions (postgres_changes) still work via the anon key
-- because Realtime uses its own channel-level security separate from RLS.

-- ============================================================
-- join_requests  (drop old incomplete policies, add full set)
-- ============================================================
ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can create join requests" ON public.join_requests;
DROP POLICY IF EXISTS "Pool creator can view join requests" ON public.join_requests;

-- Public read — requesters and creators both need to see requests;
-- the app already filters server-side by poolId / requesterAddress
CREATE POLICY "join_requests_select_public"
  ON public.join_requests FOR SELECT
  USING (true);

-- Submitting a request goes through /api/join-requests (service-role key)
-- No INSERT/UPDATE/DELETE policy for direct anon callers

-- ============================================================
-- deposit_reminders
-- ============================================================
ALTER TABLE public.deposit_reminders ENABLE ROW LEVEL SECURITY;

-- No policies — all access is via the send-deposit-reminders Edge Function
-- using the service-role key.
