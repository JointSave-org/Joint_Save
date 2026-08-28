-- Pre-signed authorizations that let the circuit breaker pause a pool on-chain.
--
-- `rotational::pause` asserts `admin.require_auth()` and that the caller is the
-- pool's stored admin, which is the creator's own wallet. The platform holds no
-- key that satisfies that, and a fee bump authorises nothing.
--
-- A SorobanAuthorizationEntry, though, is signed independently of the
-- transaction envelope. So the admin signs one entry covering exactly
-- `pause(admin)` on exactly their pool's contract, and the backend keeps it
-- until the breaker trips, then wraps it in a transaction it pays for itself.
-- The platform never holds the admin's key and can never authorise anything
-- other than the call the admin already signed.
--
-- Entries carry a nonce and an expiration ledger, so each one is single-use and
-- goes stale. That is why this is a table of them rather than a single column.

CREATE TABLE IF NOT EXISTS public.pause_authorizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pool_id UUID NOT NULL,

  -- Recorded so a stored entry can never be replayed against a different pool
  -- or a rotated admin: both are checked before it is used.
  contract_address TEXT NOT NULL,
  admin_address TEXT NOT NULL,

  -- Base64 XDR of the signed SorobanAuthorizationEntry.
  entry_xdr TEXT NOT NULL,
  -- The ledger the signature stops being valid at, from the entry itself.
  expiration_ledger INTEGER NOT NULL,

  -- Single use. Set when the entry is submitted, whatever the outcome, so a
  -- failed submission never silently re-spends a consumed nonce.
  used_at TIMESTAMPTZ,
  used_by_incident UUID,

  -- An admin withdrawing consent without waiting for expiry.
  revoked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The hot query is "an unused, unrevoked entry for this pool".
CREATE INDEX IF NOT EXISTS idx_pause_auth_pool
  ON public.pause_authorizations (pool_id, expiration_ledger DESC);
CREATE INDEX IF NOT EXISTS idx_pause_auth_unused
  ON public.pause_authorizations (pool_id) WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.pause_authorizations ENABLE ROW LEVEL SECURITY;

-- Deliberately NO select policy, unlike `incidents` and `security_alerts`.
-- A signed entry is a bearer credential: anyone holding it could submit the
-- pause themselves, which would be a griefing vector against the pool's own
-- members. Only the service-role API routes, which bypass RLS, may read it.
