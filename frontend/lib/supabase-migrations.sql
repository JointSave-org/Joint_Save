-- Migration: Add pause tracking columns to pools table
-- This migration adds columns to support the admin emergency controls feature

-- Add pause_reason column
ALTER TABLE pools 
ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- Add paused_at column
ALTER TABLE pools 
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP;

-- Add comment to explain the columns
COMMENT ON COLUMN pools.pause_reason IS 'Reason provided by admin when manually pausing the pool';
COMMENT ON COLUMN pools.paused_at IS 'Timestamp when the pool was paused by admin';

-- Update the status column to ensure it includes 'paused' as a valid value
-- (assuming the existing constraint allows 'active', 'completed', 'cancelled')
-- This is a documentation comment - adjust constraint if needed based on your schema

-- Example query to verify the changes:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'pools' AND column_name IN ('pause_reason', 'paused_at');
