import { supabase } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited

    const wallet = req.nextUrl.searchParams.get("wallet")
    if (!wallet) {
      return NextResponse.json({ error: "wallet parameter required" }, { status: 400 })
    }

    const lower = wallet.toLowerCase()

    const { data: memberships, error: memError } = await supabase
      .from("pool_members")
      .select("pool_id, pools(*)")
      .eq("member_address", lower)

    if (memError) throw memError

    const userPools = (memberships || [])
      .map((m: { pools: unknown }) => m.pools)
      .filter(Boolean) as Array<{
      id: string
      name: string
      type: "rotational" | "target" | "flexible"
      status: "active" | "completed" | "paused"
      total_saved: number
      contribution_amount: number | null
      next_payout: string | null
      target_amount: number | null
      members_count: number
      token_symbol: string | null
    }>

    const poolIds = userPools.map((p) => p.id)

    if (poolIds.length === 0) {
      return NextResponse.json({
        total_saved: 0,
        total_pools: { rotational: 0, target: 0, flexible: 0, total: 0 },
        total_yield_earned: 0,
        upcoming_commitments: [],
        reputation_summary: { total_deposits: 0, average_on_time_rate: 100, pools_completed: 0 },
        pools: [],
      })
    }

    const { data: allActivities } = await supabase
      .from("pool_activity")
      .select("*")
      .in("pool_id", poolIds)

    const activities = (allActivities || []) as Array<{
      id: string
      pool_id: string
      activity_type: string
      user_address: string | null
      amount: number | null
      created_at: string
    }>

    const userActivities = activities.filter((a) => a.user_address?.toLowerCase() === lower)

    const { data: healthScores } = await supabase
      .from("pool_health_scores")
      .select("*")
      .in("pool_id", poolIds)

    const deposits = userActivities
      .filter((a) => a.activity_type === "deposit")
      .reduce((s, a) => s + (a.amount || 0), 0)

    const withdrawals = userActivities
      .filter((a) => a.activity_type === "withdraw" || a.activity_type === "payout")
      .reduce((s, a) => s + (a.amount || 0), 0)

    const total_saved = Math.max(0, deposits - withdrawals)

    const poolsByType = { rotational: 0, target: 0, flexible: 0 }
    userPools.forEach((p) => {
      if (p.type in poolsByType) poolsByType[p.type as keyof typeof poolsByType]++
    })

    const total_yield_earned = userActivities
      .filter((a) => a.activity_type === "yield_distribution" || a.activity_type === "yield")
      .reduce((s, a) => s + (a.amount || 0), 0)

    const upcoming_commitments = userPools
      .filter((p) => p.type === "rotational" && p.next_payout)
      .map((p) => ({
        pool_id: p.id,
        pool_name: p.name,
        amount: p.contribution_amount || 0,
        deadline: p.next_payout as string,
        type: p.type,
      }))
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())

    function formatNextAction(p: {
      type: string
      next_payout: string | null
      deadline: string | null
      status: string
    }): string | null {
      if (p.status !== "active") return null
      if (p.type === "rotational" && p.next_payout) {
        return `Deposit due ${formatDeadline(p.next_payout)}`
      }
      if (p.type === "target" && p.deadline) {
        return `Target deadline ${formatDeadline(p.deadline)}`
      }
      return null
    }

    const pools = userPools.map((p) => {
      const poolActs = activities.filter((a) => a.pool_id === p.id)
      const poolDeposits = poolActs
        .filter((a) => a.activity_type === "deposit" && a.user_address?.toLowerCase() === lower)
        .reduce((s, a) => s + (a.amount || 0), 0)
      const poolWithdrawals = poolActs
        .filter(
          (a) =>
            (a.activity_type === "withdraw" || a.activity_type === "payout") &&
            a.user_address?.toLowerCase() === lower
        )
        .reduce((s, a) => s + (a.amount || 0), 0)

      const health = healthScores?.find((h: { pool_id: string }) => h.pool_id === p.id)

      return {
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        contribution: poolDeposits - poolWithdrawals,
        total_balance: p.total_saved || 0,
        health_score: (health as { health_score?: number })?.health_score ?? null,
        next_action: formatNextAction(p),
      }
    })

    return NextResponse.json({
      total_saved,
      total_pools: { ...poolsByType, total: userPools.length },
      total_yield_earned,
      upcoming_commitments,
      reputation_summary: {
        total_deposits: deposits,
        average_on_time_rate: 100,
        pools_completed: userPools.filter((p) => p.status === "completed").length,
      },
      pools,
    })
  } catch (error) {
    console.error("Portfolio summary error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

function formatDeadline(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff < 0) return "Overdue"
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `in ${days} days`
}
