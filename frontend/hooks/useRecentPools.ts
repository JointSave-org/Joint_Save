"use client"

import { useState, useCallback, useEffect, useRef } from "react"

export interface RecentPool {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  contract_address: string
  visitedAt: number
}

const STORAGE_PREFIX = "jointsave_recent_pools_"
const MAX_ITEMS = 5

function readStorage(address: string): RecentPool[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + address)
    if (!raw) return []
    return JSON.parse(raw) as RecentPool[]
  } catch {
    return []
  }
}

function writeStorage(address: string, pools: RecentPool[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_PREFIX + address, JSON.stringify(pools))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function useRecentPools(address: string | null) {
  const [recentPools, setRecentPools] = useState<RecentPool[]>(() =>
    address ? readStorage(address) : []
  )
  const addressRef = useRef(address)
  addressRef.current = address

  // Re-read when address changes (wallet switch)
  useEffect(() => {
    if (address) {
      setRecentPools(readStorage(address))
    } else {
      setRecentPools([])
    }
  }, [address])

  const trackVisit = useCallback(
    (pool: Omit<RecentPool, "visitedAt">) => {
      const currentAddr = addressRef.current
      if (!currentAddr) return

      setRecentPools((prev) => {
        const dedupKey = pool.contract_address || pool.id
        const filtered = prev.filter(
          (p) => (p.contract_address || p.id) !== dedupKey
        )
        const updated: RecentPool[] = [
          { ...pool, visitedAt: Date.now() },
          ...filtered,
        ].slice(0, MAX_ITEMS)

        writeStorage(currentAddr, updated)
        return updated
      })
    },
    []
  )

  return { recentPools, trackVisit }
}
