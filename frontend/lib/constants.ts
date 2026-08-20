/**
 * Centralized platform-wide configuration constants.
 *
 * All magic numbers and tunable settings live here so they can be found,
 * documented, and changed in one place. Import with named imports:
 *
 *   import { TX_TIMEOUT, STALE_TIME_MS } from "@/lib/constants"
 *
 * Constant names follow UPPER_SNAKE_CASE. Values are declared `as const` so
 * TypeScript narrows their type to the literal rather than the primitive.
 */

// ── Pool Configuration ────────────────────────────────────────────────────────

/**
 * Maximum number of members allowed in any pool type.
 * Enforced in the create-group forms and BulkImport CSV parser.
 */
export const MAX_POOL_MEMBERS = 50 as const

/**
 * Minimum number of members required to create a pool (admin + at least one
 * other participant).
 */
export const MIN_POOL_MEMBERS = 2 as const

/**
 * Default treasury fee charged on each rotational payout, in basis points.
 * 100 bps = 1 %.
 */
export const DEFAULT_TREASURY_FEE_BPS = 100 as const

/**
 * Default relayer fee paid to whoever calls `trigger_payout`, in basis points.
 * 50 bps = 0.5 %.
 */
export const DEFAULT_RELAYER_FEE_BPS = 50 as const

// ── Timing ────────────────────────────────────────────────────────────────────

/**
 * Soroban transaction timeout passed to `TransactionBuilder.setTimeout()`.
 * Unit: **seconds** (the Stellar SDK expects seconds, not milliseconds).
 *
 * 300 s = 5 minutes — gives users comfortable time to review and approve the
 * wallet popup without the transaction expiring (`txTooLate`).
 */
export const TX_TIMEOUT = 300 as const

/**
 * How long cached on-chain pool state is considered fresh before the
 * PoolDataProvider triggers a background re-fetch.
 * Unit: **milliseconds**.
 */
export const STALE_TIME_MS = 15_000 as const

/**
 * Maximum time a signing request may wait in the tx-queue before it is
 * automatically rejected and the queue moves on.
 * Unit: **milliseconds** (2 minutes).
 */
export const SIGN_TIMEOUT_MS = (2 * 60 * 1000) as const

/**
 * Window within which a pending transaction with the same pool + type is
 * considered a duplicate and will not be re-submitted.
 * Unit: **milliseconds** (2 minutes).
 */
export const RECENT_DUPLICATE_WINDOW_MS = (2 * 60 * 1000) as const

/**
 * How old a `NOT_FOUND` pending transaction must be before it is considered
 * dropped by the network and removed from local storage.
 * Unit: **milliseconds** (5 minutes).
 */
export const DROPPED_TX_WINDOW_MS = (5 * 60 * 1000) as const

// ── Rate Limiting ─────────────────────────────────────────────────────────────

/**
 * Sliding-window size for the in-memory API rate limiter.
 * Unit: **milliseconds** (1 minute).
 */
export const RATE_LIMIT_WINDOW_MS = 60_000 as const

/**
 * Maximum number of read requests (GET endpoints) allowed per key per window.
 */
export const READ_RATE_LIMIT = 30 as const

/**
 * Maximum number of write requests (POST/PATCH endpoints) allowed per key per
 * window.
 */
export const WRITE_RATE_LIMIT = 10 as const

/**
 * Maximum number of activity exports allowed per key per export window.
 */
export const EXPORT_RATE_LIMIT = 5 as const

/**
 * Sliding-window size for the export rate limiter.
 * Unit: **milliseconds** (1 hour).
 */
export const EXPORT_RATE_LIMIT_WINDOW_MS = 3_600_000 as const

// ── Activity feed ─────────────────────────────────────────────────────────────

/**
 * Number of pool activity rows returned per page by
 * GET /api/pools/[id]/activity.
 */
export const ACTIVITY_PAGE_SIZE = 50 as const

/**
 * Hard cap on rows returned by GET /api/pools/[id]/activity/export so a single
 * export can never buffer an unbounded result set.
 */
export const ACTIVITY_EXPORT_MAX_ROWS = 5_000 as const

// ── UI ────────────────────────────────────────────────────────────────────────

/**
 * Maximum number of notifications kept in the local state list.
 * Older entries are dropped to keep the list manageable.
 */
export const NOTIFICATION_BADGE_MAX = 10 as const

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Maximum number of rows accepted from a bulk-import CSV file.
 * Matches MAX_POOL_MEMBERS so that a CSV import can never exceed the pool cap.
 */
export const MAX_CSV_ROWS = MAX_POOL_MEMBERS

/**
 * Maximum character length for a pool name field.
 */
export const MAX_NAME_LENGTH = 50 as const

/**
 * Maximum character length for a pool description field.
 */
export const MAX_DESCRIPTION_LENGTH = 300 as const

/**
 * Maximum deadline, in days, that can be set for a Target Pool.
 * 3650 days ≈ 10 years.
 */
export const MAX_DEADLINE_DAYS = 3650 as const

// ── Contract Versioning ─────────────────────────────────────────────────────

/**
 * Latest known contract versions. The frontend uses these to detect
 * when a pool contract is running a newer version than expected.
 * If `contract_version > known_version`, a warning banner is displayed.
 */
export const KNOWN_CONTRACT_VERSIONS = {
  rotational: 1,
  target: 1,
  flexible: 1,
  factory: 1,
} as const

// ── Chat ──────────────────────────────────────────────────────────────────────

/**
 * Maximum character length for a single pool chat message.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 500 as const

/**
 * Minimum time (ms) a sender must wait between consecutive messages.
 * Enforced both client-side (UX) and server-side (API rate limiter).
 * 3 seconds matches the requirement in issue #90.
 */
export const CHAT_RATE_LIMIT_MS = 3_000 as const

// ── Sponsorship ───────────────────────────────────────────────────────────────

/**
 * Maximum number of gasless transactions sponsored per day (global platform limit).
 */
export const MAX_DAILY_SPONSORSHIPS = 100 as const

/**
 * Maximum number of sponsored transactions per wallet (ever — one-time perk).
 */
export const MAX_PER_WALLET_SPONSORSHIPS = 1 as const

/**
 * Minimum XLM balance the sponsor account must maintain. Below this threshold
 * sponsorship is disabled and a warning is shown (circuit breaker).
 */
export const MIN_SPONSOR_BALANCE_XLM = 10 as const
