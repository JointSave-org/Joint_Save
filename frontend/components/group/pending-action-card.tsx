"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Shield, ShieldOff,
  UserMinus, Wallet
} from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import {
  fetchApprovalCount,
  fetchActionTime,
  fetchApprovals,
  fetchAdminQuorum,
  useApproveAction,
  useRevokeApproval,
  useExecuteApproved,
} from "@/hooks/useJointSaveContracts"

interface PendingActionCardProps {
  poolAddress: string
  /** Hex-encoded action hash (32 bytes, 64 hex chars) */
  actionHash: string
  /** 1=pause, 2=unpause, 3=emergency_withdraw, 4=remove_member */
  actionType: number
  /** Human-readable label */
  actionLabel: string
  /** Target address (recipient for emergency_withdraw, member for remove_member) */
  target?: string
  /** Called after execution succeeds */
  onExecuted?: () => void
}

export function PendingActionCard({
  poolAddress,
  actionHash,
  actionType,
  actionLabel,
  target,
  onExecuted,
}: PendingActionCardProps) {
  const { address } = useStellar()
  const [approvalCount, setApprovalCount] = useState(0)
  const [approvers, setApprovers] = useState<string[]>([])
  const [quorumSize, setQuorumSize] = useState(0)
  const [createdAt, setCreatedAt] = useState(0)
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const approveHook = useApproveAction(poolAddress)
  const revokeHook = useRevokeApproval(poolAddress)
  const executeHook = useExecuteApproved(poolAddress)

  const PENDING_EXPIRY = 48 * 3600 // 48 hours in seconds

  const refresh = async () => {
    if (!poolAddress || !actionHash) return
    try {
      const [count, time, apprs, quorum] = await Promise.all([
        fetchApprovalCount(poolAddress, actionHash),
        fetchActionTime(poolAddress, actionHash),
        fetchApprovals(poolAddress, actionHash),
        fetchAdminQuorum(poolAddress),
      ])
      setApprovalCount(count)
      setCreatedAt(time)
      setApprovers(apprs)
      setQuorumSize(quorum.length)
      // Check expiry: if created_at + 48h < now (in ledger seconds)
      const nowSec = Math.floor(Date.now() / 1000)
      setExpired(time > 0 && nowSec - time > PENDING_EXPIRY)
    } catch {
      // action not found or already cleared
      setApprovalCount(0)
      setExpired(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [poolAddress, actionHash])

  const threshold = Math.ceil(quorumSize / 2)
  const progressPct = quorumSize > 0 ? (approvalCount / quorumSize) * 100 : 0
  const isQuorumMember = !!address && approvers.some(
    a => a.toUpperCase() === address.toUpperCase()
  )
  const inQuorum = !!address && quorumSize > 0

  const handleApprove = async () => {
    setError(""); setSuccess("")
    try {
      await approveHook.approve(actionHash)
      setSuccess("Approval recorded!")
      await refresh()
    } catch (e: any) {
      setError(e.message || "Approval failed")
    }
  }

  const handleRevoke = async () => {
    setError(""); setSuccess("")
    try {
      await revokeHook.revoke(actionHash)
      setSuccess("Approval revoked!")
      await refresh()
    } catch (e: any) {
      setError(e.message || "Revocation failed")
    }
  }

  const handleExecute = async () => {
    setError(""); setSuccess("")
    try {
      await executeHook.execute(
        actionHash,
        actionType,
        target || address || ""
      )
      setSuccess("Action executed successfully!")
      onExecuted?.()
    } catch (e: any) {
      setError(e.message || "Execution failed")
    }
  }

  const getActionIcon = () => {
    switch (actionType) {
      case 1: return <ShieldOff className="h-5 w-5 text-destructive" />
      case 2: return <Shield className="h-5 w-5 text-green-600" />
      case 3: return <Wallet className="h-5 w-5 text-destructive" />
      case 4: return <UserMinus className="h-5 w-5 text-destructive" />
      default: return <AlertTriangle className="h-5 w-5" />
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading pending action...
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {getActionIcon()}
          <div>
            <h4 className="font-semibold">{actionLabel}</h4>
            {target && (
              <p className="text-xs text-muted-foreground font-mono break-all">
                Target: {target}
              </p>
            )}
          </div>
        </div>
        <Badge
          variant={expired ? "destructive" : approvalCount >= threshold ? "default" : "secondary"}
        >
          {expired ? "Expired" : approvalCount >= threshold ? "Ready" : "Pending"}
        </Badge>
      </div>

      {error && (
        <div className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary mb-4">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm">{success}</p>
        </div>
      )}

      {/* Approval progress */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Approvals</span>
          <span className="font-medium">
            {approvalCount} / {quorumSize} (threshold: {threshold})
          </span>
        </div>
        <Progress value={progressPct} className="h-2" />
      </div>

      {/* Approvers list */}
      {approvers.length > 0 && (
        <div className="space-y-1 mb-4">
          <p className="text-xs text-muted-foreground">Approved by:</p>
          {approvers.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              <code className="text-xs text-muted-foreground break-all">{a}</code>
              {address && a.toUpperCase() === address.toUpperCase() && (
                <Badge className="text-xs">You</Badge>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expiry info */}
      {createdAt > 0 && !expired && (
        <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>
            Created {new Date(createdAt * 1000).toLocaleString()}
            {" · "}Expires in {Math.max(0, Math.floor((createdAt + PENDING_EXPIRY - Math.floor(Date.now() / 1000)) / 3600))}h
          </span>
        </div>
      )}

      {expired && createdAt > 0 && (
        <div className="flex items-center gap-2 mb-4 text-xs text-destructive">
          <XCircle className="h-3 w-3" />
          <span>This action has expired and can no longer be executed.</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {inQuorum && !expired && !isQuorumMember && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleApprove}
            disabled={approveHook.isLoading}
          >
            {approveHook.isLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Approving...</>
            ) : (
              <><CheckCircle2 className="mr-2 h-4 w-4" />Approve</>
            )}
          </Button>
        )}

        {isQuorumMember && !expired && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={handleRevoke}
            disabled={revokeHook.isLoading}
          >
            {revokeHook.isLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Revoking...</>
            ) : (
              <><XCircle className="mr-2 h-4 w-4" />Revoke My Approval</>
            )}
          </Button>
        )}

        {approvalCount >= threshold && !expired && (
          <Button
            size="sm"
            onClick={handleExecute}
            disabled={executeHook.isLoading}
          >
            {executeHook.isLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Executing...</>
            ) : (
              "Execute Action"
            )}
          </Button>
        )}
      </div>

      {!address && (
        <p className="text-xs text-muted-foreground mt-2">
          Connect your wallet to participate in approvals.
        </p>
      )}
    </Card>
  )
}