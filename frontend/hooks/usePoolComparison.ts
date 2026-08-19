"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { fetchReputation, type ReputationScore } from "@/hooks/useJointSaveContracts"
import { computePoolHealth, hasTrackRecord, type PoolHealth } from "@/lib/pool-health"

/**
 * Maximum number of pools that can be compared side-by-side at once.
 * Enforced both in the explore-page picker and when parsing a shared URL.
 */
export const MAX_COMPARISON_POOLS = 4

/** Query-string key used to share a comparison (`/explore/compare?pools=…`). */
export const COMPARISON_QUERY_KEY = "pools"

/** Stellar contract addresses always start with C followed by 55 base32 chars. */
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/

/** The subset of pool fields the comparison table needs from /api/pools. */
export interface ComparisonPoolRecord {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: string
  description: string | null
  contract_address: string
  token_symbol?: string
  token_decimals?: number
  contribution_amount: number | null
  target_amount: number | null
  minimum_deposit: number | null
  members_count: number
  frequency: string | null
  round_duration: number | null
  deadline: string | null
  created_at: string
  total_saved: number
  creator_address?: string
  pool_members?: { member_address: string; contribution_amount?: number }[]
}

/** One column of the comparison table, keyed by the pool address in the URL. */
export interface ComparisonPool {
  /** Stable identifier used in the URL — contract address when available, else DB id. */
  key: string
  pool: ComparisonPoolRecord | null
  loading: boolean
  /** Present when the address could not be resolved to a pool. */
  error: string | null
  health: PoolHealth | null
  /** Average on-time rate across members, 0–100. Null while loading. */
  avgReputation: number | null
}

/**
 * Stable identifier for a pool that survives URL sharing:
 * prefers the deployed contract address, falls back to the DB UUID for pools
 * whose contract is still pending deployment.
 */
export function getPoolComparisonKey(pool: {
  id: string
  contract_address?: string | null
}): string {
  const address = pool.contract_address
  return address && address !== "pending_deployment" && CONTRACT_ADDRESS_RE.test(address)
    ? address
    : pool.id
}

/** Split a raw `pools` query value into a de-duplicated list capped at the max. */
export function parseComparisonKeys(raw: string | null | undefined): string[] {
  if (!raw) return []
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
  return Array.from(new Set(keys)).slice(0, MAX_COMPARISON_POOLS)
}

/** Join keys back into a `pools` query value. */
export function serializeComparisonKeys(keys: string[]): string {
  return keys.slice(0, MAX_COMPARISON_POOLS).join(",")
}

async function fetchPoolByKey(key: string): Promise<ComparisonPoolRecord> {
  const isContract = CONTRACT_ADDRESS_RE.test(key)
  const res = await fetch(isContract ? `/api/pools?contract=${key}` : `/api/pools?id=${key}`)
  if (!res.ok) throw new Error("Pool not found")
  const data = (await res.json()) as ComparisonPoolRecord
  if (!data || !data.id) throw new Error("Pool not found")
  return data
}

interface ReputationSummary {
  health: PoolHealth
  avgReputation: number | null
}

/**
 * Compute the health badge + average member reputation for a pool, mirroring
 * the pattern used by usePoolHealth (per-member on-chain reputation lookups).
 */
async function computePoolHealthAndReputation(
  pool: ComparisonPoolRecord
): Promise<ReputationSummary> {
  const members = pool.pool_members ?? []
  if (members.length === 0) {
    const health = computePoolHealth([], 0)
    return { health, avgReputation: null }
  }

  const reputations = (
    await Promise.allSettled(
      members.map(async (m) => [m.member_address, await fetchReputation(m.member_address)] as const)
    )
  )
    .filter(
      (r): r is PromiseFulfilledResult<readonly [string, ReputationScore]> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value[1])

  let historyObserved: number
  if (pool.type === "rotational") {
    // Rotational pools observe a round of history per elapsed round; without
    // on-chain state available here, fall back to members with a track record.
    historyObserved = reputations.filter(hasTrackRecord).length
  } else {
    historyObserved = reputations.filter(hasTrackRecord).length
  }

  const health = computePoolHealth(reputations, historyObserved)
  const scored = reputations.length > 0 ? reputations : null
  const avgReputation =
    scored && scored.length > 0
      ? Math.round(scored.reduce((sum, r) => sum + r.onTimeRate, 0) / scored.length / 100)
      : null

  return { health, avgReputation }
}

