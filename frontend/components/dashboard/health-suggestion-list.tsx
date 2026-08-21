"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, ChevronUp, AlertTriangle, Info, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  getCachedPoolHealth,
  type PoolHealthScore,
  type PoolHealthInput,
} from "@/lib/pool-health"
import type { Pool } from "@/components/dashboard/pool-card"

// ── Types ─────────────────────────────────────────────────────────────────────

interface PoolSuggestionEntry {
  pool: Pool
  health: PoolHealthScore
}

// ── Urgency helpers ───────────────────────────────────────────────────────────

/** Returns a priority rank for sorting — lower number = higher urgency. */
function urgencyRank(entry: PoolSuggestionEntry): number {
  if (entry.health.trend === "declining") return 0
  if (entry.health.grade === "F" || entry.health.grade === "D") return 1
  if (entry.health.grade === "C") return 2
  return 3
}

function SuggestionIcon({ grade }: { grade: PoolHealthScore["grade"] }) {
  if (grade === "A" || grade === "B") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden />
  }
  if (grade === "C") {
    return <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" aria-hidden />
  }
  return <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" aria-hidden />
}

// ── Helper: same poolToHealthInput as in the widget ───────────────────────────
// Duplicated here to keep each component self-contained.

function poolToHealthInput(pool: Pool): PoolHealthInput {
  const now = Date.now()
  const tvlNow = pool.total_saved ?? 0
  const tvl7dAgo = tvlNow
  const depositedThisRound = Math.round(((pool.progress ?? 0) / 100) * pool.members_count)

  return {
    membersCount: pool.members_count,
    depositedThisRound,
    tvlNow,
    tvl7dAgo,
    deadlineMs: null,
    disputeCount: 0,
    lastActivityMs: now - 1 * 24 * 60 * 60 * 1000,
    activeMembers30d: pool.members_count,
  }
}

// ── Single suggestion row ─────────────────────────────────────────────────────

function SuggestionRow({
  pool,
  suggestion,
  grade,
}: {
  pool: Pool
  suggestion: string
  grade: PoolHealthScore["grade"]
}) {
  return (
    <li className="flex items-start gap-3 py-2 border-b border-border/60 last:border-0">
      <SuggestionIcon grade={grade} />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{suggestion}</p>
        <Link
          href={`/dashboard/group/${pool.id}`}
          className="text-xs text-primary hover:underline"
          aria-label={`Go to ${pool.name}`}
        >
          {pool.name}
        </Link>
      </div>
    </li>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SuggestionListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-2">
          <Skeleton className="h-4 w-4 rounded-full shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface HealthSuggestionListProps {
  pools: Pool[]
  isLoading?: boolean
  /** Maximum number of suggestions to show when collapsed. Defaults to 5. */
  defaultVisibleCount?: number
}

export function HealthSuggestionList({
  pools,
  isLoading = false,
  defaultVisibleCount = 5,
}: HealthSuggestionListProps) {
  const [expanded, setExpanded] = useState(false)

  /** Flatten and sort suggestions across all pools by urgency. */
  const allSuggestions = useMemo<{ pool: Pool; suggestion: string; grade: PoolHealthScore["grade"] }[]>(() => {
    const entries: PoolSuggestionEntry[] = pools.map((pool) => ({
      pool,
      health: getCachedPoolHealth(pool.id, poolToHealthInput(pool)),
    }))

    // Sort pools by urgency (declining first, then by grade)
    const sorted = [...entries].sort((a, b) => urgencyRank(a) - urgencyRank(b))

    // Flatten suggestions
    return sorted.flatMap(({ pool, health }) =>
      health.suggestions.map((suggestion) => ({
        pool,
        suggestion,
        grade: health.grade,
      }))
    )
  }, [pools])

  // Don't render when there are no suggestions and not loading
  if (!isLoading && allSuggestions.length === 0) return null

  const visible = expanded ? allSuggestions : allSuggestions.slice(0, defaultVisibleCount)
  const hasMore = allSuggestions.length > defaultVisibleCount

  return (
    <section
      aria-labelledby="health-suggestions-heading"
      className={cn(
        "rounded-xl border border-border bg-card p-4 space-y-3",
        isLoading && "animate-pulse"
      )}
    >
      {/* header */}
      <div className="flex items-center justify-between">
        <h3
          id="health-suggestions-heading"
          className="text-sm font-semibold flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
          Actionable Suggestions
          {!isLoading && allSuggestions.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {allSuggestions.length}
            </span>
          )}
        </h3>

        {!isLoading && hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1 h-7"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="suggestion-list"
          >
            {expanded ? (
              <>
                Show Less <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                Show All ({allSuggestions.length}) <ChevronDown className="h-3 w-3" />
              </>
            )}
          </Button>
        )}
      </div>

      {/* list */}
      {isLoading ? (
        <SuggestionListSkeleton />
      ) : (
        <AnimatePresence initial={false}>
          <motion.ul
            id="suggestion-list"
            key={expanded ? "expanded" : "collapsed"}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden list-none p-0 m-0"
            role="list"
            aria-label="Actionable suggestions for your pools"
          >
            {visible.map(({ pool, suggestion, grade }, idx) => (
              <SuggestionRow
                key={`${pool.id}-${idx}`}
                pool={pool}
                suggestion={suggestion}
                grade={grade}
              />
            ))}
          </motion.ul>
        </AnimatePresence>
      )}
    </section>
  )
}
