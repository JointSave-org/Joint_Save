"use client"

import { useState, useMemo } from "react"
import { useStellar } from "@/components/web3-provider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { ErrorBoundary } from "@/components/error-boundary"
import { useSecurityAlerts } from "@/hooks/useSecurityAlerts"
import { SecurityAlertCard, SecurityAlertListEmpty } from "@/components/admin/security-alert-card"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Shield,
  ShieldAlert,
  AlertTriangle,
  Info,
  RefreshCw,
  Loader2,
} from "lucide-react"
import type { AlertSeverity } from "@/lib/security-rules"

function SecurityDashboardContent() {
  const { address } = useStellar()
  const { alerts, isLoading, error, summary, runScan, updateAlertStatus } = useSecurityAlerts()

  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false
      if (statusFilter !== "all" && a.status !== statusFilter) return false
      return true
    })
  }, [alerts, severityFilter, statusFilter])

  if (!address) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="p-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-muted-foreground">
              Connect your wallet to access the security monitoring dashboard.
            </p>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Security Monitoring</h1>
            <p className="text-muted-foreground">
              Detect suspicious activity patterns and manage incident response.
            </p>
          </div>
          <Button onClick={runScan} disabled={isLoading} className="gap-2">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {isLoading ? "Scanning..." : "Run Security Scan"}
          </Button>
        </div>

        {error && (
          <Card className="p-4 border-rose-500/30 bg-rose-500/5">
            <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>
          </Card>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ShieldAlert className="h-4 w-4" />
              <p className="text-sm">Total Alerts</p>
            </div>
            <p className="text-2xl font-bold">{summary.total}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <XCircleIcon className="h-4 w-4 text-rose-500" />
              <p className="text-sm">Critical</p>
            </div>
            <p className="text-2xl font-bold text-rose-600">{summary.critical}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <p className="text-sm">Warning</p>
            </div>
            <p className="text-2xl font-bold text-amber-600">{summary.warning}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Info className="h-4 w-4 text-blue-500" />
              <p className="text-sm">Info</p>
            </div>
            <p className="text-2xl font-bold text-blue-600">{summary.info}</p>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <Select
            value={severityFilter}
            onValueChange={(v) => setSeverityFilter(v as AlertSeverity | "all")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="investigating">Investigating</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="false_positive">False Positive</SelectItem>
            </SelectContent>
          </Select>

          {(severityFilter !== "all" || statusFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSeverityFilter("all")
                setStatusFilter("all")
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>

        {/* Alert Timeline */}
        {isLoading ? (
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
        ) : filteredAlerts.length === 0 ? (
          <SecurityAlertListEmpty />
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => (
              <SecurityAlertCard
                key={alert.id}
                alert={alert}
                onStatusChange={updateAlertStatus}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  )
}

export default function SecurityDashboardPage() {
  return (
    <ErrorBoundary sectionName="Security Dashboard">
      <SecurityDashboardContent />
    </ErrorBoundary>
  )
}
