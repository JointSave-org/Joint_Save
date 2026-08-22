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

// ── Rich pool health score (Issue #224) ──────────────────────────────────────

/** Input data for the rich health calculation. */
export interface PoolHealthInput {
  /** Total members in the pool. */
  membersCount: number
  /** Number of members who deposited in the current round (0–membersCount). */
  depositedThisRound: number
  /** Total value locked now, in token units. */
  tvlNow: number
  /** Total value locked 7 days ago, in token units. */
  tvl7dAgo: number
  /**
   * Deadline for the next deposit, as a UNIX timestamp (ms).
   * Pass `null` for pools without fixed deadlines.
   */
  deadlineMs: number | null
  /** Number of open or unresolved disputes. */
  disputeCount: number
  /**
   * Timestamp of the most recent activity (deposit / withdrawal / payout), in ms.
   * Pass `null` when no activity has been recorded.
   */
  lastActivityMs: number | null
  /**
   * Number of members who have been active in the past 30 days.
   * Pass `null` when unknown.
   */
  activeMembers30d: number | null
}

/** Weighted component scores that make up the overall health score. */
export interface HealthFactors {
  /** 0–100: share of members who deposited on time this round. */
  depositCompliance: number
  /** 0–100: share of members active in last 30 days. */
  memberActivity: number
  /** 0–100: TVL stability over the last 7 days. */
  tvlTrend: number
  /** 0–100: time remaining before next deadline (100 = plenty of time). */
  deadlineProximity: number
  /** 0–100: penalty for open disputes (100 = no disputes). */
  disputeCount: number
}

/** A letter grade mapped from the overall score. */
export type HealthGrade = "A" | "B" | "C" | "D" | "F"

/** Direction the health score is trending. */
export type HealthTrend = "improving" | "stable" | "declining"

/** Full rich health result returned by `calculatePoolHealth`. */
export interface PoolHealthScore {
  /** Composite 0–100 score. */
  score: number
  /** Letter grade derived from `score`. */
  grade: HealthGrade
  /** Individual factor scores that make up `score`. */
  factors: HealthFactors
  /** Overall trend direction. */
  trend: HealthTrend
  /** Actionable suggestion strings for this pool, ordered by urgency. */
  suggestions: string[]
}

/** Grade thresholds (inclusive lower bound). */
const GRADE_THRESHOLDS: { grade: HealthGrade; min: number }[] = [
  { grade: "A", min: 90 },
  { grade: "B", min: 70 },
  { grade: "C", min: 50 },
  { grade: "D", min: 30 },
  { grade: "F", min: 0 },
]

function gradeFor(score: number): HealthGrade {
  for (const { grade, min } of GRADE_THRESHOLDS) {
    if (score >= min) return grade
  }
  return "F"
}

/** Factor weights that must sum to 1. */
const WEIGHTS = {
  depositCompliance: 0.35,
  memberActivity: 0.2,
  tvlTrend: 0.2,
  deadlineProximity: 0.15,
  disputeCount: 0.1,
} as const

/**
 * Calculate a rich pool health score from client-side data.
 *
 * All computation is synchronous and pure — no API calls — so scores can be
 * cached client-side and invalidated on a timer.
 */
