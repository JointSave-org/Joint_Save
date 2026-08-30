"use client"

import { use, useEffect, useState } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { GroupDetails } from "@/components/group/group-details"
import { GroupMembers } from "@/components/group/group-members"
import { GroupActivity } from "@/components/group/group-activity"
import { GroupActions } from "@/components/group/group-actions"
import { AdminEmergencyControls } from "@/components/group/admin-emergency-controls"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useStellarWallet } from "@/components/web3-provider"

interface Pool {
  id: string
  name: string
  type: 'rotational' | 'target' | 'flexible'
  status: 'active' | 'completed' | 'paused'
  contract_address: string
  token_address: string
  creator_address: string
  pause_reason?: string | null
  paused_at?: string | null
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { address } = useStellarWallet()
  const [pool, setPool] = useState<Pool | null>(null)
  const [loading, setLoading] = useState(true)

  const loadPool = () => {
    fetch(`/api/pools?id=${id}`)
      .then(res => res.json())
      .then(data => {
        setPool(data)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load pool:', err)
        setLoading(false)
      })
  }

  useEffect(() => {
    loadPool()
  }, [id])

  if (loading) return <div>Loading...</div>
  if (!pool) return <div>Pool not found</div>

  const isAdmin = address && pool.creator_address.toLowerCase() === address.toLowerCase()
  const isPaused = pool.status === 'paused'

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
          <div className="lg:col-span-2 space-y-6">
            {isAdmin && (
              <AdminEmergencyControls
                poolId={id}
                poolAddress={pool.contract_address}
                poolType={pool.type}
                isPaused={isPaused}
                isAdmin={isAdmin}
                creatorAddress={pool.creator_address}
                onStatusChange={loadPool}
              />
            )}
            <GroupDetails groupId={id} />
            <GroupActivity groupId={id} />
          </div>
          <div className="space-y-6">
            <GroupActions 
              groupId={id}
              poolAddress={pool.contract_address}
              poolType={pool.type}
              tokenAddress={pool.token_address}
            />
            <GroupMembers groupId={id} />
          </div>
        </div>
      </main>
    </div>
  )
}
