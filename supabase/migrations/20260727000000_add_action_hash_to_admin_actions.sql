-- Migration: Add action_hash to admin_actions table
ALTER TABLE public.admin_actions
ADD COLUMN action_hash TEXT;
