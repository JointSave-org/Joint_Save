"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { ErrorBoundary } from "@/components/error-boundary"
import { IncidentReviewCard } from "@/components/admin/incident-review-card"
import { PauseAuthorizationPanel } from "@/components/admin/pause-authorization-panel"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Shield, AlertTriangle, CheckCircle, Clock, Loader2, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface Incident {
  id: string
  pool_id: string
  trigger_rule_ids: string[]
  severity: "info" | "warning" | "critical"
  alert_count: number
  reason: string
  created_by_scan: boolean
  scan_source: "cron" | "admin" | "manual"
  action: "pause" | "none"
  executed: boolean
  dry_run: boolean
  skip_reason: string | null
  platform_paused: boolean
  onchain_status: "not_required" | "pending" | "confirmed" | "failed"
  onchain_tx_hash: string | null
  status: "open" | "resolved"
  resolved_by: string | null
  resolution_notes: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

interface PoolInfo {
  id: string
  name: string
  status: string
  pause_reason: string | null
  paused_at: string | null
}

interface IncidentSummary {
  total: number
  open: number
  executed: number
  dryRun: number
  awaitingOnchain: number
}

function IncidentReviewContent() {
  const t = useTranslations("admin.incidents")
  const searchParams = useSearchParams()
  const poolId = searchParams.get("poolId")
  const { address } = useStellar()

  const [pool, setPool] = useState<PoolInfo | null>(null)
  const [poolContract, setPoolContract] = useState<string>("")
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [summary, setSummary] = useState<IncidentSummary>({
    total: 0,
    open: 0,
    executed: 0,
    dryRun: 0,
    awaitingOnchain: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchIncidents = async () => {
    if (!poolId || !address) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/admin/incidents?poolId=${poolId}&callerAddress=${address}`
      )

      if (response.status === 403) {
        setError(t("error.forbidden"))
        setLoading(false)
        return
      }

      if (!response.ok) {
        throw new Error("Failed to fetch incidents")
      }

      const data = await response.json()
      setPool(data.pool)
      setIncidents(data.incidents || [])
      setSummary(data.summary || { total: 0, open: 0, executed: 0, dryRun: 0, awaitingOnchain: 0 })

      // Fetch pool contract address for authorization panel
      const poolResponse = await fetch(`/api/pools?id=${poolId}`)
      if (poolResponse.ok) {
        const poolData = await poolResponse.json()
        setPoolContract(poolData.contract_address || "")
      }
    } catch (err) {
      console.error("Fetch error:", err)
      setError(t("error.fetchFailed"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIncidents()
  }, [poolId, address])

  if (!address) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="p-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">{t("connectWalletTitle")}</h2>
            <p className="text-muted-foreground">{t("connectWalletBody")}</p>
          </Card>
        </main>
      </div>
    )
  }

  if (!poolId) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="p-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
            <h2 className="text-xl font-semibold mb-2">{t("error.missingPoolId")}</h2>
            <p className="text-muted-foreground">{t("error.missingPoolIdDesc")}</p>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/dashboard/admin/security">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToSecurity")}
          </Link>
        </Button>

        <div>
          <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
          {pool && (
            <p className="text-muted-foreground">
              {t("subtitle", { poolName: pool.name })}
            </p>
          )}
        </div>

        {error && (
          <Card className="p-4 border-rose-500/30 bg-rose-500/5">
            <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>
          </Card>
        )}

        {/* Pool Status Card */}
        {pool && pool.status === "paused" && (
          <Card className="p-4 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                  {t("poolPausedTitle")}
                </h3>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  {pool.pause_reason || t("poolPausedReason")}
                </p>
                {pool.paused_at && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    {t("pausedAt", {
                      date: new Date(pool.paused_at).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Shield className="h-4 w-4" />
              <p className="text-sm">{t("stats.total")}</p>
            </div>
            <p className="text-2xl font-bold">{summary.total}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <p className="text-sm">{t("stats.open")}</p>
            </div>
            <p className="text-2xl font-bold text-amber-600">{summary.open}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <p className="text-sm">{t("stats.executed")}</p>
            </div>
            <p className="text-2xl font-bold text-green-600">{summary.executed}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Shield className="h-4 w-4 text-blue-500" />
              <p className="text-sm">{t("stats.dryRun")}</p>
            </div>
            <p className="text-2xl font-bold text-blue-600">{summary.dryRun}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4 text-rose-500" />
              <p className="text-sm">{t("stats.awaitingOnchain")}</p>
            </div>
            <p className="text-2xl font-bold text-rose-600">{summary.awaitingOnchain}</p>
          </Card>
        </div>

        {/* Pause Authorization Panel */}
        {pool && poolContract && (
          <PauseAuthorizationPanel
            poolId={pool.id}
            poolContractAddress={poolContract}
            adminAddress={address}
          />
        )}

        {/* Incidents List */}
        <div>
          <h2 className="text-xl font-semibold mb-4">{t("incidentsList")}</h2>
          {loading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="p-4 animate-pulse">
                  <div className="space-y-3">
                    <div className="h-4 w-48 bg-muted rounded" />
                    <div className="h-3 w-full bg-muted rounded" />
                    <div className="h-3 w-2/3 bg-muted rounded" />
                  </div>
                </Card>
              ))}
            </div>
          ) : incidents.length === 0 ? (
            <Card className="p-12 text-center">
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">{t("noIncidents")}</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {incidents.map((incident) => (
                <IncidentReviewCard
                  key={incident.id}
                  incident={incident}
                  adminAddress={address}
                  onUpdate={fetchIncidents}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default function IncidentReviewPage() {
  const t = useTranslations("admin")
  return (
    <ErrorBoundary sectionName={t("sectionIncidentReview")}>
      <IncidentReviewContent />
    </ErrorBoundary>
  )
}
