-- Security alerts table for the monitoring system.
-- Stores triggered alerts from security rule scans.

CREATE TABLE IF NOT EXISTS public.security_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  description TEXT NOT NULL,
  affected_pools JSONB DEFAULT '[]'::jsonb,
  affected_wallets JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'investigating', 'resolved', 'false_positive')),
  resolved_by TEXT,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON public.security_alerts (severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_status ON public.security_alerts (status);
CREATE INDEX IF NOT EXISTS idx_security_alerts_rule_id ON public.security_alerts (rule_id);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created_at ON public.security_alerts (created_at DESC);

-- Enable RLS
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

-- Public read for authenticated users (admin dashboard will filter client-side)
CREATE POLICY "security_alerts_select_public"
  ON public.security_alerts
  FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies for anon — all writes go through service-role API routes
