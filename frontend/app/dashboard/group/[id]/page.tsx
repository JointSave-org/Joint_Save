"use client"

import { use, useEffect, useState } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { GroupDetails } from "@/components/group/group-details"
import { GroupMembers } from "@/components/group/group-members"
import { GroupActivity } from "@/components/group/group-activity"
import { GroupActions } from "@/components/group/group-actions"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

interface Pool {
  id: string
  name: string
  type: 'rotational' | 'target' | 'flexible'
  contract_address: string
  token_address: string
  creator_address: string
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [pool, setPool] = useState<Pool | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
  }, [id])

  if (loading) return <div>Loading...</div>
  if (!pool) return <div>Pool not found</div>

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
            <GroupDetails groupId={id} />
            <GroupActivity
              groupId={id}
              contractId={pool.contract_address || undefined}
              startLedger={0}
            />
          </div>
          <div className="space-y-6">
            <GroupActions 
              groupId={id}
              poolAddress={pool.contract_address}
              poolType={pool.type}
              tokenAddress={pool.token_address}
              creatorAddress={pool.creator_address}
            />
            <GroupMembers groupId={id} />
          </div>
        </div>
      </main>
    </div>
  )
}