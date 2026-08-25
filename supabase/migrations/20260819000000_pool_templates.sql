-- Migration: pool_templates
-- Reusable pool configurations (issue #226). Users can save the parameters of
-- a pool creation form as a named template, browse community-shared templates,
-- and create a new pool from a template with one click.

CREATE TABLE IF NOT EXISTS public.pool_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_address text        NOT NULL,
  name            text        NOT NULL,
  description     text,
  pool_type       text        NOT NULL,
  config          jsonb       NOT NULL,
  is_public       boolean     NOT NULL DEFAULT false,
  use_count       integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- Enforce the same limits the UI applies (template name max 50 chars,
  -- description max 200 chars, pool type restricted to the three supported
  -- savings modes).
  CONSTRAINT pool_templates_pool_type CHECK (pool_type IN ('rotational', 'target', 'flexible')),
  CONSTRAINT pool_templates_name_length CHECK (char_length(name) <= 50),
  CONSTRAINT pool_templates_description_length CHECK (description IS NULL OR char_length(description) <= 200),
  -- creator_address is always stored lowercase so a direct Supabase client
  -- write cannot sneak in mixed-case duplicates that bypass ownership checks.
  CONSTRAINT pool_templates_creator_lowercase CHECK (creator_address = lower(creator_address)),
  CONSTRAINT pool_templates_use_count_nonnegative CHECK (use_count >= 0)
);

-- Support "my templates" queries (most recent first per creator)
CREATE INDEX idx_pool_templates_creator
  ON public.pool_templates (creator_address, created_at DESC);

-- Support the community feed (public templates, optionally filtered by pool
-- type and ordered by popularity / recency)
CREATE INDEX idx_pool_templates_public
  ON public.pool_templates (is_public, pool_type, use_count DESC, created_at DESC);

CREATE INDEX idx_pool_templates_updated
  ON public.pool_templates (updated_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Ownership identity: the wallet claim on the Supabase JWT, mirroring the
-- pool_messages RLS policy. Server-side API routes use the service-role key,
-- which bypasses RLS, so ownership is also verified in the route handlers.
ALTER TABLE public.pool_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: creators can read their own; everyone can read public templates.
CREATE POLICY "Pool template owners and public reads"
  ON public.pool_templates
  FOR SELECT
  USING (
    creator_address = lower(auth.jwt() ->> 'wallet_address')
    OR is_public = true
  );

-- INSERT: a user may only create templates in their own name.
CREATE POLICY "Pool template owners insert"
  ON public.pool_templates
  FOR INSERT
  WITH CHECK (
    lower(creator_address) = lower(auth.jwt() ->> 'wallet_address')
  );

-- UPDATE: owners only.
CREATE POLICY "Pool template owners update"
  ON public.pool_templates
  FOR UPDATE
  USING (creator_address = lower(auth.jwt() ->> 'wallet_address'))
  WITH CHECK (creator_address = lower(auth.jwt() ->> 'wallet_address'));

-- DELETE: owners only.
CREATE POLICY "Pool template owners delete"
  ON public.pool_templates
  FOR DELETE
  USING (creator_address = lower(auth.jwt() ->> 'wallet_address'));

-- ── Updated-at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_pool_templates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pool_templates_touch_updated ON public.pool_templates;
CREATE TRIGGER pool_templates_touch_updated
  BEFORE UPDATE ON public.pool_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_pool_templates();