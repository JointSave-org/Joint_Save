-- Migration: Create cron_job_logs table for tracking scheduled job executions
-- (initially: the auto-trigger-payouts cron). Records one row per pool
-- processed, plus a pool_id-less heartbeat row per completed run, so cron
-- health can be monitored (see /api/cron/health) without inspecting Edge
-- Function logs directly.

CREATE TABLE IF NOT EXISTS public.cron_job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  pool_id UUID REFERENCES public.pools(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'retry', 'warning')),
  error_message TEXT,
  tx_hash TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_job_logs_job_created ON public.cron_job_logs(job_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_job_logs_pool_id ON public.cron_job_logs(pool_id);

ALTER TABLE public.cron_job_logs ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies. This app has no Supabase Auth / admin role
-- (identity is wallet-address based — see 20260624000000_rls_lockdown.sql), so
-- "admin-only read access" is enforced by only ever reading this table through
-- the service-role key (the auto-trigger-payouts Edge Function and the
-- /api/cron/health route). Anon-key callers get nothing back, matching the
-- service-role-only pattern already used for deposit_reminders.
