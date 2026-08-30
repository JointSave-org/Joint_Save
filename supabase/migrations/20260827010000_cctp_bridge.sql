-- CCTP cross-chain USDC deposit bridge (issue #253): persist bridge
-- transaction state so progress (pending → attested → received → deposited)
-- survives page refreshes and can be resumed.
--
-- `id` is a stable client-generated id (the CCTP message hash) so re-polls
-- update the same row idempotently. RLS: public SELECT, no anonymous writes
-- (writes go through the API route / service role).

create table if not exists public.bridge_transactions (
  id text primary key,
  user_address text not null,
  source_chain text not null,
  destination text not null default 'stellar',
  amount_base_units bigint,
  status text not null default 'pending',
  source_tx_hash text,
  message_hash text,
  redemption_tx_hash text,
  pool_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bridge_transactions enable row level security;

drop policy if exists "bridge_transactions_public_select" on public.bridge_transactions;
create policy "bridge_transactions_public_select"
  on public.bridge_transactions
  for select
  using (true);
