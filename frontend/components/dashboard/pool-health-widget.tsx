"use client"

import { useMemo, useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"
import { TrendingUp, TrendingDown, Minus, ArrowRight, Activity } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  calculatePoolHealth,
  type PoolHealthScore,
  type HealthGrade,
  type HealthTrend,
  type PoolMember,
  type PoolActivity,
} from "@/lib/pool-health"
import type { Pool } from "@/components/dashboard/pool-card"
import { HealthSuggestionList } from "@/components/dashboard/health-suggestion-list"

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 5

// ── Grade styling ──────────────────────────────────────────────────────────────

const GRADE_STYLES: Record<HealthGrade, { ring: string; text: string; bg: string; badge: string }> =
  {
    A: {
      ring: "stroke-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
      badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    },
    B: {
      ring: "stroke-sky-500",
      text: "text-sky-600 dark:text-sky-400",
      bg: "bg-sky-500/10",
      badge: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/20",
    },
    C: {
      ring: "stroke-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10",
      badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
    },
    D: {
      ring: "stroke-orange-500",
      text: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-500/10",
      badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20",
    },
    F: {
      ring: "stroke-rose-500",
      text: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-500/10",
      badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20",
    },
  }

// ── Trend icon ─────────────────────────────────────────────────────────────────

function TrendIcon({ trend }: { trend: HealthTrend }) {
  if (trend === "improving")
    return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-label="Improving" />
  if (trend === "declining")
    return <TrendingDown className="h-3.5 w-3.5 text-rose-500" aria-label="Declining" />
  return <Minus className="h-3.5 w-3.5 text-amber-500" aria-label="Stable" />
}

// ── Circular progress ring ─────────────────────────────────────────────────────

function CircularProgress({
  score,
  grade,
  size = 64,
}: {
  score: number
  grade: HealthGrade
  size?: number
}) {
  const radius = (size - 8) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const styles = GRADE_STYLES[grade]

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth={5}
        />
        {/* Progress */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={styles.ring}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      {/* Label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-xs font-bold leading-none", styles.text)}>{score}</span>
        <span className={cn("text-[10px] font-semibold leading-none mt-0.5", styles.text)}>
          {grade}
        </span>
      </div>
    </div>
  )
}

// ── Individual pool health card ────────────────────────────────────────────────

function PoolHealthCard({ pool, healthScore }: { pool: Pool; healthScore: PoolHealthScore }) {
  const styles = GRADE_STYLES[healthScore.grade]
  const topSuggestion = healthScore.suggestions[0]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="flex-shrink-0 w-52"
    >
      <Card
        className={cn(
          "p-4 h-full flex flex-col gap-3 border hover:shadow-md transition-shadow",
          styles.bg
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate" title={pool.name}>
              {pool.name}
            </p>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mt-1 capitalize">
              {pool.type}
            </Badge>
          </div>
          <CircularProgress score={healthScore.score} grade={healthScore.grade} size={52} />
        </div>

        {/* Trend */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TrendIcon trend={healthScore.trend} />
          <span className="capitalize">{healthScore.trend}</span>
        </div>

        {/* Top suggestion */}
        {topSuggestion && (
          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
            💡 {topSuggestion}
          </p>
        )}

        {/* CTA */}
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto px-0 text-xs justify-start h-auto py-0 text-primary hover:text-primary/80"
          asChild
        >
          <Link href={`/dashboard/group/${pool.id}`}>
            View Details <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </Card>
    </motion.div>
  )
}

// ── Summary "overall health" card ──────────────────────────────────────────────

function OverallHealthCard({
  averageScore,
  totalPools,
}: {
  averageScore: number
  totalPools: number
}) {
  const grade: HealthGrade =
    averageScore >= 90
      ? "A"
      : averageScore >= 70
        ? "B"
        : averageScore >= 50
          ? "C"
          : averageScore >= 30
            ? "D"
            : "F"
  const styles = GRADE_STYLES[grade]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex-shrink-0 w-52"
    >
      <Card className="p-4 h-full flex flex-col items-center justify-center gap-3 border-dashed">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Overall Health
        </p>
        <CircularProgress score={averageScore} grade={grade} size={64} />
        <p className="text-xs text-muted-foreground text-center">
          Across {totalPools} pool{totalPools !== 1 ? "s" : ""}
        </p>
        <Badge className={cn("text-xs border", styles.badge)}>Grade {grade}</Badge>
      </Card>
    </motion.div>
  )
}

// ── Skeleton loaders ───────────────────────────────────────────────────────────

function PoolHealthCardSkeleton() {
  return (
    <div className="flex-shrink-0 w-52">
      <Card className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3.5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-13 w-13 rounded-full" style={{ width: 52, height: 52 }} />
        </div>
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-24" />
      </Card>
    </div>
  )
}

// ── Main widget ────────────────────────────────────────────────────────────────

export interface PoolWithHealth {
  pool: Pool
  score: PoolHealthScore
}

interface PoolHealthWidgetProps {
  pools: Pool[]
  /** Pass true while the parent is fetching pool data. */
  loading?: boolean
}

