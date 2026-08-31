-- Multi-token (SEP-41) deposit support (issue #255): persist the pool's
-- supported-token allowlist in Supabase so the frontend knows which assets
-- the deposit UI should offer and the deposit route can validate against.
--
-- Mirrors `set_supported_tokens` / `get_supported_tokens` on the rotational,
-- target and flexible contracts. `supported_tokens` is a JSONB array of
-- token identifiers — each is either "native" (XLM) or a C… SEP-41 SAC
-- contract id. Empty array (the default) means unrestricted, matching the
-- contract's default semantics.

alter table public.pools
  add column if not exists supported_tokens jsonb not null default '[]';
