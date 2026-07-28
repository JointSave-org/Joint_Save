"use client"

import { useState } from "react"
import { useStellar } from "@/components/web3-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { useGetAdminQuorum, useSetAdminQuorum } from "@/hooks/useJointSaveContracts"
import { stellarAddress } from "@/utils/stellarAddress"
import { validateStellarAddress } from "@/lib/form-validation"

interface AdminQuorumManagerProps {
  poolAddress: string
  poolAdmin: string | null
}

export function AdminQuorumManager({ poolAddress, poolAdmin }: AdminQuorumManagerProps) {
  const { address } = useStellar()
  const { toast } = useToast()
  const { data: quorum, isLoading: isQuorumLoading, refetch } = useGetAdminQuorum(poolAddress)
  const { setAdminQuorum, isLoading: isSetQuorumLoading } = useSetAdminQuorum(poolAddress)
  const [newAdmin, setNewAdmin] = useState("")
  const [threshold, setThreshold] = useState(0)

  const isPoolAdmin = address && poolAdmin && address === poolAdmin

  const handleSetQuorum = async (newQuorum: string[]) => {
    if (!isPoolAdmin) return

    const newThreshold = threshold > 0 ? threshold : Math.ceil(newQuorum.length / 2)

    try {
      await setAdminQuorum(newQuorum, newThreshold)
      refetch()
      toast({ title: "Admin quorum updated" })
    } catch (_error) {
      toast({ title: "Error updating quorum", variant: "destructive" })
    }
  }

  const handleAddAdmin = async () => {
    if (!newAdmin || !isPoolAdmin) return

    const validation = validateStellarAddress(newAdmin.trim().toUpperCase())
    if (!validation.valid) {
      toast({ title: "Invalid Stellar Address", description: validation.message, variant: "destructive" })
      return
    }

    const newQuorum = [...(quorum || []), newAdmin.trim().toUpperCase()]
    await handleSetQuorum(newQuorum)
    setNewAdmin("")
  }

  const handleRemoveAdmin = async (adminToRemove: string) => {
    if (!isPoolAdmin) return
    const newQuorum = (quorum || []).filter((a) => a !== adminToRemove)
    await handleSetQuorum(newQuorum)
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
          {isQuorumLoading ? (
            <p className="text-muted-foreground">Loading quorum...</p>
          ) : quorum && quorum.length > 0 ? (
            <ul className="list-disc list-inside">
              {quorum.map((admin) => (
                <li key={admin} className="flex items-center justify-between">
                  <span>{stellarAddress(admin)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveAdmin(admin)}
                    disabled={isSetQuorumLoading}
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
            <Button onClick={handleAddAdmin} disabled={isSetQuorumLoading}>
              Add
            </Button>
          </div>
        </div>
        <div>
          <h3 className="font-semibold">Quorum Threshold</h3>
          <div className="flex items-center space-x-2">
            <Input
              type="number"
              placeholder="e.g. 2"
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