/**
 * Horizontal-scrollable row of per-pool health cards with an overall summary
 * card.  Hidden when no pools are present.  Scores are computed client-side
 * using `calculatePoolHealth` with a 5-minute cache.
 *
 * For users with >20 pools only the top-5 (by score) are shown inline, with a
 * "View All" link below.
 */
export function PoolHealthWidget({ pools, loading = false }: PoolHealthWidgetProps) {
  const [memberMap, setMemberMap] = useState<Record<string, PoolMember[]>>({})
  const [activityMap, setActivityMap] = useState<Record<string, PoolActivity[]>>({})
  const [dataLoading, setDataLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  // Fetch lightweight member + activity data for health calculation.
  useEffect(() => {
    if (pools.length === 0) {
      setDataLoading(false)
      return
    }
    let cancelled = false

    async function fetchHealthData() {
      setDataLoading(true)
      const results = await Promise.allSettled(
        pools.map(async (pool) => {
          const [membersRes, activityRes] = await Promise.allSettled([
            fetch(`/api/pools/${pool.id}/members`).then((r) => (r.ok ? r.json() : [])),
            fetch(`/api/pools/${pool.id}/activity?page=1`).then((r) => (r.ok ? r.json() : [])),
          ])
          const members: PoolMember[] =
            membersRes.status === "fulfilled"
              ? Array.isArray(membersRes.value)
                ? membersRes.value
                : (membersRes.value?.data ?? [])
              : []
          const rawActivity =
            activityRes.status === "fulfilled"
              ? Array.isArray(activityRes.value)
                ? activityRes.value
                : (activityRes.value?.data ?? [])
              : []
          const activities: PoolActivity[] = rawActivity
          return { id: pool.id, members, activities }
        })
      )

      if (cancelled) return

      const newMemberMap: Record<string, PoolMember[]> = {}
      const newActivityMap: Record<string, PoolActivity[]> = {}

      for (const res of results) {
        if (res.status === "fulfilled") {
          newMemberMap[res.value.id] = res.value.members
          newActivityMap[res.value.id] = res.value.activities
        }
      }
      setMemberMap(newMemberMap)
      setActivityMap(newActivityMap)
      setDataLoading(false)
    }

    fetchHealthData()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools.map((p) => p.id).join(",")])

  // Compute health scores for all pools
  const poolsWithHealth: PoolWithHealth[] = useMemo(() => {
    if (dataLoading) return []
    return pools.map((pool) => ({
      pool,
      score: calculatePoolHealth(pool, memberMap[pool.id] ?? [], activityMap[pool.id] ?? []),
    }))
  }, [pools, memberMap, activityMap, dataLoading])

  // Sort by score descending; declining pools get a visual penalty to surface them
  const sortedPools = useMemo(() => {
    return [...poolsWithHealth].sort((a, b) => {
      // Declining pools have urgency — show them higher when scores are close
      if (a.score.trend === "declining" && b.score.trend !== "declining") return -1
      if (b.score.trend === "declining" && a.score.trend !== "declining") return 1
      return b.score.score - a.score.score
    })
  }, [poolsWithHealth])

  const averageScore = useMemo(() => {
    if (poolsWithHealth.length === 0) return 0
    return Math.round(
      poolsWithHealth.reduce((sum, { score }) => sum + score.score, 0) / poolsWithHealth.length
    )
  }, [poolsWithHealth])

  const hasMoreThanMax = pools.length > MAX_VISIBLE
  const visiblePools = showAll ? sortedPools : sortedPools.slice(0, MAX_VISIBLE)

  // Don't render widget when there are no pools
  if (!loading && pools.length === 0) return null

  const isLoading = loading || dataLoading

  return (
    <section aria-label="Pool Health Overview" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" aria-hidden />
          <h3 className="text-lg font-semibold">Pool Health</h3>
        </div>
        {hasMoreThanMax && !isLoading && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-3 text-muted-foreground"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show Top 5" : `View All (${pools.length})`}
          </Button>
        )}
      </div>

      {/* Scrollable card row */}
      <div
        className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-thin scrollbar-thumb-muted"
        role="list"
        aria-label="Health cards per pool"
      >
        {isLoading
          ? // Skeleton state
            Array.from({ length: Math.min(pools.length || 3, MAX_VISIBLE) }).map((_, i) => (
              <PoolHealthCardSkeleton key={i} />
            ))
          : // Loaded state
            [
              // Overall summary card first
              <OverallHealthCard
                key="overall"
                averageScore={averageScore}
                totalPools={pools.length}
              />,
              // Per-pool cards
              ...visiblePools.map(({ pool, score }) => (
                <div key={pool.id} role="listitem">
                  <PoolHealthCard pool={pool} healthScore={score} />
                </div>
              )),
            ]}
      </div>

      {/* Suggestion list — rendered below the scroll row when data is ready */}
      <AnimatePresence>
        {!isLoading && poolsWithHealth.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            <HealthSuggestionList poolsWithHealth={poolsWithHealth} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
