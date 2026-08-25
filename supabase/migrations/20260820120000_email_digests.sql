-- Migration: Email digest preferences (Issue #221)
-- Adds per-wallet digest subscription settings for daily/weekly email summaries.

CREATE TABLE IF NOT EXISTS email_digests (
  wallet_address     TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  frequency          TEXT NOT NULL DEFAULT 'off' CHECK (frequency IN ('daily', 'weekly', 'off')),
  last_sent_at       TIMESTAMP WITH TIME ZONE,
  unsubscribe_token  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_digests_unsubscribe_token
  ON email_digests(unsubscribe_token);

-- Speeds up the cron job's "who's due" query
CREATE INDEX IF NOT EXISTS idx_email_digests_frequency
  ON email_digests(frequency) WHERE frequency != 'off';

-- RLS: matches the user_profiles/notifications convention already in this repo
-- (see 20260624000000_rls_lockdown.sql) -- no anon policies at all. Reads/writes
-- go through service-role Next.js API routes, never direct client access.
ALTER TABLE email_digests ENABLE ROW LEVEL SECURITY;
