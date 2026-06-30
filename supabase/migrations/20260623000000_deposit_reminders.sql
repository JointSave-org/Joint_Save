-- Migration: Deposit reminder notification support
-- Adds a preference flag and per-round dedupe table for scheduled reminders.

ALTER TABLE user_profiles
  ALTER COLUMN notification_preferences SET DEFAULT
    '{"email_on_payout":true,"email_on_deposit":true,"email_on_round":true,"email_on_target":true,"email_on_deposit_reminder":true}'::jsonb;

UPDATE user_profiles
SET notification_preferences =
  notification_preferences || '{"email_on_deposit_reminder":true}'::jsonb
WHERE NOT (notification_preferences ? 'email_on_deposit_reminder');

CREATE TABLE IF NOT EXISTS deposit_reminders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id        UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  round_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(pool_id, wallet_address, round_deadline)
);

CREATE INDEX IF NOT EXISTS idx_deposit_reminders_pool_deadline
  ON deposit_reminders(pool_id, round_deadline);

CREATE INDEX IF NOT EXISTS idx_deposit_reminders_wallet
  ON deposit_reminders(wallet_address, created_at DESC);
