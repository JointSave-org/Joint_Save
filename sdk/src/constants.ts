/**
 * Protocol-wide constants.
 *
 * Kept in sync with `frontend/lib/constants.ts` and the on-chain contracts so
 * SDK callers and the app agree on units and limits.
 */

// ── Units ────────────────────────────────────────────────────────────────────

/** Decimal places for USDC on Stellar. */
export const USDC_DECIMALS = 7 as const;

/** Base units per USDC (`10^7`). */
export const STROOPS_PER_USDC = 10_000_000 as const;

/** Decimal places used by the yield vault's share accounting. */
export const YIELD_DECIMALS = 7 as const;

/** Basis-point denominator: `10_000` bps = 100%. */
export const BPS_DENOMINATOR = 10_000 as const;

/** Scale applied to vault share prices. */
export const SHARE_SCALE = 1_000_000_000 as const;

// ── Yield allocation ─────────────────────────────────────────────────────────

/** Default liquidity buffer held back from yield, in basis points (20%). */
export const DEFAULT_BUFFER_BPS = 2_000 as const;

/** Maximum accepted liquidity buffer, in basis points (100%). */
export const MAX_BUFFER_BPS = BPS_DENOMINATOR;

// ── Pool limits ──────────────────────────────────────────────────────────────

/** Maximum number of members in any pool. */
export const MAX_POOL_MEMBERS = 50 as const;

/** Minimum number of members required to create a pool. */
export const MIN_POOL_MEMBERS = 2 as const;

/** Default treasury fee on rotational payouts, in basis points (1%). */
export const DEFAULT_TREASURY_FEE_BPS = 100 as const;

/** Default relayer fee for triggering payouts, in basis points (0.5%). */
export const DEFAULT_RELAYER_FEE_BPS = 50 as const;

// ── Time ─────────────────────────────────────────────────────────────────────

/** Approximate seconds per Stellar ledger. */
export const SECONDS_PER_LEDGER = 5 as const;

/** Approximate ledgers per day (`86_400 / 5`). */
export const LEDGERS_PER_DAY = 17_280 as const;

/** Default Soroban transaction timeout, in seconds. */
export const TX_TIMEOUT_SECONDS = 300 as const;

/** Alias kept for parity with the frontend (`TX_TIMEOUT`). */
export const TX_TIMEOUT = TX_TIMEOUT_SECONDS;

/** How long cached pool state is fresh, in milliseconds. */
export const STALE_TIME_MS = 15_000 as const;

/** Simulation cache TTL, in milliseconds. */
export const SIMULATION_CACHE_TTL_MS = 30_000 as const;

/** Maximum wait for a simulation response, in milliseconds. */
export const SIMULATION_TIMEOUT_MS = 10_000 as const;

// ── Tokens ───────────────────────────────────────────────────────────────────

/** Testnet native XLM Stellar Asset Contract id. */
export const TESTNET_NATIVE_SAC_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" as const;

/** Mainnet native XLM Stellar Asset Contract id. */
export const MAINNET_NATIVE_SAC_ID =
  "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA" as const;

// ── Governance ───────────────────────────────────────────────────────────────

/** Maximum governance proposal description length. */
export const GOVERNANCE_DESCRIPTION_MAX = 500 as const;

// ── Contract versioning ──────────────────────────────────────────────────────

/** Contract versions the SDK knows how to interpret. */
export const KNOWN_CONTRACT_VERSIONS = {
  rotational: 1,
  target: 1,
  flexible: 1,
  factory: 1,
} as const;

/** Version assumed when a contract does not report one. */
export const DEFAULT_CONTRACT_VERSION = 1 as const;
