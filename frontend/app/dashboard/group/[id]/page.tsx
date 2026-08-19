"use client"

import { use, useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { GroupDetails } from "@/components/group/group-details"
import { GroupMembers } from "@/components/group/group-members"
import { GroupActions } from "@/components/group/group-actions"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, LayoutDashboard, HandCoins } from "lucide-react"
import Link from "next/link"
import { fetchIsPaused, fetchPoolAdmin } from "@/hooks/useJointSaveContracts"
import { useStellar } from "@/components/web3-provider"
import { useRecentPools } from "@/hooks/useRecentPools"
import { ErrorBoundary, SectionErrorBoundary } from "@/components/error-boundary"
import {
  GroupActivitySkeleton,
  YieldDashboardSkeleton,
  GroupPageSkeleton,
} from "@/components/ui/loading-skeletons"

// Heavy components dynamic lazy loading with skeleton fallbacks
const GroupActivity = dynamic(
  () => import("@/components/group/group-activity").then((mod) => mod.GroupActivity),
  { ssr: false, loading: () => <GroupActivitySkeleton /> }
)

const YieldDashboard = dynamic(
  () => import("@/components/group/yield-dashboard").then((mod) => mod.YieldDashboard),
  { ssr: false, loading: () => <YieldDashboardSkeleton /> }
)

const AdminAuditLog = dynamic(
  () => import("@/components/group/admin-audit-log").then((mod) => mod.AdminAuditLog),
  {
    ssr: false,
    loading: () => (
      <div className="p-4 bg-muted/20 animate-pulse rounded-lg h-32">Loading Audit Log...</div>
    ),
  }
)

const AdminActionsLog = dynamic(
  () => import("@/components/group/admin-actions-log").then((mod) => mod.AdminActionsLog),
  {
    ssr: false,
    loading: () => (
      <div className="p-4 bg-muted/20 animate-pulse rounded-lg h-32">Loading Admin Actions...</div>
    ),
  }
)

const LendingTab = dynamic(
  () => import("@/components/lending/lending-tab").then((mod) => mod.LendingTab),
  {
    ssr: false,
    loading: () => (
      <div className="p-4 bg-muted/20 animate-pulse rounded-lg h-48">Loading Lending...</div>
    ),
  }
)

interface Pool {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  contract_address: string
  token_address: string
  creator_address: string
  /** Pool member list returned by /api/pools — used for lending eligibility checks */
  pool_members?: { member_address: string }[]
}

const isPendingAddress = (addr: string) => !addr || addr === "pending_deployment"

