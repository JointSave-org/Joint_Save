"use client"

import { Activity, HelpCircle } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { PoolHealth, PoolHealthBand } from "@/lib/pool-health"
import { HEALTHY_THRESHOLD, FAIR_THRESHOLD } from "@/lib/pool-health"

const BAND_STYLES: Record<PoolHealthBand, { dot: string; chip: string }> = {
  healthy: {
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  fair: {
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
  "at-risk": {
    dot: "bg-rose-500",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  },
}

const NEUTRAL_CHIP = "bg-muted text-muted-foreground border-border"

function chipBase(extra: string) {
  return cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
    extra
  )
}

/**
 * Plain-language explanation of the score, shown in the tooltip so the badge
 * never reads as an opaque or unfair label.
 */
function HealthTooltipBody({ health }: { health: PoolHealth }) {
  return (
    <div className="max-w-[240px] space-y-1.5 text-left">
      <p className="font-semibold">Pool health</p>
      {health.state === "new" ? (
        <p className="text-background/80">
          This pool hasn&apos;t completed a full round of deposits yet, so there isn&apos;t enough
          history to score it reliably. The score will appear once members start participating.
        </p>
      ) : (
        <p className="text-background/80">
          The average on-time deposit rate across this pool&apos;s {health.memberCount} current
          member
          {health.memberCount === 1 ? "" : "s"}, based on their track record so far. Higher means
          members have been depositing more reliably.
        </p>
      )}
      <p className="text-background/60 pt-0.5">
        {HEALTHY_THRESHOLD}%+ healthy · {FAIR_THRESHOLD}–{HEALTHY_THRESHOLD - 1}% fair · under{" "}
        {FAIR_THRESHOLD}% at risk
      </p>
    </div>
  )
}

export function PoolHealthBadge({
  health,
  isLoading,
  className,
}: {
  health: PoolHealth | null
  isLoading?: boolean
  className?: string
}) {
  if (isLoading || !health) {
    return <Skeleton className={cn("h-5 w-20 rounded-full", className)} />
  }

  const isNew = health.state === "new"
  const styles = !isNew && health.band ? BAND_STYLES[health.band] : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={chipBase(cn(styles ? styles.chip : NEUTRAL_CHIP, className))}
          role="status"
          aria-label={
            isNew
              ? "Pool health: new pool, not enough history to score"
              : `Pool health: ${health.score}% on-time, ${health.label}`
          }
        >
          {isNew ? (
            <HelpCircle className="h-3 w-3" />
          ) : (
            <span className={cn("h-2 w-2 rounded-full", styles?.dot)} aria-hidden />
          )}
          {isNew ? (
            "New pool"
          ) : (
            <>
              <Activity className="h-3 w-3" aria-hidden />
              {health.score}%
            </>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <HealthTooltipBody health={health} />
      </TooltipContent>
    </Tooltip>
  )
}
