-- Migration: User Profiles and In-App Notifications
-- Adds user_profiles (email + notification prefs) and notifications (bell feed).

-- 1. user_profiles — keyed by wallet address, holds email and opt-in preferences
CREATE TABLE IF NOT EXISTS user_profiles (
  wallet_address           TEXT PRIMARY KEY,
  email                    TEXT,
  notification_preferences JSONB NOT NULL DEFAULT
    '{"email_on_payout":true,"email_on_deposit":true,"email_on_round":true,"email_on_target":true}'::jsonb,
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email
  ON user_profiles(email) WHERE email IS NOT NULL;

-- 2. notifications — persisted in-app notification feed (bell dropdown)
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT    NOT NULL,
  pool_id        UUID    REFERENCES pools(id) ON DELETE CASCADE,
  activity_type  TEXT    NOT NULL,
  message        TEXT    NOT NULL,
  read           BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_wallet
  ON notifications(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(wallet_address) WHERE read = false;
