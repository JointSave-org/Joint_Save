"use client"

import { useState } from "react"
import { AlertTriangle, Pause, Play, AlertOctagon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useStellarWallet } from "@/components/web3-provider"
import {
  signWalletProof,
  createProofTimestamp,
  type WalletProofMessage,
} from "@/lib/wallet-proof"

interface AdminEmergencyControlsProps {
  poolId: string
  poolAddress: string
  poolType: "rotational" | "target" | "flexible"
  isPaused: boolean
  isAdmin: boolean
  creatorAddress: string
  onStatusChange?: () => void
}

export function AdminEmergencyControls({
  poolId,
  poolAddress,
  poolType,
  isPaused,
  isAdmin,
  creatorAddress,
  onStatusChange,
}: AdminEmergencyControlsProps) {
  const { toast } = useToast()
  const { kit, address } = useStellarWallet()
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false)
  const [unpauseDialogOpen, setUnpauseDialogOpen] = useState(false)
  const [emergencyDialogOpen, setEmergencyDialogOpen] = useState(false)
  const [pauseReason, setPauseReason] = useState("")
  const [recipientAddress, setRecipientAddress] = useState(creatorAddress)
  const [loading, setLoading] = useState(false)

  if (!isAdmin || !address) {
    return null
  }

  const handlePause = async () => {
    if (!pauseReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for pausing the pool.",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    try {
      // Create wallet proof message
      const message: WalletProofMessage = {
        action: "pause",
        poolId,
        poolAddress,
        adminAddress: address,
        timestamp: createProofTimestamp(),
        reason: pauseReason,
      }

      // Sign the message with wallet
      const proof = await signWalletProof(kit, message)

      // Submit to API
      const response = await fetch(`/api/pools/${poolId}/admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pause",
          proof,
          reason: pauseReason,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to pause pool")
      }

      toast({
        title: "Pool Paused",
        description: "The pool has been paused successfully.",
      })

      setPauseDialogOpen(false)
      setPauseReason("")
      onStatusChange?.()
    } catch (error) {
      console.error("Pause error:", error)
      toast({
        title: "Pause Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleUnpause = async () => {
    setLoading(true)
    try {
      // Create wallet proof message
      const message: WalletProofMessage = {
        action: "unpause",
        poolId,
        poolAddress,
        adminAddress: address,
        timestamp: createProofTimestamp(),
      }

      // Sign the message with wallet
      const proof = await signWalletProof(kit, message)

      // Submit to API
      const response = await fetch(`/api/pools/${poolId}/admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unpause",
          proof,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to unpause pool")
      }

      toast({
        title: "Pool Resumed",
        description: "The pool has been resumed successfully.",
      })

      setUnpauseDialogOpen(false)
      onStatusChange?.()
    } catch (error) {
      console.error("Unpause error:", error)
      toast({
        title: "Unpause Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleEmergencyWithdraw = async () => {
    if (!recipientAddress.trim()) {
      toast({
        title: "Recipient Required",
        description: "Please provide a recipient address.",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    try {
      // Create wallet proof message
      const message: WalletProofMessage = {
        action: "emergency_withdraw",
        poolId,
        poolAddress,
        adminAddress: address,
        timestamp: createProofTimestamp(),
        recipient: recipientAddress,
      }

      // Sign the message with wallet
      const proof = await signWalletProof(kit, message)

      // Submit to API
      const response = await fetch(`/api/pools/${poolId}/admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "emergency_withdraw",
          proof,
          recipient: recipientAddress,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to execute emergency withdrawal")
      }

      toast({
        title: "Emergency Withdrawal Complete",
        description: `All funds have been transferred to ${recipientAddress}`,
      })

      setEmergencyDialogOpen(false)
      onStatusChange?.()
    } catch (error) {
      console.error("Emergency withdraw error:", error)
      toast({
        title: "Emergency Withdrawal Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {isPaused && (
        <Alert className="border-orange-500 bg-orange-50 dark:bg-orange-950/20">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertTitle className="text-orange-900 dark:text-orange-100">
            Pool Paused
          </AlertTitle>
          <AlertDescription className="text-orange-800 dark:text-orange-200">
            This pool is currently paused by the admin. No deposits or payouts can be processed.
          </AlertDescription>
        </Alert>
      )}

      <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950/20">
        <AlertOctagon className="h-4 w-4 text-blue-600" />
        <AlertTitle className="text-blue-900 dark:text-blue-100">
          Admin Emergency Controls
        </AlertTitle>
        <AlertDescription className="text-blue-800 dark:text-blue-200 space-y-3">
          <p>
            As the pool admin, you have access to emergency controls. These actions are logged and
            require wallet signature verification.
          </p>
          <div className="flex flex-wrap gap-2">
            {!isPaused ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPauseDialogOpen(true)}
                className="border-orange-500 text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-950"
              >
                <Pause className="mr-2 h-4 w-4" />
                Pause Pool
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setUnpauseDialogOpen(true)}
                className="border-green-500 text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-950"
              >
                <Play className="mr-2 h-4 w-4" />
                Resume Pool
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEmergencyDialogOpen(true)}
              className="border-red-500 text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-950"
            >
              <AlertOctagon className="mr-2 h-4 w-4" />
              Emergency Withdraw
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      {/* Pause Dialog */}
      <Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause Pool</DialogTitle>
            <DialogDescription>
              Pausing the pool will prevent all deposits and payouts. This action can be reversed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pause-reason">Reason for Pausing *</Label>
              <Textarea
                id="pause-reason"
                placeholder="Enter the reason for pausing this pool..."
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                rows={3}
              />
            </div>
            <Alert className="border-orange-500">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Your wallet will be asked to sign a message to verify this action.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseDialogOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handlePause} disabled={loading || !pauseReason.trim()}>
              {loading ? "Pausing..." : "Pause Pool"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unpause Dialog */}
      <Dialog open={unpauseDialogOpen} onOpenChange={setUnpauseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resume Pool</DialogTitle>
            <DialogDescription>
              Resuming the pool will allow deposits and payouts to continue normally.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Alert className="border-green-500">
              <Play className="h-4 w-4" />
              <AlertDescription>
                Your wallet will be asked to sign a message to verify this action.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnpauseDialogOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleUnpause} disabled={loading}>
              {loading ? "Resuming..." : "Resume Pool"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emergency Withdraw Dialog */}
      <Dialog open={emergencyDialogOpen} onOpenChange={setEmergencyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Emergency Withdrawal</DialogTitle>
            <DialogDescription>
              This will withdraw ALL funds from the pool and mark it as inactive. This action is IRREVERSIBLE.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Alert className="border-red-500 bg-red-50 dark:bg-red-950/20">
              <AlertOctagon className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-900 dark:text-red-100">Warning</AlertTitle>
              <AlertDescription className="text-red-800 dark:text-red-200">
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>All funds will be transferred to the recipient address</li>
                  <li>The pool will be marked as inactive permanently</li>
                  <li>This action CANNOT be undone</li>
                  <li>Use only in case of critical contract malfunction</li>
                </ul>
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label htmlFor="recipient">Recipient Address *</Label>
              <Input
                id="recipient"
                placeholder="G..."
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                The Stellar address that will receive all pool funds
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEmergencyDialogOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleEmergencyWithdraw}
              disabled={loading || !recipientAddress.trim()}
            >
              {loading ? "Processing..." : "Confirm Emergency Withdrawal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
