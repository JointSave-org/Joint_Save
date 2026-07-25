-- Migration: pool_messages
-- Real-time per-pool chat for JointSave group members.

CREATE TABLE IF NOT EXISTS public.pool_messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id       uuid        NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  sender_address text       NOT NULL,
  message       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Enforce message length at the DB level (mirrors CHAT_MESSAGE_MAX_LENGTH = 500)
  CONSTRAINT pool_messages_message_length CHECK (char_length(message) <= 500),
  -- Ensure sender_address is always stored lowercase so direct Supabase client
  -- writes cannot sneak in mixed-case duplicates that bypass membership checks.
  CONSTRAINT pool_messages_sender_lowercase CHECK (sender_address = lower(sender_address))
);

-- Index to support efficient pagination queries (most recent first per pool)
CREATE INDEX idx_pool_messages_pool_created
  ON public.pool_messages (pool_id, created_at DESC);

-- Index to support the DB-level rate-limit check in the API
-- (MAX(created_at) WHERE pool_id = ? AND sender_address = ?)
CREATE INDEX idx_pool_messages_sender_recent
  ON public.pool_messages (pool_id, sender_address, created_at DESC);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.pool_messages ENABLE ROW LEVEL SECURITY;

-- Helper: confirm the requesting wallet is actually a member of the pool.
-- pool_members.member_address is stored lowercase, so we normalise the claim.
CREATE OR REPLACE FUNCTION public.is_pool_member(p_pool_id uuid, p_wallet text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pool_members
    WHERE pool_id = p_pool_id
      AND member_address = lower(p_wallet)
  );
$$;

-- SELECT: only members of the pool may read its messages.
-- We rely on the anon key + JWT claim `wallet_address` set by the client.
-- Because the frontend uses the service-role key for server-side API calls,
-- that path bypasses RLS (service-role ignores policies) which is the
-- intended behaviour for the /api/chat server routes.
CREATE POLICY "Members can read pool messages"
  ON public.pool_messages
  FOR SELECT
  USING (
    public.is_pool_member(pool_id, auth.jwt() ->> 'wallet_address')
  );

-- INSERT: only members may post; the sender must be themselves.
CREATE POLICY "Members can insert own messages"
  ON public.pool_messages
  FOR INSERT
  WITH CHECK (
    lower(sender_address) = lower(auth.jwt() ->> 'wallet_address')
    AND public.is_pool_member(pool_id, auth.jwt() ->> 'wallet_address')
  );

-- No UPDATE or DELETE policies — messages are immutable once sent.

-- ── Realtime publication ──────────────────────────────────────────────────────
-- Add pool_messages to the realtime publication so Supabase Realtime
-- broadcasts INSERT events to subscribed clients.
ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_messages;