export function calculatePoolHealth(input: PoolHealthInput): PoolHealthScore {
  const {
    membersCount,
    depositedThisRound,
    tvlNow,
    tvl7dAgo,
    deadlineMs,
    disputeCount,
    lastActivityMs,
    activeMembers30d,
  } = input

  const now = Date.now()

  // ── Factor 1: deposit compliance ─────────────────────────────────────────
  const depositCompliance =
    membersCount > 0 ? Math.round((depositedThisRound / membersCount) * 100) : 100

  // ── Factor 2: member activity ─────────────────────────────────────────────
  const memberActivity =
    activeMembers30d !== null && membersCount > 0
      ? Math.round((activeMembers30d / membersCount) * 100)
      : 100 // unknown → neutral

  // ── Factor 3: TVL trend ───────────────────────────────────────────────────
  let tvlTrendScore: number
  if (tvl7dAgo <= 0) {
    // No prior TVL to compare — treat as neutral.
    tvlTrendScore = 70
  } else {
    const changePct = ((tvlNow - tvl7dAgo) / tvl7dAgo) * 100
    // +5 % or better → 100; flat → 70; -20 % or worse → 0
    tvlTrendScore = Math.min(100, Math.max(0, Math.round(70 + changePct * 3)))
  }

  // ── Factor 4: deadline proximity ─────────────────────────────────────────
  let deadlineProximityScore: number
  if (deadlineMs === null) {
    deadlineProximityScore = 80 // no deadline → comfortable
  } else {
    const msRemaining = deadlineMs - now
    const daysRemaining = msRemaining / (1000 * 60 * 60 * 24)
    if (daysRemaining <= 0) {
      deadlineProximityScore = 0 // already past
    } else if (daysRemaining >= 7) {
      deadlineProximityScore = 100
    } else {
      // linear scale: 0 days → 0, 7 days → 100
      deadlineProximityScore = Math.round((daysRemaining / 7) * 100)
    }
  }

  // ── Factor 5: dispute penalty ─────────────────────────────────────────────
  // 0 disputes → 100; each dispute costs 25 points.
  const disputeScore = Math.max(0, 100 - disputeCount * 25)

  const factors: HealthFactors = {
    depositCompliance,
    memberActivity,
    tvlTrend: tvlTrendScore,
    deadlineProximity: deadlineProximityScore,
    disputeCount: disputeScore,
  }

  // ── Composite score ───────────────────────────────────────────────────────
  const score = Math.round(
    factors.depositCompliance * WEIGHTS.depositCompliance +
      factors.memberActivity * WEIGHTS.memberActivity +
      factors.tvlTrend * WEIGHTS.tvlTrend +
      factors.deadlineProximity * WEIGHTS.deadlineProximity +
      factors.disputeCount * WEIGHTS.disputeCount
  )

  const grade = gradeFor(score)

  // ── Trend ─────────────────────────────────────────────────────────────────
  let trend: HealthTrend
  if (tvl7dAgo <= 0) {
    trend = "stable"
  } else {
    const tvlChangePct = ((tvlNow - tvl7dAgo) / tvl7dAgo) * 100
    if (tvlChangePct > 5) {
      trend = "improving"
    } else if (tvlChangePct < -5) {
      trend = "declining"
    } else {
      trend = "stable"
    }
  }

  // ── Suggestions ───────────────────────────────────────────────────────────
  const suggestions: string[] = []

  // Deposit compliance warning
  if (depositCompliance < 80 && membersCount > 0) {
    const missing = membersCount - depositedThisRound
    suggestions.push(`${missing} member${missing !== 1 ? "s" : ""} haven't deposited for the current round`)
  }

  // Deadline warning
  if (deadlineMs !== null) {
    const daysLeft = Math.ceil((deadlineMs - now) / (1000 * 60 * 60 * 24))
    const deadlinePct = (deadlineProximityScore / 100) * 100
    if (deadlinePct < 30 && daysLeft > 0) {
      suggestions.push(`Deposit deadline is approaching in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`)
    } else if (daysLeft <= 0) {
      suggestions.push("The deposit deadline has passed")
    }
  }

  // TVL trend warning
  if (trend === "declining") {
    suggestions.push("TVL has decreased over the last 7 days")
  }

  // Member inactivity warning
  if (activeMembers30d !== null && membersCount > 0 && memberActivity < 50) {
    const inactiveCount = membersCount - activeMembers30d
    suggestions.push(
      `${inactiveCount} member${inactiveCount !== 1 ? "s" : ""} have been inactive for 30+ days`
    )
  }

  // No recent activity
  if (lastActivityMs !== null) {
    const daysSinceActivity = (now - lastActivityMs) / (1000 * 60 * 60 * 24)
    if (daysSinceActivity >= 14) {
      suggestions.push("No activity in 2 weeks")
    }
  }

  // Low member count
  if (membersCount < 3) {
    suggestions.push("Pool has very few members")
  }

  return { score, grade, factors, trend, suggestions }
}

// ── 5-minute client-side cache ────────────────────────────────────────────────

const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  result: PoolHealthScore
  computedAt: number
}

const healthCache = new Map<string, CacheEntry>()

/**
 * Cached wrapper around `calculatePoolHealth`.
 * Results are reused for up to 5 minutes per pool id.
 */
export function getCachedPoolHealth(poolId: string, input: PoolHealthInput): PoolHealthScore {
  const cached = healthCache.get(poolId)
  if (cached && Date.now() - cached.computedAt < HEALTH_CACHE_TTL_MS) {
    return cached.result
  }
  const result = calculatePoolHealth(input)
  healthCache.set(poolId, { result, computedAt: Date.now() })
  return result
}
