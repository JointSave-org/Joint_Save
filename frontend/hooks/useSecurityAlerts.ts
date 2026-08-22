"use client"

import { useState, useEffect, useCallback } from "react"
import type { SecurityAlert } from "@/lib/security-rules"

interface UseSecurityAlertsResult {
  alerts: SecurityAlert[]
  isLoading: boolean
  error: string | null
  summary: {
    total: number
    critical: number
    warning: number
    info: number
  }
  runScan: () => Promise<void>
  updateAlertStatus: (alertId: string, status: SecurityAlert["status"]) => Promise<void>
  refresh: () => Promise<void>
}

export function useSecurityAlerts(): UseSecurityAlertsResult {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAlerts = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch("/api/admin/security/scan", {
        method: "POST",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to fetch security alerts")
      }

      const data = await response.json()
      setAlerts(data.alerts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch security alerts")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const runScan = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch("/api/admin/security/scan", {
        method: "POST",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Security scan failed")
      }

      const data = await response.json()
      setAlerts(data.alerts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Security scan failed")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updateAlertStatus = useCallback(
    async (alertId: string, status: SecurityAlert["status"]) => {
      try {
        // Optimistic update
        setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, status } : a)))

        const response = await fetch("/api/admin/security/scan", {
          method: "POST",
        })

        if (!response.ok) {
          // Revert on failure
          await fetchAlerts()
          throw new Error("Failed to update alert status")
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update alert status")
      }
    },
    [fetchAlerts]
  )

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const summary = {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    warning: alerts.filter((a) => a.severity === "warning").length,
    info: alerts.filter((a) => a.severity === "info").length,
  }

  return {
    alerts,
    isLoading,
    error,
    summary,
    runScan,
    updateAlertStatus,
    refresh: fetchAlerts,
  }
}
