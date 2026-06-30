"use client"

import { useEffect, useMemo, useState } from "react"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import {
  fetchReputation,
  type ReputationScore,
  type RotationalPoolState,
} from "@/hooks/useJointSaveContracts"
import { computePoolHealth, hasTrackRecord, type PoolHealth } from "@/lib/pool-health"

interface PoolMemberRow {
  member_address: string
}

/**
 * Computes a pool's health badge data from the reputation system.
 *
 * Reuses the unified pool cache (members + on-chain state) and layers per-member
 * reputation lookups on top, mirroring the pattern already used on the group
 * members panel. Returns `health: null` while data is still loading.
 */
export function usePoolHealth(
  cacheKey: string,
  poolType: "rotational" | "target" | "flexible"
): { health: PoolHealth | null; isLoading: boolean } {
  const { data, isLoading: poolLoading } = usePoolData(cacheKey)

  const members: PoolMemberRow[] = data?.db?.pool_members ?? []
  const onchain = data?.onchain ?? null

  // Stable key so the effect only re-runs when the actual member set changes.
  const memberKey = useMemo(
    () =>
      members
        .map((m) => m.member_address)
        .sort()
        .join(","),
    [members]
  )

  const [reputations, setReputations] = useState<Record<string, ReputationScore>>({})
  const [repsLoading, setRepsLoading] = useState(true)

  useEffect(() => {
    if (members.length === 0) {
      setReputations({})
      // Only "done" loading reps once the underlying pool data has loaded;
      // otherwise an empty members list is just the not-yet-fetched state.
      setRepsLoading(poolLoading)
      return
    }
    let cancelled = false
    setRepsLoading(true)
    ;(async () => {
      const entries = await Promise.allSettled(
        members.map(
          async (m) => [m.member_address, await fetchReputation(m.member_address)] as const
        )
      )
      if (cancelled) return
      setReputations(
        Object.fromEntries(
          entries
            .filter(
              (r): r is PromiseFulfilledResult<readonly [string, ReputationScore]> =>
                r.status === "fulfilled"
            )
            .map((r) => r.value)
        )
      )
      setRepsLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // memberKey captures the member set; poolLoading gates the empty case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, poolLoading])

  const health = useMemo<PoolHealth | null>(() => {
    if (poolLoading || repsLoading) return null

    const reps = members
      .map((m) => reputations[m.member_address])
      .filter((r): r is ReputationScore => Boolean(r))

    // How much real history the pool has observed — the confidence gate.
    // Rotational pools expose elapsed rounds directly; for target/flexible
    // pools (which have no rounds) we use how many members already carry a
    // participation track record from their reputation.
    let historyObserved: number
    if (poolType === "rotational" && onchain) {
      historyObserved = (onchain as RotationalPoolState).currentRound ?? 0
    } else {
      historyObserved = reps.filter(hasTrackRecord).length
    }

    return computePoolHealth(reps, historyObserved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, reputations, onchain, poolType, poolLoading, repsLoading])

  return { health, isLoading: poolLoading || repsLoading }
}
