"use client"

import { useState, useEffect, useCallback } from "react"
import type { AdminPoolData } from "@/app/api/admin/pools/route"

interface UseAdminPoolsResult {
  pools: AdminPoolData[]
  totalAnomalies: number
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
  exportPools: (poolIds: string[]) => Promise<void>
  sendMessage: (poolIds: string[], message: string) => Promise<{ sent: number; failed: number }>
}

export function useAdminPools(wallet: string | null): UseAdminPoolsResult {
  const [pools, setPools] = useState<AdminPoolData[]>([])
  const [totalAnomalies, setTotalAnomalies] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPools = useCallback(async () => {
    if (!wallet) {
      setPools([])
      setTotalAnomalies(0)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/pools?wallet=${encodeURIComponent(wallet)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to fetch admin pools" }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setPools(data.pools ?? [])
      setTotalAnomalies(data.totalAnomalies ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch admin pools")
    } finally {
      setIsLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    fetchPools()
  }, [fetchPools])

  const exportPools = useCallback(
    async (poolIds: string[]) => {
      if (!wallet) throw new Error("Wallet not connected")

      const res = await fetch("/api/admin/bulk-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolIds, wallet }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Export failed" }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `jointsave-export-${new Date().toISOString().split("T")[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    },
    [wallet]
  )

  const sendMessage = useCallback(
    async (poolIds: string[], message: string) => {
      if (!wallet) throw new Error("Wallet not connected")

      const res = await fetch("/api/admin/bulk-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolIds, wallet, message }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Message send failed" }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      return res.json()
    },
    [wallet]
  )

  return {
    pools,
    totalAnomalies,
    isLoading,
    error,
    refetch: fetchPools,
    exportPools,
    sendMessage,
  }
}
