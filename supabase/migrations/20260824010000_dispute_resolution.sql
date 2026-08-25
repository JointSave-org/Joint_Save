-- Migration: Dispute resolution system (issue #208)
--
-- Lets pool members file disputes against admin actions or other members,
-- vote to uphold/dismiss them, and records resolutions. Resolutions are also
-- mirrored into the pool_activity feed by the API routes.

CREATE TABLE IF NOT EXISTS public.disputes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id        uuid        NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  filer_address  text        NOT NULL,
  target_address text,
  dispute_type   text        NOT NULL CHECK (dispute_type IN
                   ('missed_deposit', 'unfair_penalty', 'admin_abuse', 'member_misconduct', 'other')),
  description    text        NOT NULL,
  evidence_urls  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status         text        NOT NULL DEFAULT 'open' CHECK (status IN
                   ('open', 'voting', 'resolved_upheld', 'resolved_dismissed', 'expired')),
  resolution     text,
  votes_for      integer     NOT NULL DEFAULT 0,
  votes_against  integer     NOT NULL DEFAULT 0,
  resolved_by    text,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,

  -- Mirrors DISPUTE_DESCRIPTION_MAX_LENGTH in frontend/lib/disputes.ts
  CONSTRAINT disputes_description_length CHECK (char_length(description) <= 2000),
  -- At least one side must be identified; target is null for admin-action disputes.
  CONSTRAINT disputes_addresses_lowercase
    CHECK ((filer_address = lower(filer_address))
      AND (target_address IS NULL OR target_address = lower(target_address))),
  CONSTRAINT disputes_resolved_fields_pair
    CHECK (
      (status IN ('resolved_upheld', 'resolved_dismissed'))
      = (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    )
);

-- Indexes for the common queries: per-pool feed and pending-dispute lookups.
CREATE INDEX IF NOT EXISTS idx_disputes_pool_created
  ON public.disputes (pool_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disputes_status_expires
  ON public.disputes (status, expires_at)
  WHERE status IN ('open', 'voting');

CREATE TABLE IF NOT EXISTS public.dispute_votes (
  dispute_id    uuid        NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
  voter_address text        NOT NULL,
  vote          boolean     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (dispute_id, voter_address),
  CONSTRAINT dispute_votes_voter_lowercase CHECK (voter_address = lower(voter_address))
);

CREATE INDEX IF NOT EXISTS idx_dispute_votes_voter
  ON public.dispute_votes (dispute_id, voter_address);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_votes ENABLE ROW LEVEL SECURITY;

-- Public read — dispute outcomes are visible to anyone viewing a pool, same
-- visibility model as pool_activity / join_requests. Writes go through
-- /api/disputes* with the service-role key which performs membership checks.
CREATE POLICY "disputes_select_public"
  ON public.disputes
  FOR SELECT
  USING (true);

CREATE POLICY "dispute_votes_select_public"
  ON public.dispute_votes
  FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies = direct anon writes stay denied.

-- ── Realtime publication ──────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.disputes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dispute_votes;
