/**
 * Security monitoring rules for pool contracts.
 *
 * Each rule defines a detection condition, severity, and description.
 * The engine evaluates rules against recent activity data to produce alerts.
 */

export type AlertSeverity = "info" | "warning" | "critical"

export type RuleId =
  | "rapid_emergency_withdraw"
  | "unusual_deposit_spike"
  | "admin_key_rotation"
  | "mass_member_removal"
  | "pool_pause_cascade"
  | "dormant_pool_activation"
  | "failed_transaction_storm"
  | "reputation_manipulation"

export interface SecurityRule {
  id: RuleId
  name: string
  severity: AlertSeverity
  description: string
}

export interface SecurityAlert {
  id: string
  rule_id: RuleId
  severity: AlertSeverity
  description: string
  affected_pools: string[]
  affected_wallets: string[]
  status: "new" | "investigating" | "resolved" | "false_positive"
  resolved_by: string | null
  resolution_notes: string | null
  created_at: string
  resolved_at: string | null
}

export interface ActivityRecord {
  id: string
  pool_id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  description: string | null
  created_at: string
}

export interface PoolRecord {
  id: string
  name: string
  status: "active" | "completed" | "paused"
  creator_address: string
  created_at: string
  updated_at: string
  members_count: number
}

export interface MemberRecord {
  id: string
  pool_id: string
  member_address: string
  status: string
}

export interface AdminActionRecord {
  id: string
  pool_id: string
  admin_address: string
  action_type: string
  target_address: string | null
  created_at: string
}

export interface RuleContext {
  activities: ActivityRecord[]
  pools: PoolRecord[]
  members: MemberRecord[]
  adminActions: AdminActionRecord[]
  now: Date
}

// ── Rule Definitions ───────────────────────────────────────────────────────

export const SECURITY_RULES: SecurityRule[] = [
  {
    id: "rapid_emergency_withdraw",
    name: "Rapid Emergency Withdraw",
    severity: "critical",
    description: "3+ emergency withdrawals within 1 hour",
  },
  {
    id: "unusual_deposit_spike",
    name: "Unusual Deposit Spike",
    severity: "warning",
    description: "Single deposit > 10x average deposit amount",
  },
  {
    id: "admin_key_rotation",
    name: "Admin Key Rotation",
    severity: "info",
    description: "Admin address changed for a pool",
  },
  {
    id: "mass_member_removal",
    name: "Mass Member Removal",
    severity: "critical",
    description: "Admin removes > 50% of members within 24 hours",
  },
  {
    id: "pool_pause_cascade",
    name: "Pool Pause Cascade",
    severity: "warning",
    description: "> 5 pools paused within 1 hour",
  },
  {
    id: "dormant_pool_activation",
    name: "Dormant Pool Activation",
    severity: "info",
    description: "Pool inactive 90+ days receives large deposit",
  },
  {
    id: "failed_transaction_storm",
    name: "Failed Transaction Storm",
    severity: "warning",
    description: "> 10 failed transactions from same wallet in 5 minutes",
  },
  {
    id: "reputation_manipulation",
    name: "Reputation Manipulation",
    severity: "warning",
    description: "Same wallet creating pools with identical members repeatedly",
  },
]

// ── Thresholds ─────────────────────────────────────────────────────────────

const RAPID_EMERGENCY_WITHDRAW_THRESHOLD = 3
const RAPID_EMERGENCY_WITHDRAW_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const DEPOSIT_SPIKE_MULTIPLIER = 10
const MASS_MEMBER_REMOVAL_THRESHOLD = 0.5
const MASS_MEMBER_REMOVAL_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const POOL_PAUSE_CASCADE_THRESHOLD = 5
const POOL_PAUSE_CASCADE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const DORMANT_POOL_DAYS = 90
const FAILED_TX_STORM_THRESHOLD = 10
const FAILED_TX_STORM_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const REPUTATION_MANIPULATION_THRESHOLD = 3

// ── Rule Implementations ───────────────────────────────────────────────────

