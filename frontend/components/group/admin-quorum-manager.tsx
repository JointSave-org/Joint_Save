"use client"

import { useState, useEffect } from "react"
import { useStellar } from "@/components/web3-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import {
  getAdminQuorum,
  setAdminQuorum,
  approveAction,
  getPendingAction,
  getApprovalCount,
} from "@/hooks/useJointSaveContracts"
import { PendingActionCard } from "./pending-action-card"
import { stellarAddress } from "@/utils/stellarAddress"

interface AdminQuorumManagerProps {
  poolAddress: string
  poolAdmin: string | null
}

export function AdminQuorumManager({ poolAddress, poolAdmin }: AdminQuorumManagerProps) {
  const { address } = useStellar()
  const { toast } = useToast()
  const [quorum, setQuorum] = useState<string[]>([])
  const [newAdmin, setNewAdmin] = useState("")
  const [pendingActions, setPendingActions] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const isPoolAdmin = address && poolAdmin && address === poolAdmin

  const fetchQuorum = async () => {
    if (!poolAddress) return
    try {
      const q = await getAdminQuorum(poolAddress)
      setQuorum(q)
    } catch (error) {
      console.error("Error fetching admin quorum:", error)
    }
  }

  const fetchPendingActions = async () => {
    // This is a placeholder. I will need to implement a way to get all pending actions.
    // For now, I will just leave it empty.
    setPendingActions([])
  }

  useEffect(() => {
    fetchQuorum()
    fetchPendingActions()
  }, [poolAddress])

  const handleAddAdmin = async () => {
    if (!newAdmin || !isPoolAdmin) return
    setIsLoading(true)
    try {
      const newQuorum = [...quorum, newAdmin]
      await setAdminQuorum(poolAddress, address!, newQuorum)
      setQuorum(newQuorum)
      setNewAdmin("")
      toast({ title: "Admin added to quorum" })
    } catch (error) {
      console.error("Error adding admin:", error)
      toast({ title: "Error adding admin", variant: "destructive" })
    }
    setIsLoading(false)
  }

  const handleRemoveAdmin = async (adminToRemove: string) => {
    if (!isPoolAdmin) return
    setIsLoading(true)
    try {
      const newQuorum = quorum.filter((a) => a !== adminToRemove)
      await setAdminQuorum(poolAddress, address!, newQuorum)
      setQuorum(newQuorum)
      toast({ title: "Admin removed from quorum" })
    } catch (error) {
      console.error("Error removing admin:", error)
      toast({ title: "Error removing admin", variant: "destructive" })
    }
    setIsLoading(false)
  }

  if (!isPoolAdmin) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin Quorum Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-semibold">Current Quorum</h3>
          {quorum.length > 0 ? (
            <ul className="list-disc list-inside">
              {quorum.map((admin) => (
                <li key={admin} className="flex items-center justify-between">
                  <span>{stellarAddress(admin)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveAdmin(admin)}
                    disabled={isLoading}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No admin quorum configured.</p>
          )}
        </div>

        <div>
          <h3 className="font-semibold">Add New Admin</h3>
          <div className="flex items-center space-x-2">
            <Input
              placeholder="Stellar Address"
              value={newAdmin}
              onChange={(e) => setNewAdmin(e.target.value)}
            />
            <Button onClick={handleAddAdmin} disabled={isLoading}>
              Add
            </Button>
          </div>
        </div>

        <div>
          <h3 className="font-semibold">Pending Actions</h3>
          {pendingActions.length > 0 ? (
            <div className="space-y-2">
              {pendingActions.map((action) => (
                <PendingActionCard
                  key={action.hash}
                  poolAddress={poolAddress}
                  action={action}
                  quorumSize={quorum.length}
                  onApproved={fetchPendingActions}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No pending actions.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
