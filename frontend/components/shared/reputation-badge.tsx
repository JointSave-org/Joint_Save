"use client"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react"
import {
  getTierFromScore,
  TIER_DISPLAY,
  type ReputationTier,
  type ReputationDisplay,
} from "@/hooks/useMemberReputation"
import type { ReputationData } from "@/hooks/useJointSaveContracts"

// ── Props ─────────────────────────────────────────────────────────────────────

interface ReputationBadgeProps {
  data: ReputationData | null
  isLoading?: boolean
  /** compact=true renders only a colored dot — no text, minimal footprint */
  compact?: boolean
  className?: string
}

// ── Icon per tier ─────────────────────────────────────────────────────────────

function TierIcon({ tier, className }: { tier: ReputationTier; className?: string }) {
  switch (tier) {
    case "excellent":
      return <ShieldCheck className={className} />
    case "reliable":
      return <ShieldCheck className={className} />
    case "at_risk":
      return <ShieldAlert className={className} />
    default:
      return <ShieldQuestion className={className} />
  }
}

// ── Tooltip breakdown ─────────────────────────────────────────────────────────

function ReputationTooltipContent({
  data,
  display,
}: {
  data: ReputationData
  display: ReputationDisplay
}) {
  const reliabilityPct = (data.depositReliability / 10).toFixed(1)
  const completionPct =
    data.poolsJoined > 0
      ? ((data.poolsCompleted / data.poolsJoined) * 100).toFixed(0)
      : "—"

  return (
    <div className="space-y-2 min-w-[200px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Reputation Score</span>
        <span className={`text-sm font-bold ${display.textClass}`}>{data.totalScore} / 1000</span>
      </div>
      {data.isProvisional && (
        <p className="text-xs text-muted-foreground italic">
          Provisional — fewer than 10 deposits recorded
        </p>
      )}
      <div className="space-y-1 text-xs border-t pt-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Deposit reliability</span>
          <span className="font-medium">{reliabilityPct}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Pools completed</span>
          <span className="font-medium">
            {data.poolsCompleted} / {data.poolsJoined} ({completionPct}%)
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total deposits</span>
          <span className="font-medium">{data.totalDeposits}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Missed rounds</span>
          <span className="font-medium">{data.missedDeposits}</span>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Renders a colored reputation badge next to a member address.
 *
 * - Full mode: colored badge with tier label and icon, tooltip with score breakdown
 * - Compact mode: single colored dot with tooltip on hover
 * - Hidden when `data` is null (contract unavailable) — never errors
 */
export function ReputationBadge({ data, isLoading, compact = false, className }: ReputationBadgeProps) {
  // Hide completely when data is unavailable — don't show skeleton either,
  // because the layout should degrade gracefully.
  if (!data && !isLoading) return null
  if (isLoading) {
    return compact ? (
      <span className="inline-block h-2 w-2 rounded-full bg-muted animate-pulse" aria-hidden />
    ) : (
      <span className="inline-flex items-center h-5 w-16 rounded-full bg-muted animate-pulse" aria-hidden />
    )
  }
  if (!data) return null

  const tier = getTierFromScore(data.totalScore, data.isProvisional)
  const display = TIER_DISPLAY[tier]

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 cursor-help"
            style={{ backgroundColor: display.dotColor }}
            aria-label={`Reputation: ${display.label} (${data.totalScore}/1000)`}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="p-3 bg-popover text-popover-foreground border shadow-md">
          <ReputationTooltipContent data={data} display={display} />
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`gap-1 text-xs font-medium cursor-help select-none ${display.colorClass} ${display.textClass} border-current/20 ${className ?? ""}`}
          aria-label={`Reputation: ${display.label} (${data.totalScore}/1000)`}
        >
          <TierIcon tier={tier} className="h-3 w-3" />
          {display.label}
          {!data.isProvisional && (
            <span className="opacity-70 font-normal">{data.totalScore}</span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="p-3 bg-popover text-popover-foreground border shadow-md">
        <ReputationTooltipContent data={data} display={display} />
      </TooltipContent>
    </Tooltip>
  )
}
