import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { readLimiter } from "@/lib/rate-limit"
import { jsonPrivate } from "@/lib/cache-headers"

export interface AdminPoolData {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: "active" | "completed" | "paused"
  creator_address: string
  contract_address: string
  token_symbol: string
  token_decimals: number
  total_saved: number
  members_count: number
  next_payout: string | null
  contribution_amount: number | null
  target_amount: number | null
  deadline: string | null
  created_at: string
  updated_at: string
  pool_members: { member_address: string; status: string }[]
  pool_activity: { activity_type: string; created_at: string; amount: number | null }[]
  health_score: number
  health_band: "healthy" | "fair" | "at-risk" | "new"
  anomalies: Anomaly[]
}

export interface Anomaly {
  type: AnomalyType
  severity: "info" | "warning" | "critical"
  message: string
  suggestedAction: string
}

export type AnomalyType =
  | "stale_pool"
  | "low_members"
  | "at_risk_reputation"
  | "near_capacity"
  | "stale_disputes"

const STALE_POOL_DAYS = 30
const LOW_MEMBER_COUNT = 3
const NEAR_CAPACITY_THRESHOLD = 0.8
const STALE_DISPUTE_HOURS = 48
const AT_RISK_REPUTATION_THRESHOLD = 0.5

function detectAnomalies(
  pool: AdminPoolData,
  members: { member_address: string; status: string }[],
  activities: { activity_type: string; created_at: string }[]
): Anomaly[] {
  const anomalies: Anomaly[] = []
  const now = Date.now()

  // Stale pool: no deposits in last 30 days
  const depositActivities = activities.filter((a) => a.activity_type === "deposit")
  const lastDeposit = depositActivities.length > 0
    ? new Date(depositActivities[0].created_at).getTime()
    : new Date(pool.created_at).getTime()
  const daysSinceLastDeposit = (now - lastDeposit) / (1000 * 60 * 60 * 24)
  if (daysSinceLastDeposit > STALE_POOL_DAYS) {
    anomalies.push({
      type: "stale_pool",
      severity: "warning",
      message: `No deposits in the last ${Math.floor(daysSinceLastDeposit)} days`,
      suggestedAction: "Send a reminder to pool members or consider pausing the pool.",
    })
  }

  // Low member count
  if (members.length < LOW_MEMBER_COUNT) {
    anomalies.push({
      type: "low_members",
      severity: members.length === 0 ? "critical" : "warning",
      message: `Pool has only ${members.length} member${members.length === 1 ? "" : "s"}`,
      suggestedAction: "Invite more members to increase pool participation and stability.",
    })
  }

  // At-risk reputation: >50% members with "late" status
  if (members.length > 0) {
    const lateCount = members.filter((m) => m.status === "late").length
    const lateRatio = lateCount / members.length
    if (lateRatio > AT_RISK_REPUTATION_THRESHOLD) {
      anomalies.push({
        type: "at_risk_reputation",
        severity: "critical",
        message: `${Math.round(lateRatio * 100)}% of members have "late" deposit status`,
        suggestedAction: "Review member participation and consider contacting at-risk members.",
      })
    }
  }

  // Near capacity (>80% of max members)
  const MAX_POOL_MEMBERS = 50
  if (members.length >= MAX_POOL_MEMBERS * NEAR_CAPACITY_THRESHOLD) {
    anomalies.push({
      type: "near_capacity",
      severity: "info",
      message: `Pool is at ${members.length}/${MAX_POOL_MEMBERS} capacity (${Math.round((members.length / MAX_POOL_MEMBERS) * 100)}%)`,
      suggestedAction: "Consider opening a new pool if capacity is reached soon.",
    })
  }

  // Stale disputes: pending join requests older than 48 hours
  const pendingRequests = activities.filter((a) => a.activity_type === "join_request_pending")
  const staleRequests = pendingRequests.filter((a) => {
    const hoursSince = (now - new Date(a.created_at).getTime()) / (1000 * 60 * 60)
    return hoursSince > STALE_DISPUTE_HOURS
  })
  if (staleRequests.length > 0) {
    anomalies.push({
      type: "stale_disputes",
      severity: "warning",
      message: `${staleRequests.length} pending request(s) older than ${STALE_DISPUTE_HOURS} hours`,
      suggestedAction: "Review and respond to pending join requests promptly.",
    })
  }

  return anomalies
}