/**
 * Manages the pool comparison feature.
 *
 * - Selection lives in the URL (`/explore/compare?pools=addr1,addr2`) so
 *   comparisons can be shared and survive refresh.
 * - Up to MAX_COMPARISON_POOLS pools can be selected.
 * - Full pool data (plus health + average member reputation) is fetched for
 *   every selected pool; failed resolutions surface an error per column.
 */
export function usePoolComparison() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedKeys = useMemo(
    () => parseComparisonKeys(searchParams.get(COMPARISON_QUERY_KEY)),
    [searchParams]
  )

  // Stable serialized form — the fetch effect keys off this string, not the
  // array identity, so re-renders (e.g. pool data arriving) never re-trigger it.
  const selectedKeyString = selectedKeys.join(",")

  const [pools, setPools] = useState<Record<string, ComparisonPool>>({})

  const updateUrl = useCallback(
    (keys: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      const serialized = serializeComparisonKeys(keys)
      if (serialized) {
        params.set(COMPARISON_QUERY_KEY, serialized)
      } else {
        params.delete(COMPARISON_QUERY_KEY)
      }
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : "?", { scroll: false })
    },
    [router, searchParams]
  )

  // Fetch data for every selected pool (and drop entries no longer selected).
  useEffect(() => {
    let cancelled = false

    setPools((prev) => {
      const next: Record<string, ComparisonPool> = {}
      for (const key of selectedKeys) {
        next[key] = prev[key] ?? {
          key,
          pool: null,
          loading: true,
          error: null,
          health: null,
          avgReputation: null,
        }
      }
      return next
    })

    selectedKeys.forEach((key) => {
      ;(async () => {
        try {
          const pool = await fetchPoolByKey(key)
          if (cancelled) return
          const { health, avgReputation } = await computePoolHealthAndReputation(pool)
          if (cancelled) return
          setPools((prev) => ({
            ...prev,
            [key]: { key, pool, loading: false, error: null, health, avgReputation },
          }))
        } catch (err) {
          if (cancelled) return
          setPools((prev) => ({
            ...prev,
            [key]: {
              key,
              pool: null,
              loading: false,
              error: err instanceof Error ? err.message : "Could not load this pool",
              health: null,
              avgReputation: null,
            },
          }))
        }
      })()
    })

    return () => {
      cancelled = true
    }
    // The effect keys off the serialized key string so pool-data re-renders
    // never re-trigger the fetch loop.
  }, [selectedKeyString])

  const togglePool = useCallback(
    (key: string) => {
      if (selectedKeys.includes(key)) {
        updateUrl(selectedKeys.filter((k) => k !== key))
      } else if (selectedKeys.length < MAX_COMPARISON_POOLS) {
        updateUrl([...selectedKeys, key])
      }
      // When at max capacity, silently ignore further adds — the explore page
      // surfaces a toast explaining the limit before calling this.
    },
    [selectedKeys, updateUrl]
  )

  const removePool = useCallback(
    (key: string) => updateUrl(selectedKeys.filter((k) => k !== key)),
    [selectedKeys, updateUrl]
  )

  const clearSelection = useCallback(() => updateUrl([]), [updateUrl])

  const isSelected = useCallback((key: string) => selectedKeys.includes(key), [selectedKeys])

  const orderedPools = useMemo(
    () => selectedKeys.map((key) => pools[key]).filter((p): p is ComparisonPool => Boolean(p)),
    [selectedKeys, pools]
  )

  return {
    selectedKeys,
    pools: orderedPools,
    togglePool,
    removePool,
    clearSelection,
    isSelected,
    canAddMore: selectedKeys.length < MAX_COMPARISON_POOLS,
    isAtMax: selectedKeys.length >= MAX_COMPARISON_POOLS,
  }
}
