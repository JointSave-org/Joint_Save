"use client"

import { use, useCallback, useEffect, useRef, useState } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { GroupDetails } from "@/components/group/group-details"
import { GroupMembers } from "@/components/group/group-members"
import { GroupActivity } from "@/components/group/group-activity"
import { GroupActions } from "@/components/group/group-actions"
import { RotationalTimelineContainer } from "@/components/group/rotational-timeline-container"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { fetchIsPaused, fetchPoolAdmin } from "@/hooks/useJointSaveContracts"
import { useStellar } from "@/components/web3-provider"
import { useRecentPools } from "@/hooks/useRecentPools"

interface Pool {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  contract_address: string
  token_address: string
}

const isPendingAddress = (addr: string) => !addr || addr === "pending_deployment"

export default function GroupClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
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

  if (loading) return <div>Loading...</div>
  if (!pool) return <div>Pool not found</div>

  /**
   * All four child components share this cache key so only ONE RPC batch
   * fires regardless of how many components mount simultaneously.
   *
   * Deployed pools key by contract address (C…).
   * Pending-deployment pools fall back to the DB UUID so components can still
   * display DB metadata while there is no on-chain state to read.
   */
  const cacheKey =
    pool.contract_address && pool.contract_address !== "pending_deployment"
      ? pool.contract_address
      : pool.id

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Button variant="ghost" className="mb-6" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left column: details + timeline + activity ──────────────── */}
          <div className="lg:col-span-2 space-y-6">
            <GroupDetails groupId={id} contractAddress={cacheKey} />
            {pool.type === "rotational" && (
              <RotationalTimelineContainer groupId={id} contractAddress={cacheKey} />
            )}
            <GroupActivity groupId={id} contractAddress={cacheKey} startLedger={0} />
          </div>

          {/* ── Right column: actions + members ──────────────────────────── */}
          <div className="space-y-6">
            <GroupActions
              groupId={id}
              poolAddress={pool.contract_address}
              poolType={pool.type}
              tokenAddress={pool.token_address}
              isPaused={isPaused}
              poolAdmin={poolAdmin}
              onPauseChange={refreshPoolState}
            />
            <GroupMembers groupId={id} contractAddress={cacheKey} />
          </div>
        </div>
      </main>
    </div>
  )
}
