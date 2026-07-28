"use client"

import { useEffect, useState, useCallback } from "react"
import { useStellar } from "@/components/web3-provider"
import { PendingActionWrapper } from "./pending-action-wrapper"
import { ActionType } from "@/lib/types"

interface AdminActionFromApi {
  id: string
  pool_id: string
  admin_address: string
  action_type: ActionType
  target_address: string | null
  metadata: Record<string, unknown>
  tx_hash: string | null
  action_hash: string | null
  created_at: string
}

interface PendingActionsListProps {
  poolId: string
  poolAddress: string
}

export function PendingActionsList({ poolId, poolAddress }: PendingActionsListProps) {
  const { address } = useStellar()
  const [actions, setActions] = useState<AdminActionFromApi[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchActions = useCallback(async () => {
    if (!address) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/admin/actions?poolId=${poolId}&callerAddress=${address}`)
      const { actions } = (await res.json()) as { actions: AdminActionFromApi[] }
      setActions(actions)
    } catch (error) {
      console.error("Error fetching actions:", error)
    }
    setIsLoading(false)
  }, [address, poolId])

  useEffect(() => {
    fetchActions()
  }, [fetchActions])

  const pendingActions = actions.filter((a) => !a.tx_hash && a.action_hash)

  if (isLoading) {
    return <p>Loading pending actions...</p>
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Pending Actions</h2>
      {pendingActions.length > 0 ? (
        pendingActions.map((action) => (
          <PendingActionWrapper
            key={action.id}
            poolAddress={poolAddress}
            action={action}
            onAction={fetchActions}
          />
        ))
      ) : (
        <p>No pending actions.</p>
      )}
    </div>
  )
}
