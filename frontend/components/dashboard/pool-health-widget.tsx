"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Minus, ArrowRight, Activity } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  getCachedPoolHealth,
  type PoolHealthScore,
  type HealthGrade,
  type HealthTrend,
  type PoolHealthInput,
} from "@/lib/pool-health"
import type { Pool } from "@/components/dashboard/pool-card"

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_VISIBLE_POOLS = 5

// ── Grade styles ──────────────────────────────────────────────────────────────

const GRADE_STYLES: Record<
  HealthGrade,
  { ring: string; text: string; bg: string; badge: string }
> = {
  A: {
    ring: "#22c55e",
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  B: {
    ring: "#84cc16",
    text: "text-lime-600 dark:text-lime-400",
    bg: "bg-lime-500/10",
    badge: "bg-lime-500/10 text-lime-700 dark:text-lime-400 border-lime-500/20",
  },
  C: {
    ring: "#f59e0b",
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
  D: {
    ring: "#f97316",
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    badge: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  },
  F: {
    ring: "#ef4444",
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/10",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  },
}

// ── Trend icon helper ─────────────────────────────────────────────────────────

function TrendIcon({ trend }: { trend: HealthTrend }) {
  if (trend === "improving")
    return <TrendingUp className="h-4 w-4 text-emerald-500" aria-label="Improving" />
  if (trend === "declining")
    return <TrendingDown className="h-4 w-4 text-rose-500" aria-label="Declining" />
  return <Minus className="h-4 w-4 text-muted-foreground" aria-label="Stable" />
}

// ── SVG circular progress ring ────────────────────────────────────────────────

function CircularRing({
  score,
  grade,
  size = 72,
}: {
  score: number
  grade: HealthGrade
  size?: number
}) {
  const stroke = 6
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = GRADE_STYLES[grade].ring

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`Health score ${score} out of 100`}
    >
      {/* track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-muted/40"
      />
      {/* progress */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      {/* score label */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.22}
        fontWeight="700"
        fill={color}
      >
        {score}
      </text>
    </svg>
  )
}

// ── Individual pool health card ───────────────────────────────────────────────

function PoolHealthCard({
  pool,
  health,
}: {
  pool: Pool
  health: PoolHealthScore
}) {
  const styles = GRADE_STYLES[health.grade]
  const topSuggestion = health.suggestions[0] ?? null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="min-w-[200px] max-w-[220px] shrink-0 snap-start"
    >
      <Card className="p-4 h-full flex flex-col gap-3 hover:shadow-md transition-shadow">
        {/* header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p
              className="font-semibold text-sm leading-tight truncate"
              title={pool.name}
            >
              {pool.name}
            </p>
            <Badge
              variant="secondary"
              className="mt-1 text-xs capitalize"
            >
              {pool.type}
            </Badge>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold shrink-0",
              styles.badge
            )}
          >
            {health.grade}
          </span>
        </div>

        {/* ring + trend */}
        <div className="flex items-center justify-between">
          <CircularRing score={health.score} grade={health.grade} size={72} />
          <div className="flex flex-col items-end gap-1">
            <TrendIcon trend={health.trend} />
            <span className="text-xs text-muted-foreground capitalize">{health.trend}</span>
          </div>
        </div>

        {/* top suggestion */}
        {topSuggestion && (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
            {topSuggestion}
          </p>
        )}

        {/* view details */}
        <Link
          href={`/dashboard/group/${pool.id}`}
          className="mt-auto text-xs text-primary hover:underline flex items-center gap-1"
          aria-label={`View details for ${pool.name}`}
        >
          View Details <ArrowRight className="h-3 w-3" />
        </Link>
      </Card>
    </motion.div>
  )
}

// ── Overall health summary card ───────────────────────────────────────────────

function OverallHealthCard({ averageScore }: { averageScore: number }) {
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
    <div className="min-w-[180px] max-w-[200px] shrink-0 snap-start">
      <Card
        className={cn("p-4 h-full flex flex-col items-center gap-3 justify-center", styles.bg)}
      >
        <Activity className="h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-xs font-medium text-muted-foreground">Overall Health</p>
        <CircularRing score={averageScore} grade={grade} size={80} />
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            styles.badge
          )}
        >
          Grade {grade}
        </span>
      </Card>
    </div>
  )
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function HealthCardSkeleton() {
  return (
    <div className="min-w-[200px] max-w-[220px] shrink-0">
      <Card className="p-4 h-full flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-5 w-8 rounded-full" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-[72px] w-[72px] rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </Card>
    </div>
  )
}

