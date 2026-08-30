-- Automated incident response for critical security alerts.
--
-- The monitoring system in `lib/security-rules.ts` already detects trouble and
-- writes to `security_alerts`. This adds the record of what was DONE about it:
-- every automatic pause, every decision not to act, and how it was resolved.
--
-- The incident row is written before the pool is paused, so a crash midway
-- leaves an incident with no pause (visible, recoverable) rather than a paused
-- pool nobody can explain.

CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pool_id UUID NOT NULL,

  -- What tripped the breaker.
  trigger_rule_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  severity TEXT NOT NULL DEFAULT 'critical' CHECK (severity IN ('info', 'warning', 'critical')),
  alert_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,

  -- Where the decision came from. `created_by_scan` distinguishes the automated
  -- path from an incident an admin opened by hand.
  created_by_scan BOOLEAN NOT NULL DEFAULT true,
  scan_source TEXT NOT NULL DEFAULT 'cron' CHECK (scan_source IN ('cron', 'admin', 'manual')),

  -- What the breaker decided, and whether it was allowed to act. A dry-run
  -- incident records `action = 'pause'` with `executed = false`, which is what
  -- makes a dry-run period measurable instead of invisible.
  action TEXT NOT NULL DEFAULT 'none' CHECK (action IN ('pause', 'none')),
  executed BOOLEAN NOT NULL DEFAULT false,
  dry_run BOOLEAN NOT NULL DEFAULT true,
  skip_reason TEXT CHECK (
    skip_reason IN ('below_threshold', 'already_paused', 'pool_not_active', 'cooldown', 'unknown_pool')
  ),

  -- The platform-level pause is immediate and reversible. The on-chain pause
  -- needs the pool admin's signature (the contract asserts `admin.require_auth()`),
  -- so it is tracked separately and stays 'pending' until an admin signs it.
  platform_paused BOOLEAN NOT NULL DEFAULT false,
  onchain_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (onchain_status IN ('not_required', 'pending', 'confirmed', 'failed')),
  onchain_tx_hash TEXT,

  -- Review and recovery.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by TEXT,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The cooldown query is "auto-pauses for this pool since T", so it is the one
-- that has to stay fast as the table grows.
CREATE INDEX IF NOT EXISTS idx_incidents_pool_created
  ON public.incidents (pool_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_executed ON public.incidents (executed);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.incidents (created_at DESC);

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

-- Mirrors `security_alerts`: readable, with every write going through the
-- service-role API routes.
CREATE POLICY "incidents_select_public"
  ON public.incidents
  FOR SELECT
  USING (true);

-- ── Pause context on the pool ───────────────────────────────────────────────
-- `pools.status` already carries 'paused'; these say why and since when, so a
-- member looking at a halted pool gets an explanation rather than a dead screen.

ALTER TABLE public.pools ADD COLUMN IF NOT EXISTS pause_reason TEXT;
ALTER TABLE public.pools ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
