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
