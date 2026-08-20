"use client"

import { useState, useMemo } from "react"
import { useStellar } from "@/components/web3-provider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { ErrorBoundary } from "@/components/error-boundary"
import { useAdminPools } from "@/hooks/useAdminPools"
import { PoolHealthCard, PoolHealthCardSkeleton } from "@/components/admin/pool-health-card"
import { AnomalyAlertList } from "@/components/admin/anomaly-alert-list"
import { PoolComparisonTable } from "@/components/admin/pool-comparison-table"
import { BulkOperations } from "@/components/admin/bulk-operations"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Shield, AlertTriangle, BarChart3, Zap } from "lucide-react"

function AdminDashboardContent() {
  const { address } = useStellar()
  const { pools, totalAnomalies, isLoading, error, refetch, exportPools, sendMessage } =
    useAdminPools(address)

  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<string>>(new Set())

  const handleToggleSelect = (id: string) => {
    setSelectedPoolIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedPoolIds(new Set(pools.map((p) => p.id)))
  }

  const handleDeselectAll = () => {
    setSelectedPoolIds(new Set())
  }

  // Flatten anomalies for the alert list
  const allAnomalies = useMemo(() => {
    return pools.flatMap((pool) =>
      pool.anomalies.map((anomaly) => ({
        poolId: pool.id,
        poolName: pool.name,
        anomaly,
      }))
    )
  }, [pools])

  // Summary stats
  const stats = useMemo(() => {
    const healthy = pools.filter((p) => p.health_band === "healthy").length
    const fair = pools.filter((p) => p.health_band === "fair").length
    const atRisk = pools.filter((p) => p.health_band === "at-risk").length
    const critical = allAnomalies.filter((a) => a.anomaly.severity === "critical").length
    const warnings = allAnomalies.filter((a) => a.anomaly.severity === "warning").length
    return { healthy, fair, atRisk, critical, warnings }
  }, [pools, allAnomalies])

  if (!address) {
    return (
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card className="p-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-muted-foreground">
              Connect your wallet to access the admin dashboard.
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
        <div>
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor pool health, detect anomalies, and perform bulk operations.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-6">
            {/* Summary stats skeleton */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <Card key={i} className="p-4">
                  <div className="space-y-2">
                    <div className="h-4 w-20 bg-muted rounded" />
                    <div className="h-8 w-12 bg-muted rounded" />
                  </div>
                </Card>
              ))}
            </div>
            {/* Health cards skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <PoolHealthCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : pools.length === 0 ? (
          <Card className="p-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">No Pools Found</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              You are not an admin of any pools. Create a pool to access the admin dashboard.
            </p>
          </Card>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">Total Pools</p>
                <p className="text-2xl font-bold">{pools.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">Healthy</p>
                <p className="text-2xl font-bold text-emerald-600">{stats.healthy}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">At Risk</p>
                <p className="text-2xl font-bold text-rose-600">{stats.atRisk}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">Anomalies</p>
                <p className="text-2xl font-bold text-amber-600">{totalAnomalies}</p>
              </Card>
            </div>

            {/* Bulk Operations */}
            <BulkOperations
              pools={pools}
              selectedPoolIds={selectedPoolIds}
              onToggleSelect={handleToggleSelect}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onExport={exportPools}
              onSendMessage={sendMessage}
            />

            {/* Main Content Tabs */}
            <Tabs defaultValue="health">
              <TabsList>
                <TabsTrigger value="health" className="gap-1.5">
                  <BarChart3 className="h-4 w-4" />
                  Health Overview
                </TabsTrigger>
                <TabsTrigger value="anomalies" className="gap-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  Anomalies
                  {totalAnomalies > 0 && (
                    <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">
                      {totalAnomalies}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="compare" className="gap-1.5">
                  <Zap className="h-4 w-4" />
                  Compare
                </TabsTrigger>
              </TabsList>

              <TabsContent value="health" className="mt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {pools.map((pool) => (
                    <PoolHealthCard
                      key={pool.id}
                      pool={pool}
                      isSelected={selectedPoolIds.has(pool.id)}
                      onToggleSelect={handleToggleSelect}
                    />
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="anomalies" className="mt-6">
                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Detected Anomalies</h3>
                  <AnomalyAlertList anomalies={allAnomalies} />
                </Card>
              </TabsContent>

              <TabsContent value="compare" className="mt-6">
                <PoolComparisonTable pools={pools} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  )
}

export default function AdminDashboardPage() {
  return (
    <ErrorBoundary sectionName="Admin Dashboard">
      <AdminDashboardContent />
    </ErrorBoundary>
  )
}
