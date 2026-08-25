"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, ChevronUp, Lightbulb, TrendingDown, AlertTriangle, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { HealthTrend, HealthGrade } from "@/lib/pool-health"
import type { PoolWithHealth } from "@/components/dashboard/pool-health-widget"

// ── Urgency classification ─────────────────────────────────────────────────────

type SuggestionUrgency = "high" | "medium" | "low"

function urgencyFor(grade: HealthGrade, trend: HealthTrend): SuggestionUrgency {
  if (grade === "F" || grade === "D" || trend === "declining") return "high"
  if (grade === "C") return "medium"
  return "low"
}

const URGENCY_STYLES: Record<
  SuggestionUrgency,
  { icon: React.ReactNode; badge: string; dot: string }
> = {
  high: {
    icon: <AlertTriangle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />,
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
    dot: "bg-rose-500",
  },
  medium: {
    icon: <TrendingDown className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />,
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    dot: "bg-amber-500",
  },
  low: {
    icon: <Info className="h-3.5 w-3.5 text-sky-500 flex-shrink-0" />,
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
    dot: "bg-sky-500",
  },
}

// ── Flat suggestion item ───────────────────────────────────────────────────────

interface SuggestionItem {
  poolId: string
  poolName: string
  suggestion: string
  urgency: SuggestionUrgency
}

function buildSuggestionItems(poolsWithHealth: PoolWithHealth[]): SuggestionItem[] {
  const items: SuggestionItem[] = []

  for (const { pool, score } of poolsWithHealth) {
    if (score.suggestions.length === 0) continue
    const urgency = urgencyFor(score.grade, score.trend)
    for (const suggestion of score.suggestions) {
      items.push({
        poolId: pool.id,
        poolName: pool.name,
        suggestion,
        urgency,
      })
    }
  }

  // Sort: high → medium → low, then alphabetically by pool name
  const ORDER: Record<SuggestionUrgency, number> = { high: 0, medium: 1, low: 2 }
  return items.sort((a, b) => {
    const urgencyDiff = ORDER[a.urgency] - ORDER[b.urgency]
    if (urgencyDiff !== 0) return urgencyDiff
    return a.poolName.localeCompare(b.poolName)
  })
}

// ── Row component ──────────────────────────────────────────────────────────────

function SuggestionRow({ item }: { item: SuggestionItem }) {
  const styles = URGENCY_STYLES[item.urgency]

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-3 py-2.5 border-b border-border/50 last:border-0"
    >
      {/* Urgency icon */}
      <span className="mt-0.5">{styles.icon}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">{item.suggestion}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.poolName}</p>
      </div>

      {/* Urgency badge */}
      <Badge
        className={cn(
          "text-[10px] px-1.5 py-0 border flex-shrink-0 capitalize font-medium",
          styles.badge
        )}
      >
        <span
          className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1", styles.dot)}
          aria-hidden
        />
        {item.urgency}
      </Badge>
    </motion.li>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface HealthSuggestionListProps {
  poolsWithHealth: PoolWithHealth[]
}

/**
 * Expandable section listing actionable suggestions across all pools,
 * sorted by urgency (declining / low-grade pools first).
 */
export function HealthSuggestionList({ poolsWithHealth }: HealthSuggestionListProps) {
  const [expanded, setExpanded] = useState(false)

  const items = buildSuggestionItems(poolsWithHealth)

  // Don't render if there are no suggestions
  if (items.length === 0) return null

  const highCount = items.filter((i) => i.urgency === "high").length

  return (
    <div
      className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden"
      role="region"
      aria-label="Actionable pool suggestions"
    >
      {/* Toggle header */}
      <Button
        variant="ghost"
        className="w-full flex items-center justify-between px-4 py-3 h-auto rounded-none text-left hover:bg-muted/50"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="suggestion-list-body"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary flex-shrink-0" aria-hidden />
          <span className="font-medium text-sm">
            Suggestions <span className="text-muted-foreground font-normal">({items.length})</span>
          </span>
          {highCount > 0 && (
            <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 text-[10px] px-1.5 py-0">
              {highCount} urgent
            </Badge>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </Button>

      {/* Expandable list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id="suggestion-list-body"
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <ul className="px-4 py-1" aria-label="Suggestions list">
              <AnimatePresence>
                {items.map((item, idx) => (
                  <SuggestionRow key={`${item.poolId}-${idx}`} item={item} />
                ))}
              </AnimatePresence>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