// ── Helper: derive PoolHealthInput from a Pool ─────────────────────────────────

function poolToHealthInput(pool: Pool): PoolHealthInput {
  const now = Date.now()

  // TVL now vs 7 days ago — we only have total_saved; assume flat 7d history
  // unless the pool object exposes history. Treat progress as a proxy for trend.
  const tvlNow = pool.total_saved ?? 0
  // Approximate 7-day-ago TVL: no historical data available from pool list API,
  // so we make a conservative assumption of same value (neutral trend).
  const tvl7dAgo = tvlNow

  // depositedThisRound: use progress as share of members who paid this round
  const depositedThisRound = Math.round(((pool.progress ?? 0) / 100) * pool.members_count)

  // deadlineMs: not available from pool list, so pass null
  const deadlineMs: number | null = null

  return {
    membersCount: pool.members_count,
    depositedThisRound,
    tvlNow,
    tvl7dAgo,
    deadlineMs,
    disputeCount: 0,
    lastActivityMs: now - 1 * 24 * 60 * 60 * 1000, // assume activity within last day
    activeMembers30d: pool.members_count, // assume all active (conservative default)
  }
}

// ── Main widget ───────────────────────────────────────────────────────────────

export interface PoolHealthWidgetProps {
  pools: Pool[]
  isLoading?: boolean
}

export function PoolHealthWidget({ pools, isLoading = false }: PoolHealthWidgetProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showAll, setShowAll] = useState(false)

  const healthScores = useMemo(() => {
    return pools.map((pool) => ({
      pool,
      health: getCachedPoolHealth(pool.id, poolToHealthInput(pool)),
    }))
  }, [pools])

  // Sort by score ascending so worst pools appear first (most attention needed)
  const sorted = useMemo(
    () => [...healthScores].sort((a, b) => a.health.score - b.health.score),
    [healthScores]
  )

  const visible = showAll ? sorted : sorted.slice(0, MAX_VISIBLE_POOLS)

  const averageScore = useMemo(() => {
    if (healthScores.length === 0) return 0
    return Math.round(
      healthScores.reduce((sum, { health }) => sum + health.score, 0) / healthScores.length
    )
  }, [healthScores])

  // Don't render when there are no pools at all
  if (!isLoading && pools.length === 0) return null

  return (
    <section aria-labelledby="pool-health-heading" className="space-y-3">
      {/* heading */}
      <div className="flex items-center justify-between">
        <h3
          id="pool-health-heading"
          className="text-lg font-semibold flex items-center gap-2"
        >
          <Activity className="h-5 w-5 text-primary" aria-hidden />
          Pool Health
        </h3>
        {!isLoading && pools.length > MAX_VISIBLE_POOLS && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show Less" : `View All (${pools.length})`}
          </Button>
        )}
      </div>

      {/* horizontally scrollable row */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth
                   [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label="Pool health cards"
      >
        {isLoading ? (
          // Skeleton cards while loading
          Array.from({ length: 4 }).map((_, i) => <HealthCardSkeleton key={i} />)
        ) : (
          <>
            {/* Overall summary always first */}
            <OverallHealthCard averageScore={averageScore} />

            {visible.map(({ pool, health }) => (
              <div key={pool.id} role="listitem">
                <PoolHealthCard pool={pool} health={health} />
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  )
}