function computeHealthScore(
  membersCount: number,
  activities: { activity_type: string; created_at: string }[],
  createdAt: string,
  status: string
): { score: number; band: "healthy" | "fair" | "at-risk" | "new" } {
  const now = Date.now()

  // Member ratio (0-1): how full is the pool relative to a reasonable size (10 members)
  const memberRatio = Math.min(1, membersCount / 10)

  // Deposit compliance: ratio of deposit activities to total expected
  const totalDays = Math.max(1, (now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
  const depositCount = activities.filter((a) => a.activity_type === "deposit").length
  const expectedDeposits = Math.min(totalDays / 7, 50) // rough estimate
  const depositCompliance = Math.min(1, depositCount / Math.max(1, expectedDeposits))

  // Activity recency: days since last activity (more recent = higher score)
  const lastActivity = activities.length > 0
    ? new Date(activities[0].created_at).getTime()
    : new Date(createdAt).getTime()
  const daysSinceActivity = (now - lastActivity) / (1000 * 60 * 60 * 24)
  const activityRecency = Math.max(0, 1 - daysSinceActivity / 60) // 60 days decay

  // TVL trend: simplified - based on total saved relative to expected
  const tvlTrend = status === "active" ? 0.8 : status === "completed" ? 1 : 0.5

  const score = Math.round(
    (memberRatio * 0.3 + depositCompliance * 0.3 + activityRecency * 0.2 + tvlTrend * 0.2) * 100
  )

  let band: "healthy" | "fair" | "at-risk" | "new"
  if (membersCount === 0) {
    band = "new"
  } else if (score >= 85) {
    band = "healthy"
  } else if (score >= 60) {
    band = "fair"
  } else {
    band = "at-risk"
  }

  return { score, band }
}

export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited

    const wallet = req.nextUrl.searchParams.get("wallet")
    if (!wallet) {
      return NextResponse.json({ error: "wallet parameter is required" }, { status: 400 })
    }

    const admin = getAdminClient()

    // Fetch all pools where the wallet is the creator/admin
    const { data: pools, error: poolsError } = await admin
      .from("pools")
      .select(`
        *,
        pool_members (
          member_address,
          status
        ),
        pool_activity (
          activity_type,
          created_at,
          amount
        )
      `)
      .eq("creator_address", wallet.toLowerCase())
      .order("created_at", { ascending: false })

    if (poolsError) {
      throw poolsError
    }

    if (!pools || pools.length === 0) {
      return jsonPrivate({ pools: [], totalAnomalies: 0 })
    }

    // Compute health scores and detect anomalies for each pool
    const enrichedPools: AdminPoolData[] = pools.map((pool) => {
      const members = (pool.pool_members as { member_address: string; status: string }[]) ?? []
      const activities = (pool.pool_activity as { activity_type: string; created_at: string; amount: number | null }[]) ?? []

      const { score, band } = computeHealthScore(
        members.length,
        activities,
        pool.created_at,
        pool.status
      )

      const anomalies = detectAnomalies(
        { ...pool, health_score: score, health_band: band, anomalies: [] } as AdminPoolData,
        members,
        activities
      )

      return {
        ...pool,
        health_score: score,
        health_band: band,
        anomalies,
      }
    })

    const totalAnomalies = enrichedPools.reduce((sum, p) => sum + p.anomalies.length, 0)

    return jsonPrivate({ pools: enrichedPools, totalAnomalies })
  } catch (error) {
    console.error("Admin pools fetch error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch admin pools" },
      { status: 500 }
    )
  }
}
