// Pure pool-archival domain helpers (issue #212). Framework-free so it runs
// under the node test runner and can be shared by the cron job, the admin
// endpoints, and the UI.
//
// Archival is an off-chain visibility layer only. Nothing here deletes data:
// an archived pool keeps every member, activity, and metric row it owned, and
// its on-chain contract is untouched and immutable. Archival decides what the
// discovery surfaces show by default, and nothing more.

/** Grace period after completion before a finished pool leaves discovery. */
export const COMPLETED_GRACE_DAYS = 7
/** How long a pool must be both silent and empty before it counts as dead. */
export const INACTIVE_THRESHOLD_DAYS = 90
/** Emergency-withdrawn pools stay visible a full month for member follow-up. */
export const EMERGENCY_WITHDRAWN_GRACE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export const ARCHIVE_REASONS = [
  "completed",
  "inactive_90d",
  "admin_archived",
  "emergency_withdrawn",
] as const

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number]

export type ArchiveAction = "archived" | "unarchived"

export function isArchiveReason(value: unknown): value is ArchiveReason {
  return typeof value === "string" && (ARCHIVE_REASONS as readonly string[]).includes(value)
}

/** Row shape of `archive_log` as returned by the archival endpoints. */
export interface ArchiveLogRecord {
  id: string
  pool_id: string
  action: ArchiveAction
  reason: ArchiveReason
  triggered_by: string
  automated: boolean
  note: string | null
  created_at: string
}

/**
 * Everything the archival rules need about one pool. Deliberately narrower
 * than the `pools` row so the cron can select only these columns, and so the
 * rules stay testable without a database.
 */
export interface ArchivalCandidate {
  id: string
  status: string
  archived_at: string | null
  completed_at: string | null
  emergency_withdrawn_at: string | null
  /** Newest `pool_activity.created_at`, or null when the pool never had any. */
  last_activity_at: string | null
  /** Fallback anchor for silence when there is no activity at all. */
  created_at: string
  /**
   * Deposits minus withdrawals/payouts, in token units. A pool still holding
   * funds is never treated as inactive no matter how quiet it has been.
   */
  net_balance: number
}

export interface ArchivalDecision {
  archive: boolean
  reason?: ArchiveReason
  /** Human-readable justification, stored as the archive_log note. */
  note?: string
}

function daysBetween(fromIso: string, nowMs: number): number {
  const from = new Date(fromIso).getTime()
  if (!Number.isFinite(from)) return Number.NaN
  return (nowMs - from) / DAY_MS
}

/**
 * Decide whether a single pool should be archived by the daily sweep.
 *
 * The three automated criteria, in priority order:
 *
 *  1. `completed` — finished, and `completed_at` is more than 7 days old, so
 *     members have had a week to review the final state.
 *  2. `emergency_withdrawn` — funds pulled, and more than 30 days have passed.
 *  3. `inactive_90d` — no activity for 90 days *and* the pool holds nothing.
 *     The balance check is the important half: a pool sitting quietly on real
 *     member funds is not dead, it is waiting, and hiding it would be a
 *     false positive with money attached.
 *
 * `admin_archived` is never produced here — it only ever comes from the manual
 * endpoint, which is why an admin can archive a pool this function would keep.
 */
export function evaluateArchival(pool: ArchivalCandidate, nowMs: number): ArchivalDecision {
  // Already archived — the sweep must be idempotent across daily runs.
  if (pool.archived_at) return { archive: false }

  if (pool.status === "completed" && pool.completed_at) {
    const age = daysBetween(pool.completed_at, nowMs)
    if (Number.isFinite(age) && age >= COMPLETED_GRACE_DAYS) {
      return {
        archive: true,
        reason: "completed",
        note: `Completed ${Math.floor(age)} days ago (grace period ${COMPLETED_GRACE_DAYS} days)`,
      }
    }
  }

  if (pool.status === "emergency_withdrawn" && pool.emergency_withdrawn_at) {
    const age = daysBetween(pool.emergency_withdrawn_at, nowMs)
    if (Number.isFinite(age) && age >= EMERGENCY_WITHDRAWN_GRACE_DAYS) {
      return {
        archive: true,
        reason: "emergency_withdrawn",
        note: `Emergency withdrawn ${Math.floor(age)} days ago (grace period ${EMERGENCY_WITHDRAWN_GRACE_DAYS} days)`,
      }
    }
  }

  // A paused pool is paused on purpose — an admin is expected to come back to
  // it — so silence alone must not sweep it out of discovery.
  if (pool.status === "active") {
    const silenceAnchor = pool.last_activity_at ?? pool.created_at
    const silentDays = daysBetween(silenceAnchor, nowMs)
    const isEmpty = holdsNoFunds(pool.net_balance)
    if (Number.isFinite(silentDays) && silentDays >= INACTIVE_THRESHOLD_DAYS && isEmpty) {
      return {
        archive: true,
        reason: "inactive_90d",
        note: `No activity for ${Math.floor(silentDays)} days and no member funds held`,
      }
    }
  }

  return { archive: false }
}

/**
 * Whether a pool holds nothing on behalf of its members — never deposited, or
 * fully withdrawn. Tolerates the sub-unit dust that rounding in the activity
 * amounts can leave behind, and treats a negative net (over-counted payouts)
 * as empty rather than as a reason to keep a dead pool alive.
 */
export function holdsNoFunds(netBalance: number): boolean {
  if (!Number.isFinite(netBalance)) return false
  return netBalance <= 1e-9
}

/**
 * Net funds a pool still holds, derived from its activity feed. Mirrors the
 * deposit/withdrawal aggregation in /api/analytics and the metrics cron so all
 * three agree on what "empty" means.
 */
export function netBalanceFromActivity(
  activities: { activity_type: string | null; amount: number | null }[]
): number {
  let net = 0
  for (const activity of activities) {
    const type = activity.activity_type?.toLowerCase()
    const amount = activity.amount ?? 0
    if (!Number.isFinite(amount)) continue
    if (type === "deposit") net += amount
    else if (type === "withdraw" || type === "payout") net -= amount
  }
  return net
}

/** Newest `created_at` in an activity list, or null when the list is empty. */
export function latestActivityAt(activities: { created_at: string }[]): string | null {
  let newest: string | null = null
  let newestMs = -Infinity
  for (const activity of activities) {
    const ms = new Date(activity.created_at).getTime()
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms
      newest = activity.created_at
    }
  }
  return newest
}

/** Minimal archived-pool shape the UI needs to explain an archival. */
export interface ArchivedPoolSummary {
  archived_at: string | null
  archive_reason: ArchiveReason | null
}

export function isArchived(pool: ArchivedPoolSummary): boolean {
  return !!pool.archived_at
}
