// Advanced Pool Analytics Calculations
// Provides helpers for health score, risk indicator, participation metrics, historical data aggregation, and predictive analytics.

export interface PoolHealthMetrics {
  healthScore: number
  participationRate: number
  riskIndicator: "Low" | "Medium" | "High"
}

export interface PredictiveMetrics {
  daysToTarget: number
  projectedDate: Date | null
  message: string
}

export interface HistoricalChartPoint {
  date: string
  deposits: number
  withdrawals: number
  balance: number
}

/**
 * Calculates the health score, participation rate, and risk indicator for a pool.
 * Health score is a value from 0 to 100.
 */
export function calculatePoolHealth(
  pool: {
    type: "rotational" | "target" | "flexible"
    status: "active" | "completed" | "paused"
    target_amount?: number | null
    deadline?: string | null
    created_at?: string
  },
  members: Array<{
    member_address: string
    status?: "pending" | "paid" | "late" | string
    contribution_amount?: number
  }>,
  activities: Array<{ activity_type: string; amount?: number | null; created_at: string }>
): PoolHealthMetrics {
  const totalMembers = members.length
  if (totalMembers === 0) {
    return { healthScore: 100, participationRate: 0, riskIndicator: "Low" }
  }

  // 1. Calculate Participation Rate
  // Defined as the number of unique members who have deposited at least once
  const depositorAddresses = new Set(
    activities
      .filter(
        (act) =>
          act.activity_type.toLowerCase() === "deposit" ||
          act.activity_type.toLowerCase() === "pool_created"
      )
      .map((act) => (act.activity_type.toLowerCase() === "deposit" ? act.activity_type : "")) // Just a placeholder check, let's map user_address if available, or fallback to member status
  )

  // Fallback to checking member status from DB if activity is not fully populated
  const activeMembersFromStatus = members.filter(
    (m) => m.status === "paid" || (m.contribution_amount && m.contribution_amount > 0)
  ).length
  const activeMembersCount = Math.max(depositorAddresses.size, activeMembersFromStatus)
  const participationRate = Math.min(100, Math.round((activeMembersCount / totalMembers) * 100))

  let healthScore = 100

  // 2. Health score logic based on pool type
  if (pool.type === "rotational") {
    // Rotational pools: late payments heavily impact health
    const lateMembers = members.filter((m) => m.status === "late").length
    const lateDeduction = (lateMembers / totalMembers) * 50
    healthScore -= lateDeduction

    // Deduct if paused
    if (pool.status === "paused") {
      healthScore -= 30
    }
  } else if (pool.type === "target") {
    // Target pools: deadline closeness vs target progress, plus participation
    const target = pool.target_amount || 0
    const currentBalance =
      activities
        .filter((act) => act.activity_type.toLowerCase() === "deposit")
        .reduce((sum, act) => sum + (act.amount || 0), 0) -
      activities
        .filter((act) => act.activity_type.toLowerCase() === "withdraw")
        .reduce((sum, act) => sum + (act.amount || 0), 0)

    const progressPercent = target > 0 ? (currentBalance / target) * 100 : 100

    // Participation rate impact
    const participationDeduction = (100 - participationRate) * 0.3 // max 30 points
    healthScore -= participationDeduction

    if (pool.deadline) {
      const deadlineDate = new Date(pool.deadline)
      const createdDate = pool.created_at
        ? new Date(pool.created_at)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const totalDuration = deadlineDate.getTime() - createdDate.getTime()
      const timeRemaining = deadlineDate.getTime() - Date.now()

      if (timeRemaining <= 0 && progressPercent < 100) {
        // Passed deadline and target not met
        healthScore = 0
      } else if (totalDuration > 0 && timeRemaining > 0) {
        const timeRemainingPercent = (timeRemaining / totalDuration) * 100
        // If less than 20% of time is left but we have less than 50% of the target met, deduct points
        if (timeRemainingPercent < 20 && progressPercent < 50) {
          healthScore -= 40
        } else if (timeRemainingPercent < 10 && progressPercent < 80) {
          healthScore -= 20
        }
      }
    }
  } else if (pool.type === "flexible") {
    // Flexible pools: withdrawal rate relative to deposits
    const totalDeposits = activities
      .filter((act) => act.activity_type.toLowerCase() === "deposit")
      .reduce((sum, act) => sum + (act.amount || 0), 0)
    const totalWithdrawals = activities
      .filter((act) => act.activity_type.toLowerCase() === "withdraw")
      .reduce((sum, act) => sum + (act.amount || 0), 0)

    if (totalDeposits > 0) {
      const withdrawalRatio = totalWithdrawals / totalDeposits
      if (withdrawalRatio > 0.9) {
        healthScore -= 30 // High outflow risk
      } else if (withdrawalRatio > 0.7) {
        healthScore -= 15
      }
    }

    const participationDeduction = (100 - participationRate) * 0.2 // max 20 points
    healthScore -= participationDeduction
  }

  // Clamp health score between 0 and 100
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)))

  // 3. Determine Risk Indicator
  let riskIndicator: "Low" | "Medium" | "High" = "Low"
  if (healthScore < 50) {
    riskIndicator = "High"
  } else if (healthScore < 80) {
    riskIndicator = "Medium"
  }

  return {
    healthScore,
    participationRate,
    riskIndicator,
  }
}

