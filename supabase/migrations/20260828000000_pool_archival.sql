-- Migration: Automated pool archival and cleanup (issue #212)
--
-- Adds the archival state to `pools` and an `archive_log` audit table. Archival
-- is purely an off-chain visibility layer: nothing here deletes pool metadata,
-- members, or activity, and the on-chain contract is untouched. An archived
-- pool is hidden from Explore / My Groups by default and rendered read-only,
-- but every historical row it owns stays queryable and exportable.

-- ── pools: archival state ────────────────────────────────────────────────────
-- `completed_at` / `emergency_withdrawn_at` did not exist yet; the cron needs
-- them to apply the grace periods (7 days after completion, 30 after an
-- emergency withdrawal) rather than archiving the moment a status flips.
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS archived_at             timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason          text,
  ADD COLUMN IF NOT EXISTS completed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_withdrawn_at  timestamptz;

DO $$
BEGIN
  -- Mirrors ARCHIVE_REASONS in frontend/lib/archival.ts.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pools_archive_reason_valid'
  ) THEN
    ALTER TABLE public.pools
      ADD CONSTRAINT pools_archive_reason_valid CHECK (
        archive_reason IS NULL OR archive_reason IN
          ('completed', 'inactive_90d', 'admin_archived', 'emergency_withdrawn')
      );
  END IF;

  -- Both archival fields move together, so a row can never claim to be
  -- archived without saying why (or carry a reason while still active).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pools_archive_fields_pair'
  ) THEN
    ALTER TABLE public.pools
      ADD CONSTRAINT pools_archive_fields_pair CHECK (
        (archived_at IS NULL) = (archive_reason IS NULL)
      );
  END IF;
END $$;

-- The base `pools` table predates this repo's migrations, so its status CHECK
-- (if any) is dropped and rebuilt to admit the emergency-withdrawn state the
-- archival criteria key off.
DO $$
DECLARE
  status_constraint text;
BEGIN
  SELECT conname INTO status_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.pools'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF status_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.pools DROP CONSTRAINT %I', status_constraint);
  END IF;

  ALTER TABLE public.pools
    ADD CONSTRAINT pools_status_valid CHECK (
      status IN ('active', 'completed', 'paused', 'emergency_withdrawn')
    );
END $$;

-- Backfill so pools already sitting in a terminal state get a grace period
-- anchored to their last update instead of being archived on the first run.
UPDATE public.pools
SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;

-- Explore and My Groups both filter on `archived_at IS NULL`. A partial index
-- over the active set keeps that the cheap path as archived rows accumulate —
-- the index only ever holds the pools the default queries actually return.
CREATE INDEX IF NOT EXISTS idx_pools_active_created
  ON public.pools (created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pools_active_creator
  ON public.pools (creator_address, created_at DESC)
  WHERE archived_at IS NULL;

-- The cron's own sweep: find archivable pools without scanning archived ones.
CREATE INDEX IF NOT EXISTS idx_pools_archival_sweep
  ON public.pools (status, completed_at, emergency_withdrawn_at)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pools_archived_at
  ON public.pools (archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- ── archive_log: audit trail ─────────────────────────────────────────────────
-- Every archive and unarchive is recorded, automated or manual, so a pool that
-- vanished from discovery can always be traced back to the run that hid it.
CREATE TABLE IF NOT EXISTS public.archive_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id        uuid        NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  action         text        NOT NULL CHECK (action IN ('archived', 'unarchived')),
  reason         text        NOT NULL CHECK (reason IN
                   ('completed', 'inactive_90d', 'admin_archived', 'emergency_withdrawn')),
  -- 'cron' for the daily sweep, otherwise the wallet that triggered it.
  triggered_by   text        NOT NULL,
  automated      boolean     NOT NULL DEFAULT false,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT archive_log_triggered_by_lowercase
    CHECK (triggered_by = lower(triggered_by))
);

CREATE INDEX IF NOT EXISTS idx_archive_log_pool_created
  ON public.archive_log (pool_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_archive_log_created
  ON public.archive_log (created_at DESC);

-- ── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.archive_log ENABLE ROW LEVEL SECURITY;

-- Public read, matching pool_activity / disputes: why a pool was archived is
-- part of its visible history. Writes go through the service-role key only.
CREATE POLICY "archive_log_select_public"
  ON public.archive_log
  FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies = direct anon writes stay denied.
