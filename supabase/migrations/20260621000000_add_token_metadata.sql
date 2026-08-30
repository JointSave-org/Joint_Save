-- Multi-token support (issue #67): remember each pool's token symbol and
-- decimals so the UI can display "1,000 USDC" without an RPC round-trip per
-- render. Existing rows default to native XLM (symbol XLM, 7 decimals).

alter table public.pools
  add column if not exists token_symbol text not null default 'XLM',
  add column if not exists token_decimals integer not null default 7;
