import { supabase } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import {
  calculatePoolHealth,
  predictTargetPoolCompletion,
  aggregateHistoricalData,
} from "@/lib/analytics"
import { readLimiter } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited
    const poolId = req.nextUrl.searchParams.get("poolId")
    const userAddress = req.nextUrl.searchParams.get("userAddress")
    const isDev = process.env.NODE_ENV === "development"
    const useMock = req.nextUrl.searchParams.get("mock") === "true"

    // MOCK DATA FALLBACKS FOR DEMO / SCREENSHOTS - Only trigger in development with ?mock=true
    if (isDev && useMock && poolId && poolId.startsWith("pool-")) {
      if (poolId === "pool-rotational") {
        return NextResponse.json({
          pool: {
            id: "pool-rotational",
            name: "Family Rotational Savings",
            type: "rotational",
            status: "active",
            target_amount: 1000,
            deadline: null,
            created_at: "2026-06-01T00:00:00Z",
            round_duration: 604800,
          },
          metrics: {
            currentBalance: 500,
            totalDeposits: 800,
            totalWithdrawals: 300,
            health: { healthScore: 95, participationRate: 92, riskIndicator: "Low" },
            prediction: {
              daysToTarget: 0,
              projectedDate: null,
              message:
                "Rotational cycles execute automatically once all member contributions are verified.",
            },
            membersCount: 6,
            activeMembersCount: 5,
            lateMembersCount: 0,
            pendingMembersCount: 1,
          },
          chartData: [
            { date: "Jun 10", deposits: 150, withdrawals: 0, balance: 150 },
            { date: "Jun 11", deposits: 300, withdrawals: 50, balance: 250 },
            { date: "Jun 12", deposits: 450, withdrawals: 100, balance: 350 },
            { date: "Jun 13", deposits: 600, withdrawals: 150, balance: 450 },
            { date: "Jun 14", deposits: 800, withdrawals: 300, balance: 500 },
          ],
        })
      }
      if (poolId === "pool-target") {
        return NextResponse.json({
          pool: {
            id: "pool-target",
            name: "Tech Upgrade Fund",
            type: "target",
            status: "active",
            target_amount: 2000,
            deadline: "2026-07-15T00:00:00Z",
            created_at: "2026-06-05T00:00:00Z",
          },
          metrics: {
            currentBalance: 450,
            totalDeposits: 650,
            totalWithdrawals: 200,
            health: { healthScore: 78, participationRate: 75, riskIndicator: "Medium" },
            prediction: {
              daysToTarget: 22,
              projectedDate: "2026-07-09",
              message: "At the current rate, target will be reached in 22 days.",
            },
            membersCount: 4,
            activeMembersCount: 3,
            lateMembersCount: 1,
            pendingMembersCount: 0,
          },
          chartData: [
            { date: "Jun 10", deposits: 100, withdrawals: 0, balance: 100 },
            { date: "Jun 11", deposits: 200, withdrawals: 0, balance: 200 },
            { date: "Jun 12", deposits: 350, withdrawals: 100, balance: 250 },
            { date: "Jun 13", deposits: 500, withdrawals: 150, balance: 350 },
            { date: "Jun 14", deposits: 650, withdrawals: 200, balance: 450 },
          ],
        })
      }
      if (poolId === "pool-flexible") {
        return NextResponse.json({
          pool: {
            id: "pool-flexible",
            name: "Emergency Rainy Day",
            type: "flexible",
            status: "active",
            target_amount: null,
            deadline: null,
            created_at: "2026-06-02T00:00:00Z",
          },
          metrics: {
            currentBalance: 300,
            totalDeposits: 350,
            totalWithdrawals: 50,
            health: { healthScore: 90, participationRate: 88, riskIndicator: "Low" },
            prediction: {
              daysToTarget: 0,
              projectedDate: null,
              message: "Flexible saving structure allows withdrawals at any time.",
            },
            membersCount: 8,
            activeMembersCount: 7,
            lateMembersCount: 0,
            pendingMembersCount: 1,
          },
          chartData: [
            { date: "Jun 10", deposits: 50, withdrawals: 0, balance: 50 },
            { date: "Jun 11", deposits: 100, withdrawals: 0, balance: 100 },
            { date: "Jun 12", deposits: 150, withdrawals: 0, balance: 150 },
            { date: "Jun 13", deposits: 250, withdrawals: 50, balance: 200 },
            { date: "Jun 14", deposits: 350, withdrawals: 50, balance: 300 },
          ],
        })
      }
    }

    // Case 1: Specific Pool Analytics
    if (poolId) {
      // Fetch pool, members, activity
      const { data: pool, error: poolError } = await supabase
        .from("pools")
        .select("*")
        .eq("id", poolId)
        .single()

      if (poolError || !pool) {
        return NextResponse.json({ error: "Pool not found" }, { status: 404 })
      }

      const { data: members, error: membersError } = await supabase
        .from("pool_members")
        .select("*")
        .eq("pool_id", poolId)

      const { data: activities, error: actError } = await supabase
        .from("pool_activity")
        .select("*")
        .eq("pool_id", poolId)
        .order("created_at", { ascending: true })

      if (membersError || actError) {
        return NextResponse.json({ error: "Failed to fetch members or activity" }, { status: 500 })
      }

      // Fetch stored daily metrics & health scores
      const { data: dailyMetrics } = await supabase
        .from("pool_daily_metrics")
        .select("*")
        .eq("pool_id", poolId)
        .order("date", { ascending: true })

      const { data: storedHealth } = await supabase
        .from("pool_health_scores")
        .select("*")
        .eq("pool_id", poolId)
        .single()

      // Calculate health & predictive metrics dynamically
      const activeMembers = members || []
      const activeActivities = activities || []
      const calculatedHealth = calculatePoolHealth(pool, activeMembers, activeActivities)

      // Calculate balance
      const totalDeposits = activeActivities
        .filter((a: { activity_type: string }) => a.activity_type.toLowerCase() === "deposit")
        .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)

      const totalWithdrawals = activeActivities
        .filter(
          (a: { activity_type: string }) =>
            a.activity_type.toLowerCase() === "withdraw" ||
            a.activity_type.toLowerCase() === "payout"
        )
        .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)

      const currentBalance = totalDeposits - totalWithdrawals

      const prediction = predictTargetPoolCompletion(
        pool.target_amount || 0,
        currentBalance,
        activeActivities,
        pool.created_at
      )

      // Get historical chart data
      // Use stored daily metrics if available, otherwise aggregate dynamically
      let chartData = []
      if (dailyMetrics && dailyMetrics.length > 0) {
        chartData = dailyMetrics.map(
          (dm: {
            date: string
            total_deposits: number
            total_withdrawals: number
            total_balance: number
          }) => ({
            date: dm.date,
            deposits: dm.total_deposits,
            withdrawals: dm.total_withdrawals,
            balance: dm.total_balance,
          })
        )
      } else {
        chartData = aggregateHistoricalData(activeActivities, pool.created_at)
      }

      // Save/update calculated health to database asynchronously
      // Ignore errors so it doesn't block API
      supabase
        .from("pool_health_scores")
        .upsert({
          pool_id: poolId,
          health_score: calculatedHealth.healthScore,
          participation_rate: calculatedHealth.participationRate,
          risk_indicator: calculatedHealth.riskIndicator,
          last_calculated_at: new Date().toISOString(),
        })
        .then(({ error }: { error: unknown }) => {
          if (error) console.error("Failed to update health scores table:", error)
        })

      return NextResponse.json({
        pool,
        metrics: {
          currentBalance,
          totalDeposits,
          totalWithdrawals,
          health: storedHealth
            ? {
                healthScore: storedHealth.health_score,
                participationRate: storedHealth.participation_rate,
                riskIndicator: storedHealth.risk_indicator,
              }
            : calculatedHealth,
          prediction,
          membersCount: activeMembers.length,
          activeMembersCount: activeMembers.filter((m: { status: string }) => m.status === "paid")
            .length,
          lateMembersCount: activeMembers.filter((m: { status: string }) => m.status === "late")
            .length,
          pendingMembersCount: activeMembers.filter(
            (m: { status: string }) => m.status === "pending"
          ).length,
        },
        chartData,
      })
    }

    // Case 2: User-specific dashboard aggregation
    if (userAddress) {
      const lower = userAddress.toLowerCase()

      // Fetch user's memberships
      const { data: memberships } = await supabase
        .from("pool_members")
        .select("pool_id, pools(*)")
        .eq("member_address", lower)

      const userPools = (memberships || []).map((m: { pools: unknown }) => m.pools).filter(Boolean)

      if (userPools.length === 0) {
        if (isDev && useMock) {
          return NextResponse.json({
            totalPools: 3,
            totalSaved: 1250.0,
            totalDeposits: 1800.0,
            totalWithdrawals: 550.0,
            averageHealthScore: 88,
            poolsAnalytics: [
              {
                id: "pool-rotational",
                name: "Family Rotational Savings",
                type: "rotational",
                status: "active",
                balance: 500.0,
                healthScore: 95,
                riskIndicator: "Low",
              },
              {
                id: "pool-target",
                name: "Tech Upgrade Fund",
                type: "target",
                status: "active",
                balance: 450.0,
                healthScore: 78,
                riskIndicator: "Medium",
              },
              {
                id: "pool-flexible",
                name: "Emergency Rainy Day",
                type: "flexible",
                status: "active",
                balance: 300.0,
                healthScore: 90,
                riskIndicator: "Low",
              },
            ],
            globalChartData: [
              { date: "Jun 10", deposits: 300, withdrawals: 0, balance: 300 },
              { date: "Jun 11", deposits: 500, withdrawals: 50, balance: 450 },
              { date: "Jun 12", deposits: 800, withdrawals: 100, balance: 700 },
              { date: "Jun 13", deposits: 1100, withdrawals: 200, balance: 900 },
              { date: "Jun 14", deposits: 1400, withdrawals: 300, balance: 1100 },
              { date: "Jun 15", deposits: 1800, withdrawals: 550, balance: 1250 },
            ],
          })
        }

        return NextResponse.json({
          totalPools: 0,
          totalSaved: 0,
          totalDeposits: 0,
          totalWithdrawals: 0,
          averageHealthScore: 100,
          poolsAnalytics: [],
          globalChartData: [],
        })
      }

      const poolIds = userPools.map((p: { id: string }) => p.id)

      // Fetch all user activities across these pools
      const { data: userActivities } = await supabase
        .from("pool_activity")
        .select("*")
        .in("pool_id", poolIds)
        .order("created_at", { ascending: true })

      const activities = userActivities || []

      // Calculate aggregate stats
      const totalDeposits = activities
        .filter(
          (a: { user_address?: string | null; activity_type: string }) =>
            a.user_address?.toLowerCase() === lower && a.activity_type.toLowerCase() === "deposit"
        )
        .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)

      const totalWithdrawals = activities
        .filter(
          (a: { user_address?: string | null; activity_type: string }) =>
            a.user_address?.toLowerCase() === lower &&
            (a.activity_type.toLowerCase() === "withdraw" ||
              a.activity_type.toLowerCase() === "payout")
        )
        .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)

      const totalSaved = totalDeposits - totalWithdrawals

      // Fetch health scores for user's pools
      const { data: healthScores } = await supabase
        .from("pool_health_scores")
        .select("*")
        .in("pool_id", poolIds)

      const averageHealthScore =
        healthScores && healthScores.length > 0
          ? Math.round(
              healthScores.reduce(
                (sum: number, h: { health_score: number }) => sum + h.health_score,
                0
              ) / healthScores.length
            )
          : 100

      // Map pools with their analytics
      const poolsAnalytics = userPools.map(
        (pool: { id: string; name: string; type: string; status: string }) => {
          const poolHealth = healthScores?.find((h: { pool_id: string }) => h.pool_id === pool.id)
          const poolActs = activities.filter((a: { pool_id: string }) => a.pool_id === pool.id)
          const poolDeps = poolActs
            .filter((a: { activity_type: string }) => a.activity_type.toLowerCase() === "deposit")
            .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)
          const poolWits = poolActs
            .filter(
              (a: { activity_type: string }) =>
                a.activity_type.toLowerCase() === "withdraw" ||
                a.activity_type.toLowerCase() === "payout"
            )
            .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)

          return {
            id: pool.id,
            name: pool.name,
            type: pool.type,
            status: pool.status,
            balance: poolDeps - poolWits,
            healthScore: poolHealth?.health_score ?? 100,
            riskIndicator: poolHealth?.risk_indicator ?? "Low",
          }
        }
      )

      // Aggregate user global historical chart data
      const globalChartData = aggregateHistoricalData(
        activities.filter(
          (a: { user_address?: string | null }) => a.user_address?.toLowerCase() === lower
        )
      )

      return NextResponse.json({
        totalPools: userPools.length,
        totalSaved,
        totalDeposits,
        totalWithdrawals,
        averageHealthScore,
        poolsAnalytics,
        globalChartData,
      })
    }

    // Case 3: Global platform analytics
    const { data: allPools } = await supabase.from("pools").select("*")
    const { data: allActivities } = await supabase
      .from("pool_activity")
      .select("*")
      .order("created_at", { ascending: true })

    const pools = allPools || []
    const activities = allActivities || []

    const totalDeposits = activities
      .filter((a: { activity_type: string }) => a.activity_type.toLowerCase() === "deposit")
      .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)

    const totalWithdrawals = activities
      .filter(
        (a: { activity_type: string }) =>
          a.activity_type.toLowerCase() === "withdraw" || a.activity_type.toLowerCase() === "payout"
      )
      .reduce((sum: number, a: { amount?: number }) => sum + (a.amount || 0), 0)

    const globalChartData = aggregateHistoricalData(activities)

    return NextResponse.json({
      totalPools: pools.length,
      totalDeposits,
      totalWithdrawals,
      activePools: pools.filter((p: { status: string }) => p.status === "active").length,
      globalChartData,
    })
  } catch (error) {
    console.error("Analytics fetch error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
