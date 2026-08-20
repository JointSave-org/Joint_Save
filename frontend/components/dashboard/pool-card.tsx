"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, TrendingUp, Calendar, ArrowRight, AlertTriangle, Shield } from "lucide-react"
import Link from "next/link"
import { motion } from "framer-motion"
import { useState, useEffect } from "react"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import {
  formatTokenAmount,
  RotationalPoolState,
  TargetPoolState,
  FlexiblePoolState,
  fetchMembersReputationData,
} from "@/hooks/useJointSaveContracts"
import { getTierFromScore, TIER_DISPLAY } from "@/hooks/useMemberReputation"
import { usePoolHealth } from "@/hooks/usePoolHealth"
import { PoolHealthBadge } from "@/components/dashboard/pool-health-badge"
import { PoolSparkline } from "@/components/dashboard/pool-sparkline"
import { isContractVersionUnknown } from "@/lib/contract-version"
import { KNOWN_CONTRACT_VERSIONS } from "@/lib/constants"

export interface Pool {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: "active" | "completed" | "paused"
  members_count: number
  total_saved: number
  progress: number
  frequency?: string
  next_payout?: string
  contract_address: string
  target_amount: number | null
  contribution_amount: number | null
  minimum_deposit: number | null
  token_symbol?: string | null
  token_decimals?: number | null
}

const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }

// ── Skeleton for a single pool card ──────────────────────────────────────────
export function PoolCardSkeleton() {
  return (
    <Card className="p-6 h-full flex flex-col" aria-hidden="true">
      {/* header row */}
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>

      {/* stat rows */}
      <div className="space-y-3 mb-4 flex-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      {/* progress bar */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-10" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>

      {/* button */}
      <Skeleton className="h-9 w-full rounded-md" />
    </Card>
  )
}

// ── Per-pool card that hydrates live balances from the unified cache ──────────
export function PoolCard({ pool }: { pool: Pool }) {
  const cacheKey =
    pool.contract_address && pool.contract_address !== "pending_deployment"
      ? pool.contract_address
      : pool.id
  const { data, isLoading } = usePoolData(cacheKey)
  const { health, isLoading: healthLoading } = usePoolHealth(cacheKey, pool.type)
  const tokenSymbol = pool.token_symbol ?? "XLM"
  const tokenDecimals = pool.token_decimals ?? 7
  const fmt = (v: bigint) => formatTokenAmount(v, tokenDecimals)

  // Average member reputation score
  const [avgScore, setAvgScore] = useState<number | null>(null)
  useEffect(() => {
    const members: string[] =
      pool.type === "rotational" && data?.onchain
        ? (data.onchain as RotationalPoolState).members
        : []
    if (members.length === 0) return
    let cancelled = false
    fetchMembersReputationData(members).then((reps) => {
      if (cancelled) return
      const scores = Object.values(reps).map((r) => r.totalScore)
      if (scores.length > 0) {
        setAvgScore(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
      }
    })
    return () => {
      cancelled = true
    }
  }, [pool.type, data?.onchain, pool.id])

  const getLiveStats = (): {
    totalSaved: number
    progress: number
    progressLabel: string
  } => {
    const onchain = data?.onchain ?? null
    if (pool.type === "rotational" && onchain) {
      const s = onchain as RotationalPoolState
      const totalMembers = s.members.length || pool.members_count || 1
      const progress = Math.min(100, Math.round((s.currentRound / totalMembers) * 100))
      const perRound = (pool.contribution_amount || 0) * totalMembers
      const totalSaved = s.currentRound * perRound
      return {
        totalSaved,
        progress,
        progressLabel: `Round ${s.currentRound + 1} of ${totalMembers}`,
      }
    }
    if (pool.type === "target" && onchain) {
      const s = onchain as TargetPoolState
      const saved = fmt(s.totalDeposited)
      const target = pool.target_amount || fmt(s.targetAmount) || 1
      const progress = Math.min(100, Math.round((saved / target) * 100))
      return {
        totalSaved: saved,
        progress,
        progressLabel: `${saved.toFixed(2)} / ${target.toFixed(2)} ${tokenSymbol}`,
      }
    }
    if (pool.type === "flexible" && onchain) {
      const s = onchain as FlexiblePoolState
      const totalSaved = fmt(s.totalBalance)
      const softGoal = (pool.minimum_deposit || 0) * (pool.members_count || 1)
      const progress =
        softGoal > 0
          ? Math.min(100, Math.round((totalSaved / softGoal) * 100))
          : s.isActive
            ? 50
            : 100
      return {
        totalSaved,
        progress,
        progressLabel:
          softGoal > 0
            ? `${totalSaved.toFixed(2)} / ${softGoal.toFixed(2)} ${tokenSymbol}`
            : `${totalSaved.toFixed(2)} ${tokenSymbol} saved`,
      }
    }
    return {
      totalSaved: pool.total_saved ?? 0,
      progress: pool.progress ?? 0,
      progressLabel: "",
    }
  }

  const { totalSaved, progress, progressLabel } = getLiveStats()
  const formatXlm = (n: number) => `${n.toFixed(2)} ${tokenSymbol}`

  const contractVersion =
    data?.onchain && "contractVersion" in data.onchain
      ? (data.onchain.contractVersion as number | null)
      : null
  const showVersionWarning =
    contractVersion !== null &&
    isContractVersionUnknown(contractVersion, KNOWN_CONTRACT_VERSIONS[pool.type])

  return (
    <motion.div variants={item}>
      <Card className="p-6 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <h3 className="text-xl font-semibold mb-1">{pool.name}</h3>
            <Badge variant="secondary">
              {pool.type.charAt(0).toUpperCase() + pool.type.slice(1)}
            </Badge>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <Badge className="bg-primary/10 text-primary hover:bg-primary/20">{pool.status}</Badge>
            <PoolHealthBadge health={health} isLoading={healthLoading} />
          </div>
        </div>
        <div className="space-y-3 mb-4 flex-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Members
            </span>
            <span className="font-medium">{pool.members_count}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Total Saved
            </span>
            <span className="font-medium flex items-center gap-2">
              {isLoading && !data?.onchain ? (
                <Skeleton className="h-4 w-16 inline-block" />
              ) : (
                formatXlm(totalSaved)
              )}
              <PoolSparkline poolId={pool.id} />
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {pool.type === "rotational" ? "Frequency" : "Status"}
            </span>
            <span className="font-medium">{pool.frequency || pool.status}</span>
          </div>
          {avgScore !== null &&
            (() => {
              const tier = getTierFromScore(avgScore, avgScore === 500)
              const display = TIER_DISPLAY[tier]
              return (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Avg. Member Score
                  </span>
                  <span className={`font-medium flex items-center gap-1 ${display.textClass}`}>
                    <span
                      className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: display.dotColor }}
                    />
                    {avgScore}
                  </span>
                </div>
              )
            })()}
        </div>
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">{progress.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 1, delay: 0.5 }}
              className="h-full bg-primary"
            />
          </div>
          {progressLabel && <p className="text-xs text-muted-foreground mt-1">{progressLabel}</p>}
        </div>
        {showVersionWarning && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 mb-4 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Contract v{contractVersion} — This pool may run a newer version than expected.
            </span>
          </div>
        )}
        <Button className="w-full bg-transparent" variant="outline" asChild>
          <Link href={`/dashboard/group/${pool.id}`}>
            View Details <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </Card>
    </motion.div>
  )
}
