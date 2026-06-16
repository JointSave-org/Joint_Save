-- Migration: Create Advanced Pool Analytics Tables
-- Description: Sets up tables for tracking daily metrics, health scores, and user behavior analytics.

-- 1. Create pool_daily_metrics table for historical performance charts
CREATE TABLE IF NOT EXISTS pool_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_balance NUMERIC NOT NULL DEFAULT 0,
  total_deposits NUMERIC NOT NULL DEFAULT 0,
  total_withdrawals NUMERIC NOT NULL DEFAULT 0,
  active_members_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (pool_id, date)
);

-- 2. Create pool_health_scores table for risk indicators and health metrics
CREATE TABLE IF NOT EXISTS pool_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
  health_score NUMERIC NOT NULL DEFAULT 100,
  participation_rate NUMERIC NOT NULL DEFAULT 100,
  risk_indicator TEXT NOT NULL DEFAULT 'Low', -- 'Low', 'Medium', 'High'
  last_calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (pool_id)
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_pool_daily_metrics_pool_id ON pool_daily_metrics(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_daily_metrics_date ON pool_daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_pool_health_scores_pool_id ON pool_health_scores(pool_id);
