// Per-pool health score derived from the reputation system.
//
// A pool's health reflects how reliably its current members have been making
// their deposits on time. We take the average on-time deposit rate across all
// current members (from the on-chain reputation tracker) and gate it on how
// much real history the pool actually has, so a brand-new pool — where every
// member defaults to a perfect 100% on-time rate with no real data behind it —
// is shown as a neutral "New pool" rather than a misleadingly high score.

/** Minimum rounds/history a pool must have observed before we show a score. */
export const MIN_HISTORY = 1

/** Score (percent) at/above which a pool is considered healthy. */
export const HEALTHY_THRESHOLD = 85
/** Score (percent) at/above which a pool is considered fair (below = at risk). */
export const FAIR_THRESHOLD = 60

export type PoolHealthBand = "healthy" | "fair" | "at-risk"
export type PoolHealthState = "new" | "scored"

export interface PoolHealth {
  /** "scored" when there's enough history to show a number; "new" otherwise. */
  state: PoolHealthState
  /** Average on-time rate as a 0–100 percent. Null when state is "new". */
  score: number | null
  /** Colour band for the badge. Null when state is "new". */
  band: PoolHealthBand | null
  /** Human label: "Healthy" | "Fair" | "At risk" | "New pool". */
  label: string
  /** Number of current members the score was averaged over. */
  memberCount: number
  /**
   * How much participation history the pool has observed. For rotational pools
   * this is the number of rounds that have elapsed; for other pool types it's
   * the number of current members who already have an on-chain track record.
   */
  historyObserved: number
}

/** A member's reputation, as needed for the health calculation. */
export interface MemberReputation {
  /** On-time deposit rate in basis points (10000 = 100%). */
  onTimeRate: number
  /** Total deposits this member has ever made (base units). */
  totalDeposits: bigint
  /** Rounds this member has missed across all their pools. */
  missedRounds: number
  /** Pools this member has seen through to a completed payout. */
  poolsCompleted: number
}

/**
 * True when a member has any real participation track record, as opposed to the
 * default reputation handed to addresses the tracker has never seen (which
 * reports a perfect 100% on-time rate with zero activity).
 */
export function hasTrackRecord(rep: MemberReputation): boolean {
  return rep.totalDeposits > 0n || rep.missedRounds > 0 || rep.poolsCompleted > 0
}

function bandFor(score: number): { band: PoolHealthBand; label: string } {
  if (score >= HEALTHY_THRESHOLD) return { band: "healthy", label: "Healthy" }
  if (score >= FAIR_THRESHOLD) return { band: "fair", label: "Fair" }
  return { band: "at-risk", label: "At risk" }
}

// ── New aggregate health score (Issue #224) ──────────────────────────────────

/**
 * A pool member as seen by the health calculator.
 * Matches the shape returned by /api/pools/[id]/members (Supabase row).
 */
export interface PoolMember {
  member_address: string
  /** ISO timestamp of the member's most recent deposit, if any. */
  last_deposit_at?: string | null
  /** Total number of completed deposits for this member in this pool. */
  deposits_count?: number
  /** Whether the member has deposited in the current round (rotational). */
  paid_current_round?: boolean
}

/**
 * A single pool activity entry as seen by the health calculator.
 * Matches the shape returned by /api/pools/[id]/activity.
 */
export interface PoolActivity {
  /** ISO timestamp */
  created_at: string
  activity_type: string
  /** Amount deposited (raw number; 0 / null for non-deposit activities). */
  amount?: number | null
}

/** Weights and thresholds used in calculatePoolHealth. */
const WEIGHTS = {
  depositCompliance: 0.35,
  memberActivity: 0.25,
  tvlTrend: 0.2,
  deadlineProximity: 0.1,
  disputeCount: 0.1,
} as const

/** Grade bands for the 0–100 health score. */
const GRADE_BANDS: Array<{ min: number; grade: HealthGrade }> = [
  { min: 90, grade: "A" },
  { min: 70, grade: "B" },
  { min: 50, grade: "C" },
  { min: 30, grade: "D" },
  { min: 0, grade: "F" },
]

export type HealthGrade = "A" | "B" | "C" | "D" | "F"
export type HealthTrend = "improving" | "stable" | "declining"

