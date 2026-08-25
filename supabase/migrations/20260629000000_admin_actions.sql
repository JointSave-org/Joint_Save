-- Migration: Create admin_actions table for tracking administrative activities
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  admin_address TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  tx_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying actions by pool
CREATE INDEX IF NOT EXISTS idx_admin_actions_pool_id ON public.admin_actions(pool_id);

-- Enable RLS
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

-- Select policy: readable by anyone (anon key allowed)
CREATE POLICY "admin_actions_select_public"
  ON public.admin_actions FOR SELECT
  USING (true);
