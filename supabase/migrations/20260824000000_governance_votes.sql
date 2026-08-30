-- Migration: DAO governance vote mirror (issue #207)
--
-- Governance proposals live fully on-chain (contracts/governance). This table
-- is an off-chain mirror of votes used for realtime UI updates: when a member
-- casts a vote on-chain the client upserts a row here and Supabase Realtime
-- broadcasts it to everyone viewing the pool, so counts update without
-- re-querying Soroban RPC.

ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS governance_contract_id text;

CREATE TABLE IF NOT EXISTS public.governance_votes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id   text        NOT NULL,
  pool_id       uuid        NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  voter_address text        NOT NULL,
  vote          boolean     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- One vote per wallet per proposal (enforced on-chain too).
  CONSTRAINT governance_votes_unique_vote UNIQUE (proposal_id, voter_address),
  -- Addresses are stored lowercase, mirroring every other table.
  CONSTRAINT governance_votes_voter_lowercase CHECK (voter_address = lower(voter_address))
);

CREATE INDEX IF NOT EXISTS idx_governance_votes_pool_id
  ON public.governance_votes (pool_id);

CREATE INDEX IF NOT EXISTS idx_governance_votes_proposal
  ON public.governance_votes (proposal_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.governance_votes ENABLE ROW LEVEL SECURITY;

-- Public read — the mirror only exposes aggregate vote data that is already
-- public on-chain; per-pool visibility is enforced in /api/governance.
CREATE POLICY "governance_votes_select_public"
  ON public.governance_votes
  FOR SELECT
  USING (true);

-- All writes go through /api/governance with the service-role key.
-- No INSERT/UPDATE/DELETE policy = direct anon writes stay denied.

-- ── Realtime publication ──────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.governance_votes;