export default function GroupPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string }
}) {
  // Support both async params (Next 15+) and plain object params
  const resolvedParams = params instanceof Promise ? use(params) : (params as { id: string })
  const id = resolvedParams.id
  const { address } = useStellar()
  const { trackVisit } = useRecentPools(address)
  const [pool, setPool] = useState<Pool | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPaused, setIsPaused] = useState(false)
  const [poolAdmin, setPoolAdmin] = useState<string | null>(null)
  const trackedRef = useRef(false)

  useEffect(() => {
    fetch(`/api/pools?id=${id}`)
      .then((res) => res.json())
      .then((data) => {
        setPool(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  // Track visit when pool data loads
  useEffect(() => {
    if (pool && !loading && !trackedRef.current) {
      trackedRef.current = true
      trackVisit({
        id: pool.id,
        name: pool.name,
        type: pool.type,
        contract_address: pool.contract_address,
      })
    }
    if (!pool || loading) {
      trackedRef.current = false
    }
  }, [pool, loading, trackVisit])

  const refreshPoolState = useCallback(async () => {
    if (!pool || isPendingAddress(pool.contract_address)) return
    try {
      const [paused, admin] = await Promise.all([
        fetchIsPaused(pool.contract_address),
        fetchPoolAdmin(pool.contract_address),
      ])
      setIsPaused(paused)
      setPoolAdmin(admin)
    } catch {}
  }, [pool])

  useEffect(() => {
    refreshPoolState()
  }, [refreshPoolState])

  if (loading) return <GroupPageSkeleton />
  if (!pool) return <div className="p-8 text-center text-muted-foreground">Pool not found</div>

  const cacheKey =
    pool.contract_address && pool.contract_address !== "pending_deployment"
      ? pool.contract_address
      : pool.id

  // Derive membership and member list from pool_members array
  const poolMemberAddresses: string[] = pool.pool_members?.map((m) => m.member_address) ?? []
  const isMember =
    !!address &&
    (poolMemberAddresses.some((m) => m.toLowerCase() === address.toLowerCase()) ||
      pool.creator_address?.toLowerCase() === address.toLowerCase())

  const isAdmin =
    !!address &&
    (poolAdmin?.toLowerCase() === address.toLowerCase() ||
      pool.creator_address?.toLowerCase() === address.toLowerCase())

  return (
    <ErrorBoundary sectionName="Group Detail" walletAddress={address}>
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Button variant="ghost" className="mb-6" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>

          {/* Top-level Overview / Lending tabs */}
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList>
              <TabsTrigger value="overview" className="gap-1.5">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="lending" className="gap-1.5">
                <HandCoins className="h-3.5 w-3.5" />
                Lending
              </TabsTrigger>
            </TabsList>

            {/* ── Overview tab — existing pool content ────────────────── */}
            <TabsContent value="overview">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <SectionErrorBoundary sectionName="Pool Details" walletAddress={address}>
                    <GroupDetails groupId={id} contractAddress={cacheKey} poolAdmin={poolAdmin} />
                  </SectionErrorBoundary>
                  <SectionErrorBoundary sectionName="Activity Feed" walletAddress={address}>
                    <GroupActivity groupId={id} contractAddress={cacheKey} startLedger={0} />
                  </SectionErrorBoundary>
                  {/* Admin audit log with CSV export — only shown to the pool creator */}
                  <SectionErrorBoundary sectionName="Audit Log" walletAddress={address}>
                    <AdminAuditLog groupId={id} creatorAddress={pool.creator_address} />
                  </SectionErrorBoundary>
                  {/* Admin actions log — visible to all pool members */}
                  <SectionErrorBoundary sectionName="Admin Actions" walletAddress={address}>
                    <AdminActionsLog groupId={id} />
                  </SectionErrorBoundary>
                </div>

                <div className="space-y-6">
                  <SectionErrorBoundary sectionName="Group Actions" walletAddress={address}>
                    <GroupActions
                      groupId={id}
                      poolAddress={pool.contract_address}
                      poolType={pool.type}
                      tokenAddress={pool.token_address}
                      creatorAddress={pool.creator_address}
                      isPaused={isPaused}
                      poolAdmin={poolAdmin}
                      onPauseChange={refreshPoolState}
                    />
                  </SectionErrorBoundary>
                  {pool.type === "flexible" && (
                    <SectionErrorBoundary sectionName="Yield Dashboard" walletAddress={address}>
                      <YieldDashboard poolAddress={pool.contract_address} />
                    </SectionErrorBoundary>
                  )}
                  <SectionErrorBoundary sectionName="Members List" walletAddress={address}>
                    <GroupMembers groupId={id} contractAddress={cacheKey} poolType={pool.type} />
                  </SectionErrorBoundary>
                </div>
              </div>
            </TabsContent>

            {/* ── Lending tab — P2P microloan marketplace ──────────────── */}
            <TabsContent value="lending">
              <SectionErrorBoundary sectionName="Lending" walletAddress={address}>
                <LendingTab
                  poolId={cacheKey}
                  tokenAddress={pool.token_address}
                  poolMembers={poolMemberAddresses}
                  isMember={isMember}
                  isAdmin={isAdmin}
                  walletAddress={address}
                />
              </SectionErrorBoundary>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </ErrorBoundary>
  )
}
