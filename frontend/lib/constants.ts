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

// ── Transaction Retry & Pending Tracking ────────────────────────────────────

/**
 * Maximum number of submission attempts before `submitWithRetry` gives up on
 * retriable failures (network congestion, timeouts, stale sequence numbers).
 */
export const TX_RETRY_MAX_ATTEMPTS = 3 as const

/**
 * Exponential backoff delays between retry attempts, in milliseconds.
 * 2s → 4s → 8s. The delay for attempt `i` is `TX_RETRY_BACKOFF_MS[i]`.
 */
export const TX_RETRY_BACKOFF_MS = [2000, 4000, 8000] as const

/**
 * Number of times `submitWithRetry` polls the RPC for a broadcast
 * transaction's inclusion in a ledger before returning it as still-pending
 * (the tracker keeps polling Horizon afterwards).
 */
export const TX_CONFIRM_POLL_ATTEMPTS = 30 as const

/**
 * Delay between confirmation polls inside `submitWithRetry`.
 * Unit: **milliseconds**.
 */
export const TX_CONFIRM_POLL_INTERVAL_MS = 1500 as const

/**
 * Maximum number of pending transactions kept in the tracker (localStorage
 * key `jointsave_pending_txs`). Oldest entries are evicted first.
 */
export const PENDING_TX_MAX = 10 as const

/**
 * Pending transaction entries older than this are removed from the tracker.
 * Unit: **milliseconds** (1 hour).
 */
export const PENDING_TX_MAX_AGE_MS = 3_600_000 as const

/**
 * Interval at which the pending transaction tracker polls Horizon for
 * confirmation of each tracked transaction.
 * Unit: **milliseconds** (10 seconds).
 */
export const PENDING_TX_POLL_INTERVAL_MS = 10_000 as const

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
