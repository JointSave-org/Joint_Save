-- USDC bridge deposits (issue #209): allow pool_activity rows to record the
-- token-denominated amount alongside the existing numeric `amount` column, so
-- deposit/withdraw history can be broken out by currency (XLM vs USDC).
--
-- `pools.token_symbol` already exists (see 20260621000000_add_token_metadata.sql,
-- issue #67) — the `add column if not exists` below is a no-op safeguard in
-- case this migration runs against a database that predates it.

alter table public.pools
  add column if not exists token_symbol text not null default 'XLM';

alter table public.pool_activity
  add column if not exists token_amount numeric;
