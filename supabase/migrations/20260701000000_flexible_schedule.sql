-- Migration: Flexible Contribution Scheduling
-- Adds priority column to notifications table and schedule_config column to pools table

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE pools ADD COLUMN IF NOT EXISTS schedule_config JSONB DEFAULT '{}'::jsonb;
