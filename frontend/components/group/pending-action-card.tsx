"use client"

import { useStellar } from "@/components/web3-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { useApproveAction, useExecuteAction } from "@/hooks/useJointSaveContracts"
import { stellarAddress } from "@/utils/stellarAddress"
import { PendingAction } from "@/lib/types"

interface PendingActionCardProps {
  poolAddress: string
  action: PendingAction
  onAction: () => void
}

export function PendingActionCard({ poolAddress, action, onAction }: PendingActionCardProps) {
  const { address } = useStellar()
  const { toast } = useToast()
  const approveActionHook = useApproveAction(poolAddress)
  const { executeAction, isLoading: isExecuteLoading } = useExecuteAction(poolAddress)

  const isApprovedByCurrentUser =
    address && action.approvals.map((a) => a.toUpperCase()).includes(address.toUpperCase())

  const handleApprove = async () => {
    try {
      await approveActionHook.approveAction(action.hash)
      toast({ title: "Action approved" })
      onAction()
    } catch (_error) {
      toast({ title: "Error approving action", variant: "destructive" })
    }
  }

  const handleExecute = async () => {
    try {
      await executeAction(action.hash, action.action_data)
      toast({ title: "Action executed" })
      onAction()
    } catch (_error) {
      toast({ title: "Error executing action", variant: "destructive" })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Pending Action: {action.type}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-semibold">Action Hash</h3>
          <p className="text-sm text-muted-foreground break-all">{action.hash}</p>
        </div>
        <div>
          <h3 className="font-semibold">Requested by</h3>
          <p className="text-sm text-muted-foreground break-all">{stellarAddress(action.requestedBy)}</p>
        </div>
        <div>
          <h3 className="font-semibold">Approvals</h3>
          {action.approvals.length > 0 ? (
            <ul className="list-disc list-inside">
              {action.approvals.map((approver) => (
                <li key={approver} className="text-sm">
                  {stellarAddress(approver)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No approvals yet.</p>
          )}
        </div>
        <div className="flex space-x-2">
          {!isApprovedByCurrentUser && (
            <Button onClick={handleApprove} disabled={approveActionHook.isLoading || !address}>
              {approveActionHook.isLoading ? "Approving..." : "Approve"}
            </Button>
          )}
          <Button onClick={handleExecute} disabled={isExecuteLoading || !address}>
            {isExecuteLoading ? "Executing..." : "Execute"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}