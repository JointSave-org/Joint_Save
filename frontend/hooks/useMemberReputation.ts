"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  fetchMemberReputationData,
  fetchMembersReputationData,
  type ReputationData,
} from "@/hooks/useJointSaveContracts"

export type { ReputationData }

// ── Constants ─────────────────────────────────────────────────────────────────

const REPUTATION_CONFIGURED = !!process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID
/** 10-minute TTL for cached reputation data (enforced in useJointSaveContracts) */
export const REPUTATION_CACHE_TTL_MS = 10 * 60 * 1000

// ── Tier helpers ──────────────────────────────────────────────────────────────

export type ReputationTier = "excellent" | "reliable" | "developing" | "at_risk" | "provisional"

export interface ReputationDisplay {
  tier: ReputationTier
  label: string
  /** Tailwind bg color class */
  colorClass: string
  /** Tailwind text color class */
  textClass: string
  /** CSS color string for compact dot */
  dotColor: string
}

export function getTierFromScore(score: number, isProvisional: boolean): ReputationTier {
  if (isProvisional) return "provisional"
  if (score >= 800) return "excellent"
  if (score >= 600) return "reliable"
  if (score >= 400) return "developing"
  return "at_risk"
}

export const TIER_DISPLAY: Record<ReputationTier, ReputationDisplay> = {
  excellent: {
    tier: "excellent",
    label: "Excellent",
    colorClass: "bg-yellow-500/15",
    textClass: "text-yellow-700 dark:text-yellow-400",
    dotColor: "#EAB308",
  },
  reliable: {
    tier: "reliable",
    label: "Reliable",
    colorClass: "bg-green-500/15",
    textClass: "text-green-700 dark:text-green-400",
    dotColor: "#22C55E",
  },
  developing: {
    tier: "developing",
    label: "New/Developing",
    colorClass: "bg-yellow-400/15",
    textClass: "text-yellow-600 dark:text-yellow-300",
    dotColor: "#FBBF24",
  },
  at_risk: {
    tier: "at_risk",
    label: "At Risk",
    colorClass: "bg-red-500/15",
    textClass: "text-red-700 dark:text-red-400",
    dotColor: "#EF4444",
  },
  provisional: {
    tier: "provisional",
    label: "Provisional",
    colorClass: "bg-muted/50",
    textClass: "text-muted-foreground",
    dotColor: "#94A3B8",
  },
}

// ── Re-export batch fetcher for use in components ─────────────────────────────
export { fetchMembersReputationData }

// ── React hook ────────────────────────────────────────────────────────────────

interface UseMemberReputationResult {
  data: ReputationData | null
  isLoading: boolean
  tier: ReputationTier | null
  display: ReputationDisplay | null
  refetch: () => Promise<void>
}

/**
 * React hook that fetches and caches reputation data for a single member address.
 * Gracefully returns null state when the reputation contract is unavailable.
 */
export function useMemberReputation(address: string | null | undefined): UseMemberReputationResult {
  const [data, setData] = useState<ReputationData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (!address || !REPUTATION_CONFIGURED) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    try {
      const result = await fetchMemberReputationData(address)
      if (!controller.signal.aborted) {
        setData(result)
      }
    } catch {
      // Reputation contract unavailable — leave data null, don't error
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
  }, [address])

  useEffect(() => {
    fetchData()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchData])

  const tier = data ? getTierFromScore(data.totalScore, data.isProvisional) : null
  const display = tier ? TIER_DISPLAY[tier] : null

  return { data, isLoading, tier, display, refetch: fetchData }
}
