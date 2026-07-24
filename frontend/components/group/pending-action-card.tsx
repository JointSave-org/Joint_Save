"use client"

import { useState, useEffect } from "react"
import { useStellar } from "@/components/web3-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { approveAction, getApprovalCount } from "@/hooks/useJointSaveContracts"
import { stellarAddress } from "@/utils/stellarAddress"

interface PendingActionCardProps {
  poolAddress: string
  action: any
  quorumSize: number
  onApproved: () => void
}

export function PendingActionCard({
  poolAddress,
  action,
  quorumSize,
  onApproved,
}: PendingActionCardProps) {
  const { address } = useStellar()
  const { toast } = useToast()
  const [approvals, setApprovals] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isApprovedByCurrentUser, setIsApprovedByCurrentUser] = useState(false)

  const fetchApprovals = async () => {
    try {
      const count = await getApprovalCount(poolAddress, action.hash)
      setApprovals(count)
      // This is a placeholder for checking if the current user has approved.
      // I will need to implement a way to get the list of approvers.
    } catch (error) {
      console.error("Error fetching approvals:", error)
    }
  }

  useEffect(() => {
    fetchApprovals()
  }, [poolAddress, action.hash])

  const handleApprove = async () => {
    if (!address) return
    setIsLoading(true)
    try {
      await approveAction(poolAddress, address, action.hash)
      toast({ title: "Action approved" })
      onApproved()
    } catch (error) {
      console.error("Error approving action:", error)
      toast({ title: "Error approving action", variant: "destructive" })
    }
    setIsLoading(false)
  }

  const handleExecute = async () => {
    // This is a placeholder for executing the action.
    // I will need to implement this.
  }

  const canExecute = approvals >= Math.ceil(quorumSize / 2)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{action.type}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Approvals: {approvals} of {quorumSize} ({Math.ceil(quorumSize / 2)} needed)
        </p>
        {/* I will need to decode and display action details here */}
      </CardContent>
      <CardFooter className="flex justify-end space-x-2">
        {!isApprovedByCurrentUser && (
          <Button onClick={handleApprove} disabled={isLoading}>
            Approve
          </Button>
        )}
        {canExecute && (
          <Button onClick={handleExecute} disabled={isLoading}>
            Execute
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
