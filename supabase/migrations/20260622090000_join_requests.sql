-- Create join_requests table for pool membership requests
create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools(id) on delete cascade,
  requester_address text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responder_id text,
  unique(pool_id, requester_address)
);

-- Index for looking up requests by pool
create index if not exists idx_join_requests_pool_id on public.join_requests(pool_id);

-- Index for looking up a user's requests
create index if not exists idx_join_requests_requester on public.join_requests(requester_address);

-- Enable RLS
alter table public.join_requests enable row level security;

-- Policies: anyone can create a request, pool creator can view/respond
create policy "Anyone can create join requests"
  on public.join_requests for insert
  with check (true);

create policy "Pool creator can view join requests"
  on public.join_requests for select
  using (
    exists (
      select 1 from public.pools
      where pools.id = join_requests.pool_id
      and pools.creator_address = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );
