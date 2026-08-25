-- Migration: Add notification_preferences and push_subscriptions tables
-- Issue #203: Real-time push notification system

-- ─── notification_preferences ────────────────────────────────────────────────
-- Stores per-user, optionally per-pool push notification preferences.
-- A row with pool_id IS NULL represents the user's global default preferences.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  wallet_address    text        NOT NULL,
  pool_id           text,                           -- NULL = global default
  event_deposit     boolean     NOT NULL DEFAULT true,
  event_payout      boolean     NOT NULL DEFAULT true,
  event_member_joined boolean   NOT NULL DEFAULT true,
  event_member_left boolean     NOT NULL DEFAULT false,
  event_deadline_warning boolean NOT NULL DEFAULT true,
  event_paused      boolean     NOT NULL DEFAULT true,
  push_enabled      boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, pool_id)
);

-- Allow NULL pool_id in the composite PK by using a unique index instead.
-- Postgres primary keys cannot contain NULLs, so we add a separate unique
-- index to enforce the global-default uniqueness constraint.
ALTER TABLE public.notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_pkey
  ON public.notification_preferences (wallet_address, COALESCE(pool_id, ''));

-- Keep updated_at current on every write.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER set_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── push_subscriptions ───────────────────────────────────────────────────────
-- Stores Web Push API subscription objects so the server can send pushes.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address    text        NOT NULL,
  endpoint          text        NOT NULL UNIQUE,  -- prevents duplicate registrations
  p256dh            text        NOT NULL,
  auth              text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_wallet_idx
  ON public.push_subscriptions (wallet_address);

-- ─── RLS policies ─────────────────────────────────────────────────────────────
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions       ENABLE ROW LEVEL SECURITY;

-- notification_preferences: users can only see/modify their own rows.
DROP POLICY IF EXISTS "Users read own preferences"   ON public.notification_preferences;
DROP POLICY IF EXISTS "Users write own preferences"  ON public.notification_preferences;

CREATE POLICY "Users read own preferences"
  ON public.notification_preferences FOR SELECT
  USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users write own preferences"
  ON public.notification_preferences FOR ALL
  USING      (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');

-- push_subscriptions: users can only see/modify their own rows.
DROP POLICY IF EXISTS "Users read own subscriptions"   ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users write own subscriptions"  ON public.push_subscriptions;

CREATE POLICY "Users read own subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users write own subscriptions"
  ON public.push_subscriptions FOR ALL
  USING      (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub')
  WITH CHECK (wallet_address = current_setting('request.jwt.claims', true)::json->>'sub');

-- ─── Supabase Realtime publication (optional, future use) ────────────────────
-- Uncomment once the Supabase project has realtime enabled for this table.
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_preferences;