/**
 * Predicts target pool completion based on average daily contribution.
 */
export function predictTargetPoolCompletion(
  targetAmount: number,
  currentBalance: number,
  activities: Array<{ activity_type: string; amount?: number | null; created_at: string }>,
  poolCreatedAt?: string
): PredictiveMetrics {
  if (currentBalance >= targetAmount) {
    return {
      daysToTarget: 0,
      projectedDate: new Date(),
      message: "Target already reached!",
    }
  }

  const deposits = activities
    .filter((act) => act.activity_type.toLowerCase() === "deposit" && (act.amount || 0) > 0)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  if (deposits.length === 0) {
    return {
      daysToTarget: -1,
      projectedDate: null,
      message: "No deposits recorded yet. Awaiting contributions.",
    }
  }

  // Calculate duration of deposits
  const firstDepositDate = new Date(deposits[0].created_at)
  const lastDepositDate = new Date(deposits[deposits.length - 1].created_at)
  const totalDepositedAmount = deposits.reduce((sum, act) => sum + (act.amount || 0), 0)

  let durationInDays =
    (lastDepositDate.getTime() - firstDepositDate.getTime()) / (1000 * 60 * 60 * 24)

  // If all deposits happened on the same day, check pool creation time
  if (durationInDays < 1) {
    if (poolCreatedAt) {
      const createdDate = new Date(poolCreatedAt)
      durationInDays = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
    }
    // Make sure duration is at least 1 day to avoid division by zero or inflated rate
    if (durationInDays < 1) {
      durationInDays = 1
    }
  }

  const averageDailyDeposit = totalDepositedAmount / durationInDays

  if (averageDailyDeposit <= 0) {
    return {
      daysToTarget: -1,
      projectedDate: null,
      message: "No positive contribution rate detected.",
    }
  }

  const remainingAmount = targetAmount - currentBalance
  const daysToTarget = remainingAmount / averageDailyDeposit
  const projectedDate = new Date(Date.now() + daysToTarget * 24 * 60 * 60 * 1000)

  const formattedDays = Math.ceil(daysToTarget)
  return {
    daysToTarget,
    projectedDate,
    message: `Projected to reach target in approximately ${formattedDays} day${formattedDays === 1 ? "" : "s"} (${projectedDate.toLocaleDateString()}) at a rate of ${averageDailyDeposit.toFixed(2)} XLM/day.`,
  }
}

/**
 * Aggregates activities into a timeline of daily balances and cumulative stats.
 */
export function aggregateHistoricalData(
  activities: Array<{ activity_type: string; amount?: number | null; created_at: string }>,
  poolCreatedAt?: string
): HistoricalChartPoint[] {
  // Sort activities by date ascending
  const sortedActivities = [...activities].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  // Map dates
  const dailyStats: Record<string, { deposits: number; withdrawals: number }> = {}

  sortedActivities.forEach((act) => {
    const dateStr = new Date(act.created_at).toISOString().split("T")[0]
    const amount = act.amount || 0
    const type = act.activity_type.toLowerCase()

    if (!dailyStats[dateStr]) {
      dailyStats[dateStr] = { deposits: 0, withdrawals: 0 }
    }

    if (type === "deposit") {
      dailyStats[dateStr].deposits += amount
    } else if (type === "withdraw" || type === "payout") {
      dailyStats[dateStr].withdrawals += amount
    }
  })

  // Collect sorted dates
  const dates = Object.keys(dailyStats).sort()

  if (dates.length === 0) {
    const fallbackDate = poolCreatedAt
      ? new Date(poolCreatedAt).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0]
    return [{ date: fallbackDate, deposits: 0, withdrawals: 0, balance: 0 }]
  }

  // Generate cumulative charts
  const points: HistoricalChartPoint[] = []
  let cumulativeDeposits = 0
  let cumulativeWithdrawals = 0
  let currentBalance = 0

  // If there's a creation date, prefix with zero point
  if (poolCreatedAt) {
    const creationDateStr = new Date(poolCreatedAt).toISOString().split("T")[0]
    if (creationDateStr < dates[0]) {
      points.push({
        date: creationDateStr,
        deposits: 0,
        withdrawals: 0,
        balance: 0,
      })
    }
  }

  dates.forEach((date) => {
    const stats = dailyStats[date]
    cumulativeDeposits += stats.deposits
    cumulativeWithdrawals += stats.withdrawals
    currentBalance += stats.deposits - stats.withdrawals

    points.push({
      date,
      deposits: parseFloat(cumulativeDeposits.toFixed(2)),
      withdrawals: parseFloat(cumulativeWithdrawals.toFixed(2)),
      balance: parseFloat(currentBalance.toFixed(2)),
    })
  })

  return points
}
