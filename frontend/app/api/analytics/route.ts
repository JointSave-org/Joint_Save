import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import {
  calculatePoolHealth,
  predictTargetPoolCompletion,
  aggregateHistoricalData,
} from '@/lib/analytics'

export async function GET(req: NextRequest) {
  try {
    const poolId = req.nextUrl.searchParams.get('poolId')
    const userAddress = req.nextUrl.searchParams.get('userAddress')

    // Case 1: Specific Pool Analytics
    if (poolId) {
      // Fetch pool, members, activity
      const { data: pool, error: poolError } = await supabase
        .from('pools')
        .select('*')
        .eq('id', poolId)
        .single()

      if (poolError || !pool) {
        return NextResponse.json({ error: 'Pool not found' }, { status: 404 })
      }

      const { data: members, error: membersError } = await supabase
        .from('pool_members')
        .select('*')
        .eq('pool_id', poolId)

      const { data: activities, error: actError } = await supabase
        .from('pool_activity')
        .select('*')
        .eq('pool_id', poolId)
        .order('created_at', { ascending: true })

      if (membersError || actError) {
        return NextResponse.json({ error: 'Failed to fetch members or activity' }, { status: 500 })
      }

      // Fetch stored daily metrics & health scores
      const { data: dailyMetrics } = await supabase
        .from('pool_daily_metrics')
        .select('*')
        .eq('pool_id', poolId)
        .order('date', { ascending: true })

      const { data: storedHealth } = await supabase
        .from('pool_health_scores')
        .select('*')
        .eq('pool_id', poolId)
        .single()

      // Calculate health & predictive metrics dynamically
      const activeMembers = members || []
      const activeActivities = activities || []
      const calculatedHealth = calculatePoolHealth(pool, activeMembers, activeActivities)

      // Calculate balance
      const totalDeposits = activeActivities
        .filter((a) => a.activity_type.toLowerCase() === 'deposit')
        .reduce((sum, a) => sum + (a.amount || 0), 0)

      const totalWithdrawals = activeActivities
        .filter((a) => a.activity_type.toLowerCase() === 'withdraw' || a.activity_type.toLowerCase() === 'payout')
        .reduce((sum, a) => sum + (a.amount || 0), 0)

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
        chartData = dailyMetrics.map((dm) => ({
          date: dm.date,
          deposits: dm.total_deposits,
          withdrawals: dm.total_withdrawals,
          balance: dm.total_balance,
        }))
      } else {
        chartData = aggregateHistoricalData(activeActivities, pool.created_at)
      }

      // Save/update calculated health to database asynchronously
      // Ignore errors so it doesn't block API
      supabase
        .from('pool_health_scores')
        .upsert({
          pool_id: poolId,
          health_score: calculatedHealth.healthScore,
          participation_rate: calculatedHealth.participationRate,
          risk_indicator: calculatedHealth.riskIndicator,
          last_calculated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.error('Failed to update health scores table:', error)
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
          activeMembersCount: activeMembers.filter((m) => m.status === 'paid').length,
          lateMembersCount: activeMembers.filter((m) => m.status === 'late').length,
          pendingMembersCount: activeMembers.filter((m) => m.status === 'pending').length,
        },
        chartData,
      })
    }

    // Case 2: User-specific dashboard aggregation
    if (userAddress) {
      const lower = userAddress.toLowerCase()

      // Fetch user's memberships
      const { data: memberships } = await supabase
        .from('pool_members')
        .select('pool_id, pools(*)')
        .eq('member_address', lower)

      const userPools = (memberships || [])
        .map((m: any) => m.pools)
        .filter(Boolean)

      if (userPools.length === 0) {
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

      const poolIds = userPools.map((p) => p.id)

      // Fetch all user activities across these pools
      const { data: userActivities } = await supabase
        .from('pool_activity')
        .select('*')
        .in('pool_id', poolIds)
        .order('created_at', { ascending: true })

      const activities = userActivities || []

      // Calculate aggregate stats
      const totalDeposits = activities
        .filter((a) => a.user_address?.toLowerCase() === lower && a.activity_type.toLowerCase() === 'deposit')
        .reduce((sum, a) => sum + (a.amount || 0), 0)

      const totalWithdrawals = activities
        .filter((a) => a.user_address?.toLowerCase() === lower && (a.activity_type.toLowerCase() === 'withdraw' || a.activity_type.toLowerCase() === 'payout'))
        .reduce((sum, a) => sum + (a.amount || 0), 0)

      const totalSaved = totalDeposits - totalWithdrawals

      // Fetch health scores for user's pools
      const { data: healthScores } = await supabase
        .from('pool_health_scores')
        .select('*')
        .in('pool_id', poolIds)

      const averageHealthScore = healthScores && healthScores.length > 0
        ? Math.round(healthScores.reduce((sum, h) => sum + h.health_score, 0) / healthScores.length)
        : 100

      // Map pools with their analytics
      const poolsAnalytics = userPools.map((pool) => {
        const poolHealth = healthScores?.find((h) => h.pool_id === pool.id)
        const poolActs = activities.filter((a) => a.pool_id === pool.id)
        const poolDeps = poolActs.filter((a) => a.activity_type.toLowerCase() === 'deposit').reduce((sum, a) => sum + (a.amount || 0), 0)
        const poolWits = poolActs.filter((a) => a.activity_type.toLowerCase() === 'withdraw' || a.activity_type.toLowerCase() === 'payout').reduce((sum, a) => sum + (a.amount || 0), 0)
        
        return {
          id: pool.id,
          name: pool.name,
          type: pool.type,
          status: pool.status,
          balance: poolDeps - poolWits,
          healthScore: poolHealth?.health_score ?? 100,
          riskIndicator: poolHealth?.risk_indicator ?? 'Low',
        }
      })

      // Aggregate user global historical chart data
      const globalChartData = aggregateHistoricalData(
        activities.filter((a) => a.user_address?.toLowerCase() === lower)
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
    const { data: allPools } = await supabase.from('pools').select('*')
    const { data: allActivities } = await supabase
      .from('pool_activity')
      .select('*')
      .order('created_at', { ascending: true })

    const pools = allPools || []
    const activities = allActivities || []

    const totalDeposits = activities
      .filter((a) => a.activity_type.toLowerCase() === 'deposit')
      .reduce((sum, a) => sum + (a.amount || 0), 0)

    const totalWithdrawals = activities
      .filter((a) => a.activity_type.toLowerCase() === 'withdraw' || a.activity_type.toLowerCase() === 'payout')
      .reduce((sum, a) => sum + (a.amount || 0), 0)

    const globalChartData = aggregateHistoricalData(activities)

    return NextResponse.json({
      totalPools: pools.length,
      totalDeposits,
      totalWithdrawals,
      activePools: pools.filter((p) => p.status === 'active').length,
      globalChartData,
    })
  } catch (error) {
    console.error('Analytics fetch error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