export interface HealthFactors {
  /** 0–100 — share of members who deposited in the current round. */
  depositCompliance: number
  /** 0–100 — share of members active in the last 30 days. */
  memberActivity: number
  /** 0–100 — TVL growth direction encoded as a score. */
  tvlTrend: number
  /** 0–100 — how far from deadline (100 = plenty of time, 0 = overdue). */
  deadlineProximity: number
  /** 0–100 — penalty for dispute/removal events. */
  disputeCount: number
}

export interface PoolHealthScore {
  /** Composite 0–100 score. */
  score: number
  grade: HealthGrade
  factors: HealthFactors
  trend: HealthTrend
  /** Prioritised list of actionable improvement suggestions. */
  suggestions: string[]
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  result: PoolHealthScore
  expiresAt: number
}

const scoreCache = new Map<string, CacheEntry>()

/** Clear a specific cache entry (useful for tests). */
export function clearHealthCache(poolId: string) {
  scoreCache.delete(poolId)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function gradeFor(score: number): HealthGrade {
  return GRADE_BANDS.find((b) => score >= b.min)?.grade ?? "F"
}

/**
 * Returns a number from 0 (no activities recently) to 100 (lots of recent
 * activity) based on deposit events in two consecutive 7-day windows.
 */
function computeTvlTrend(activities: PoolActivity[]): { score: number; trend: HealthTrend } {
  const now = Date.now()
  const window7 = 7 * 24 * 60 * 60 * 1000
  const deposits = activities.filter((a) => a.activity_type === "deposit" && (a.amount ?? 0) > 0)

  const recent = deposits.filter((a) => now - new Date(a.created_at).getTime() <= window7).length
  const prior = deposits.filter((a) => {
    const age = now - new Date(a.created_at).getTime()
    return age > window7 && age <= 2 * window7
  }).length

  let trend: HealthTrend
  let score: number
  if (recent > prior) {
    trend = "improving"
    score = 80 + Math.min(20, (recent - prior) * 5)
  } else if (recent === prior) {
    trend = "stable"
    score = 60
  } else {
    trend = "declining"
    score = Math.max(0, 40 - (prior - recent) * 10)
  }
  return { score, trend }
}

/**
 * Scores proximity to next payout / deadline.
 * Returns 100 when no deadline is set, 0 when already overdue.
 */
function computeDeadlineScore(nextPayout?: string | null): number {
  if (!nextPayout) return 100
  const msLeft = new Date(nextPayout).getTime() - Date.now()
  if (msLeft <= 0) return 0
  const daysLeft = msLeft / (24 * 60 * 60 * 1000)
  if (daysLeft >= 14) return 100
  if (daysLeft >= 7) return 75
  if (daysLeft >= 3) return 50
  return 25
}

/**
 * Generates actionable, human-readable suggestions based on the computed
 * factors. Returned list is ordered from most to least urgent.
 */
function buildSuggestions(
  factors: HealthFactors,
  pool: { members_count: number; next_payout?: string | null },
  activities: PoolActivity[],
  trend: HealthTrend
): string[] {
  const suggestions: string[] = []

  if (factors.depositCompliance < 80) {
    const inactive = Math.round(pool.members_count * (1 - factors.depositCompliance / 100))
    suggestions.push(
      `${inactive} member${inactive !== 1 ? "s" : ""} haven't deposited for the current round`
    )
  }

  if (pool.next_payout) {
    const daysLeft = Math.ceil(
      (new Date(pool.next_payout).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    )
    if (daysLeft > 0 && factors.deadlineProximity < 30) {
      suggestions.push(
        `Deposit deadline is approaching in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
      )
    }
  }

  if (trend === "declining") {
    suggestions.push("TVL has decreased over the last 7 days")
  }

  if (factors.memberActivity < 50) {
    const inactive = Math.round(pool.members_count * (1 - factors.memberActivity / 100))
    suggestions.push(
      `${inactive} member${inactive !== 1 ? "s" : ""} have been inactive for 30+ days`
    )
  }

  const daysSinceActivity =
    activities.length > 0
      ? (Date.now() - new Date(activities[0].created_at).getTime()) / (24 * 60 * 60 * 1000)
      : Infinity
  if (daysSinceActivity >= 14) {
    suggestions.push("No activity in 2 weeks")
  }

  if (pool.members_count < 3) {
    suggestions.push("Pool has very few members — invite more to improve health")
  }

  return suggestions
}

/**
 * Compute a composite health score for a pool using its snapshot data,
 * current members, and recent activities.
 *
 * Results are cached client-side for 5 minutes keyed by pool ID.
 *
 * @param pool       The pool snapshot (Pool interface from pool-card.tsx)
 * @param members    Current member list from the DB
 * @param activities Recent activity entries (newest first)
 */
export function calculatePoolHealth(
  pool: {
    id: string
    members_count: number
    next_payout?: string | null
  },
  members: PoolMember[],
  activities: PoolActivity[]
): PoolHealthScore {
  // Return cached result if still valid
  const cached = scoreCache.get(pool.id)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result
  }

  const now = Date.now()
  const days30 = 30 * 24 * 60 * 60 * 1000

  // ── depositCompliance ──────────────────────────────────────────────────────
  // Share of members who have paid_current_round (rotational) or deposited
  // recently enough that their last_deposit_at is within the current window.
  const totalMembers = Math.max(members.length, pool.members_count, 1)
  const compliantCount = members.filter(
    (m) =>
      m.paid_current_round === true ||
      (m.last_deposit_at != null && now - new Date(m.last_deposit_at).getTime() < days30)
  ).length
  const depositCompliance = Math.round((compliantCount / totalMembers) * 100)

  // ── memberActivity ─────────────────────────────────────────────────────────
  const activeCount = members.filter(
    (m) => m.last_deposit_at != null && now - new Date(m.last_deposit_at).getTime() < days30
  ).length
  const memberActivity = Math.round((activeCount / totalMembers) * 100)

  // ── tvlTrend ───────────────────────────────────────────────────────────────
  const { score: tvlTrendScore, trend } = computeTvlTrend(activities)

  // ── deadlineProximity ──────────────────────────────────────────────────────
  const deadlineProximity = computeDeadlineScore(pool.next_payout)

  // ── disputeCount ──────────────────────────────────────────────────────────
  const removals = activities.filter((a) => a.activity_type === "member_removed").length
  const disputeCount = Math.max(0, 100 - removals * 20)

  const factors: HealthFactors = {
    depositCompliance,
    memberActivity,
    tvlTrend: tvlTrendScore,
    deadlineProximity,
    disputeCount,
  }

  // ── Weighted composite score ───────────────────────────────────────────────
  const score = Math.round(
    factors.depositCompliance * WEIGHTS.depositCompliance +
      factors.memberActivity * WEIGHTS.memberActivity +
      factors.tvlTrend * WEIGHTS.tvlTrend +
      factors.deadlineProximity * WEIGHTS.deadlineProximity +
      factors.disputeCount * WEIGHTS.disputeCount
  )

  const grade = gradeFor(score)
  const suggestions = buildSuggestions(factors, pool, activities, trend)

  const result: PoolHealthScore = { score, grade, factors, trend, suggestions }

  scoreCache.set(pool.id, { result, expiresAt: now + CACHE_TTL_MS })
  return result
}

// ── Original reputation-based health (preserved) ─────────────────────────────

/**
 * Compute a pool's health from its current members' reputations.
 *
 * @param reputations  reputation of each current member
 * @param historyObserved  rounds elapsed (rotational) or members-with-history
 *                         (other types) — the confidence gate
 */
export function computePoolHealth(
  reputations: MemberReputation[],
  historyObserved: number
): PoolHealth {
  const memberCount = reputations.length

  // Not enough to say anything meaningful: no members, or the pool hasn't
  // observed a full round / any member track record yet.
  if (memberCount === 0 || historyObserved < MIN_HISTORY) {
    return {
      state: "new",
      score: null,
      band: null,
      label: "New pool",
      memberCount,
      historyObserved,
    }
  }

  // Average on-time rate across members (basis points → percent).
  const avgBps = reputations.reduce((sum, r) => sum + r.onTimeRate, 0) / memberCount
  const score = Math.round(avgBps / 100)
  const { band, label } = bandFor(score)

  return { state: "scored", score, band, label, memberCount, historyObserved }
}
