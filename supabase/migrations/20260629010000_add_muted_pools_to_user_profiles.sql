-- Add per-pool mute preferences to user_profiles

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS muted_pools JSONB NOT NULL DEFAULT '[]'::jsonb;

