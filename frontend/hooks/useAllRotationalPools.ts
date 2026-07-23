"use client"

import { useState, useEffect, useCallback } from "react"
import { useStellar } from "@/components/web3-provider"

export interface RotationalPoolMeta {
  id: string
  name: string
  contractAddress: string
  depositAmount: number | null
  tokenSymbol: string | null
  tokenDecimals: number | null
  membersCount: number
}

/**
 * Fetches the list of active rotational pools the current user is a member of.
 * Returns contract addresses for use with PoolDataProvider cache.
 */
export function useAllRotationalPools() {
  const { address } = useStellar()
  const [pools, setPools] = useState<RotationalPoolMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPools = useCallback(async () => {
    if (!address) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/pools?creator=${address.toLowerCase()}&page=0`)
      if (!res.ok) throw new Error("Failed to fetch pools")
      const json = await res.json()
      const data = Array.isArray(json) ? json : json.data ?? []

      const rotational = data
        .filter(
          (p: any) =>
            p.pool_type === "rotational" &&
            p.status === "active" &&
            p.contract_address
        )
        .map((p: any) => ({
          id: p.id,
          name: p.pool_name || p.name || "Unnamed Pool",
          contractAddress: p.contract_address,
          depositAmount: p.deposit_amount ? Number(p.deposit_amount) : null,
          tokenSymbol: p.token_symbol || "XLM",
          tokenDecimals: p.token_decimals ?? 7,
          membersCount: p.members_count || 0,
        }))

      setPools(rotational)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pools")
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    fetchPools()
  }, [fetchPools])

  return { pools, loading, error, refetch: fetchPools }
}