function detectRapidEmergencyWithdraw(ctx: RuleContext): SecurityAlert | null {
  const emergencyWithdraws = ctx.activities.filter(
    (a) =>
      a.activity_type === "emergency_withdraw" ||
      a.activity_type === "emergency_withdrawal"
  )

  const now = ctx.now.getTime()
  const recent = emergencyWithdraws.filter(
    (a) => now - new Date(a.created_at).getTime() < RAPID_EMERGENCY_WITHDRAW_WINDOW_MS
  )

  if (recent.length < RAPID_EMERGENCY_WITHDRAW_THRESHOLD) return null

  const poolIds = [...new Set(recent.map((a) => a.pool_id))]
  const wallets = recent
    .map((a) => a.user_address)
    .filter((w): w is string => w !== null)

  return {
    id: "",
    rule_id: "rapid_emergency_withdraw",
    severity: "critical",
    description: `${recent.length} emergency withdrawals detected within 1 hour across ${poolIds.length} pool(s)`,
    affected_pools: poolIds,
    affected_wallets: [...new Set(wallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

function detectUnusualDepositSpike(ctx: RuleContext): SecurityAlert | null {
  const deposits = ctx.activities.filter(
    (a) => a.activity_type === "deposit" && a.amount !== null && a.amount > 0
  )

  if (deposits.length < 5) return null

  const avgDeposit =
    deposits.reduce((sum, a) => sum + (a.amount ?? 0), 0) / deposits.length

  const spikes = deposits.filter((a) => (a.amount ?? 0) > avgDeposit * DEPOSIT_SPIKE_MULTIPLIER)

  if (spikes.length === 0) return null

  const poolIds = [...new Set(spikes.map((a) => a.pool_id))]
  const wallets = spikes
    .map((a) => a.user_address)
    .filter((w): w is string => w !== null)

  return {
    id: "",
    rule_id: "unusual_deposit_spike",
    severity: "warning",
    description: `${spikes.length} deposit(s) exceeded 10x the average (${avgDeposit.toFixed(2)})`,
    affected_pools: poolIds,
    affected_wallets: [...new Set(wallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

function detectAdminKeyRotation(ctx: RuleContext): SecurityAlert | null {
  const rotations = ctx.adminActions.filter(
    (a) => a.action_type === "admin_key_rotation" || a.action_type === "transfer_admin"
  )

  if (rotations.length === 0) return null

  const poolIds = [...new Set(rotations.map((a) => a.pool_id))]
  const wallets = rotations
    .map((a) => a.admin_address)
    .filter((w): w is string => w !== null)

  return {
    id: "",
    rule_id: "admin_key_rotation",
    severity: "info",
    description: `${rotations.length} admin key rotation(s) detected across ${poolIds.length} pool(s)`,
    affected_pools: poolIds,
    affected_wallets: [...new Set(wallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

function detectMassMemberRemoval(ctx: RuleContext): SecurityAlert | null {
  const removals = ctx.adminActions.filter(
    (a) => a.action_type === "remove_member" || a.action_type === "kick_member"
  )

  if (removals.length === 0) return null

  const now = ctx.now.getTime()
  const recent = removals.filter(
    (a) => now - new Date(a.created_at).getTime() < MASS_MEMBER_REMOVAL_WINDOW_MS
  )

  if (recent.length === 0) return null

  // Group removals by pool and check if > 50% of members were removed
  const removalsByPool = new Map<string, AdminActionRecord[]>()
  for (const removal of recent) {
    const existing = removalsByPool.get(removal.pool_id) ?? []
    existing.push(removal)
    removalsByPool.set(removal.pool_id, existing)
  }

  const affectedPools: string[] = []
  const affectedWallets: string[] = []

  for (const [poolId, poolRemovals] of removalsByPool) {
    const pool = ctx.pools.find((p) => p.id === poolId)
    if (!pool) continue

    const poolMembers = ctx.members.filter((m) => m.pool_id === poolId)
    const removalRatio = poolRemovals.length / Math.max(1, poolMembers.length)

    if (removalRatio > MASS_MEMBER_REMOVAL_THRESHOLD) {
      affectedPools.push(poolId)
      poolRemovals.forEach((r) => {
        if (r.target_address) affectedWallets.push(r.target_address)
        affectedWallets.push(r.admin_address)
      })
    }
  }

  if (affectedPools.length === 0) return null

  return {
    id: "",
    rule_id: "mass_member_removal",
    severity: "critical",
    description: `${recent.length} member removal(s) in ${affectedPools.length} pool(s) within 24 hours (>50% of members)`,
    affected_pools: affectedPools,
    affected_wallets: [...new Set(affectedWallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

function detectPoolPauseCascade(ctx: RuleContext): SecurityAlert | null {
  const pauses = ctx.adminActions.filter(
    (a) => a.action_type === "pause_pool" || a.action_type === "pause"
  )

  if (pauses.length === 0) return null

  const now = ctx.now.getTime()
  const recent = pauses.filter(
    (a) => now - new Date(a.created_at).getTime() < POOL_PAUSE_CASCADE_WINDOW_MS
  )

  if (recent.length < POOL_PAUSE_CASCADE_THRESHOLD) return null

  const poolIds = [...new Set(recent.map((a) => a.pool_id))]
  const wallets = recent.map((a) => a.admin_address)

  return {
    id: "",
    rule_id: "pool_pause_cascade",
    severity: "warning",
    description: `${recent.length} pools paused within 1 hour across ${poolIds.length} unique pool(s)`,
    affected_pools: poolIds,
    affected_wallets: [...new Set(wallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

function detectDormantPoolActivation(ctx: RuleContext): SecurityAlert | null {
  const now = ctx.now.getTime()
  const dormantThreshold = now - DORMANT_POOL_DAYS * 24 * 60 * 60 * 1000

  const dormantPools = ctx.pools.filter(
    (p) =>
      new Date(p.updated_at).getTime() < dormantThreshold && p.status === "active"
  )

  if (dormantPools.length === 0) return null

  const deposits = ctx.activities.filter(
    (a) =>
      a.activity_type === "deposit" &&
      a.amount !== null &&
      dormantPools.some((p) => p.id === a.pool_id)
  )

  if (deposits.length === 0) return null

  const poolIds = [...new Set(deposits.map((a) => a.pool_id))]
  const wallets = deposits
    .map((a) => a.user_address)
    .filter((w): w is string => w !== null)

  return {
    id: "",
    rule_id: "dormant_pool_activation",
    severity: "info",
    description: `${poolIds.length} dormant pool(s) (>90 days inactive) received new deposits`,
    affected_pools: poolIds,
    affected_wallets: [...new Set(wallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

function detectFailedTransactionStorm(ctx: RuleContext): SecurityAlert | null {
  const failedTxs = ctx.activities.filter(
    (a) =>
      a.activity_type === "failed_transaction" ||
      a.activity_type === "tx_failed" ||
      a.description?.toLowerCase().includes("failed")
  )

  if (failedTxs.length === 0) return null

  const now = ctx.now.getTime()

  // Group by wallet and check for storms
  const byWallet = new Map<string, ActivityRecord[]>()
  for (const tx of failedTxs) {
    if (!tx.user_address) continue
    const existing = byWallet.get(tx.user_address) ?? []
    existing.push(tx)
    byWallet.set(tx.user_address, existing)
  }

  const affectedWallets: string[] = []
  const affectedPoolIds: string[] = []

  for (const [wallet, txs] of byWallet) {
    const recent = txs.filter(
      (t) => now - new Date(t.created_at).getTime() < FAILED_TX_STORM_WINDOW_MS
    )
    if (recent.length > FAILED_TX_STORM_THRESHOLD) {
      affectedWallets.push(wallet)
      recent.forEach((t) => affectedPoolIds.push(t.pool_id))
    }
  }

  if (affectedWallets.length === 0) return null

  return {
    id: "",
    rule_id: "failed_transaction_storm",
    severity: "warning",
    description: `${affectedWallets.length} wallet(s) exceeded ${FAILED_TX_STORM_THRESHOLD} failed transactions in 5 minutes`,
    affected_pools: [...new Set(affectedPoolIds)],
    affected_wallets: [...new Set(affectedWallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

function detectReputationManipulation(ctx: RuleContext): SecurityAlert | null {
  // Find wallets that created multiple pools
  const creators = new Map<string, string[]>()
  for (const pool of ctx.pools) {
    const existing = creators.get(pool.creator_address) ?? []
    existing.push(pool.id)
    creators.set(pool.creator_address, existing)
  }

  const suspiciousWallets: string[] = []
  const suspiciousPoolIds: string[] = []

  for (const [creator, poolIds] of creators) {
    if (poolIds.length < REPUTATION_MANIPULATION_THRESHOLD) continue

    // Check if these pools share common members
    const poolMembersList = poolIds.map((pid) =>
      ctx.members
        .filter((m) => m.pool_id === pid)
        .map((m) => m.member_address)
        .sort()
    )

    // Find the intersection of members across pools
    if (poolMembersList.length < 2) continue
    let commonMembers = poolMembersList[0]
    for (let i = 1; i < poolMembersList.length; i++) {
      commonMembers = commonMembers.filter((m) => poolMembersList[i].includes(m))
    }

    if (commonMembers.length >= 2) {
      suspiciousWallets.push(creator)
      suspiciousPoolIds.push(...poolIds)
    }
  }

  if (suspiciousWallets.length === 0) return null

  return {
    id: "",
    rule_id: "reputation_manipulation",
    severity: "warning",
    description: `${suspiciousWallets.length} wallet(s) created pools with repeated identical members`,
    affected_pools: [...new Set(suspiciousPoolIds)],
    affected_wallets: [...new Set(suspiciousWallets)],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: ctx.now.toISOString(),
    resolved_at: null,
  }
}

// ── Main Engine ────────────────────────────────────────────────────────────

const RULE_DETECTORS: ((ctx: RuleContext) => SecurityAlert | null)[] = [
  detectRapidEmergencyWithdraw,
  detectUnusualDepositSpike,
  detectAdminKeyRotation,
  detectMassMemberRemoval,
  detectPoolPauseCascade,
  detectDormantPoolActivation,
  detectFailedTransactionStorm,
  detectReputationManipulation,
]

/**
 * Run all security rules against the provided context and return triggered alerts.
 */
export function runSecurityRules(ctx: RuleContext): SecurityAlert[] {
  const alerts: SecurityAlert[] = []

  for (const detector of RULE_DETECTORS) {
    const alert = detector(ctx)
    if (alert) {
      alerts.push(alert)
    }
  }

  // Sort by severity: critical first, then warning, then info
  const severityOrder: Record<AlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  }
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return alerts
}

/**
 * Get rule metadata by ID.
 */
export function getRuleById(ruleId: RuleId): SecurityRule | undefined {
  return SECURITY_RULES.find((r) => r.id === ruleId)
}
