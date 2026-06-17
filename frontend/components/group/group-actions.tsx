"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, ArrowUpRight, ArrowDownLeft, AlertCircle, CheckCircle2, ShieldOff, ShieldCheck } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import {
  useRotationalDeposit, useTriggerPayout,
  useTargetContribute, useTargetWithdraw, useTargetRefund,
  useFlexibleDeposit, useFlexibleWithdraw,
  usePausePool, useUnpausePool,
} from "@/hooks/useJointSaveContracts"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface GroupActionsProps {
  groupId: string
  poolAddress: string
  poolType: "rotational" | "target" | "flexible"
  tokenAddress: string
  isPaused?: boolean
  poolAdmin?: string | null
  onPauseChange?: () => void
}

async function logActivity(poolId: string, type: string, userAddress: string, amount: string | null, txHash: string) {
  try {
    await fetch("/api/pools", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: poolId,
        activity: { activity_type: type, user_address: userAddress, amount: amount ? parseFloat(amount) : null, tx_hash: txHash },
      }),
    })
  } catch {}
}

export function GroupActions({ groupId, poolAddress, poolType, isPaused = false, poolAdmin = null, onPauseChange }: GroupActionsProps) {
  const { address } = useStellar()
  const isAdmin = !!address && !!poolAdmin && address.toUpperCase() === poolAdmin.toUpperCase()
  const [depositAmount, setDepositAmount] = useState("")
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  const rotationalDeposit = useRotationalDeposit(poolAddress)
  const triggerPayout = useTriggerPayout(poolAddress)
  const targetContribute = useTargetContribute(poolAddress, depositAmount)
  const targetWithdraw = useTargetWithdraw(poolAddress)
  const targetRefund = useTargetRefund(poolAddress)
  const flexibleDeposit = useFlexibleDeposit(poolAddress, depositAmount)
  const flexibleWithdraw = useFlexibleWithdraw(poolAddress, withdrawAmount)
  const pausePool = usePausePool(poolAddress)
  const unpausePool = useUnpausePool(poolAddress)

  const isPending = !poolAddress || poolAddress === "pending_deployment"

  const handleDeposit = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    if (isPaused) return setError("Pool is paused. Deposits are disabled.")
    try {
      let txHash: string | undefined
      if (poolType === "rotational") txHash = await rotationalDeposit.deposit()
      else if (poolType === "target") txHash = await targetContribute.contribute()
      else txHash = await flexibleDeposit.deposit()

      if (txHash) {
        await logActivity(groupId, "deposit", address, depositAmount || null, txHash)
        setSuccessMsg("Deposit successful!")
        setDepositAmount("")
      }
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const handleWithdraw = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    if (isPaused) return setError("Pool is paused. Withdrawals are disabled.")
    try {
      let txHash: string | undefined
      if (poolType === "target") txHash = await targetWithdraw.withdraw()
      else txHash = await flexibleWithdraw.withdraw()

      if (txHash) {
        await logActivity(groupId, "withdraw", address, withdrawAmount || null, txHash)
        setSuccessMsg("Withdrawal successful!")
        setWithdrawAmount("")
      }
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const handleTriggerPayout = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    if (isPaused) return setError("Pool is paused. Payouts are disabled.")
    try {
      const txHash = await triggerPayout.trigger()
      if (txHash) {
        await logActivity(groupId, "payout", address, null, txHash)
        setSuccessMsg("Payout triggered!")
      }
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const handleRefund = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    try {
      const txHash = await targetRefund.refund()
      if (txHash) {
        await logActivity(groupId, "refund", address, null, txHash)
        setSuccessMsg("Refund initiated!")
      }
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const handlePause = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    try {
      await pausePool.pause()
      setSuccessMsg("Pool paused successfully.")
      onPauseChange?.()
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const handleUnpause = async () => {
    setError(""); setSuccessMsg("")
    if (!address) return setError("Please connect your wallet first")
    if (isPending) return setError("Contract not yet deployed.")
    try {
      await unpausePool.unpause()
      setSuccessMsg("Pool unpaused successfully.")
      onPauseChange?.()
    } catch (e: any) { setError(e.message || "Transaction failed") }
  }

  const isDepositLoading =
    poolType === "rotational" ? rotationalDeposit.isLoading
    : poolType === "target" ? targetContribute.isLoading
    : flexibleDeposit.isLoading

  const isWithdrawLoading = poolType === "target" ? targetWithdraw.isLoading : flexibleWithdraw.isLoading
  const isRotational = poolType === "rotational"
  const isTarget = poolType === "target"
  const isFlexible = poolType === "flexible"
  const actionsDisabled = isPaused || isPending || !address

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>

      {error && (
        <div className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {successMsg && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary mb-4">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">{successMsg}</p>
        </div>
      )}

      {isPaused && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive mb-4 text-sm font-medium">
          ⚠️ Pool is paused — all transactions are disabled.
        </div>
      )}

      {isPending && !isPaused && (
        <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 mb-4 text-sm">
          Contract pending deployment.
        </div>
      )}

      <div className="space-y-6">
        {/* Deposit / Contribute */}
        <div className="space-y-3">
          <Label htmlFor="deposit">
            {isRotational ? "Deposit Fixed Amount" : isTarget ? "Contribute Amount (XLM)" : "Deposit Amount (XLM)"}
          </Label>
          {!isRotational && (
            <Input id="deposit" type="number" step="0.01" placeholder="100"
              value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
              disabled={isDepositLoading || actionsDisabled} />
          )}
          <p className="text-xs text-muted-foreground">
            {isRotational && "Deposit the fixed pool amount. Same for all members."}
            {isTarget && "Contribute any amount toward the target goal."}
            {isFlexible && "Deposit any amount (must meet minimum). Withdraw anytime."}
          </p>
          <Button className="w-full bg-primary hover:bg-primary/90" onClick={handleDeposit}
            disabled={isDepositLoading || actionsDisabled}>
            {isDepositLoading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
              : <><ArrowUpRight className="mr-2 h-4 w-4" />{isTarget ? "Contribute" : "Deposit"}</>}
          </Button>
        </div>

        {/* Withdraw */}
        {!isRotational && (
          <div className="border-t border-border pt-6 space-y-3">
            <Label htmlFor="withdraw">{isTarget ? "Withdraw Share" : "Withdraw Amount (XLM)"}</Label>
            {isFlexible && (
              <Input id="withdraw" type="number" step="0.01" placeholder="100"
                value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={isWithdrawLoading || actionsDisabled} />
            )}
            <p className="text-xs text-muted-foreground">
              {isTarget && "Withdraw after target reached. Exit fee deducted."}
              {isFlexible && "Withdraw anytime. Exit fee will be deducted."}
            </p>
            <Button variant="outline" className="w-full bg-transparent" onClick={handleWithdraw}
              disabled={isWithdrawLoading || actionsDisabled || (isFlexible && !withdrawAmount)}>
              {isWithdrawLoading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                : <><ArrowDownLeft className="mr-2 h-4 w-4" />Withdraw</>}
            </Button>

            {isTarget && (
              <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={handleRefund}
                disabled={targetRefund.isLoading || !address || isPending}>
                {targetRefund.isLoading
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                  : "Refund (if deadline passed)"}
              </Button>
            )}
          </div>
        )}

        {/* Rotational payout trigger */}
        {isRotational && (
          <div className="border-t border-border pt-6 space-y-3">
            <p className="text-xs text-muted-foreground">
              Rotational Pool: Payouts are triggered when the round time is reached. You earn a relayer fee for triggering.
            </p>
            <Button variant="outline" className="w-full bg-transparent" onClick={handleTriggerPayout}
              disabled={triggerPayout.isLoading || actionsDisabled}>
              {triggerPayout.isLoading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                : <><ArrowDownLeft className="mr-2 h-4 w-4" />Trigger Payout</>}
            </Button>
          </div>
        )}

        {/* Admin: Pause / Unpause */}
        {!isPending && (
          <div className="border-t border-border pt-6 space-y-3">
            <p className="text-xs text-muted-foreground font-medium">Admin Controls</p>
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">
                Only the pool admin can pause or unpause this pool.
              </p>
            )}
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1">
                    <Button variant="outline" className="w-full bg-transparent text-destructive border-destructive/50 hover:bg-destructive/10 disabled:opacity-50"
                      onClick={handlePause} disabled={pausePool.isLoading || !address || isPaused || !isAdmin}>
                      {pausePool.isLoading
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Pausing...</>
                        : <><ShieldOff className="mr-2 h-4 w-4" />Pause Pool</>}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!isAdmin && (
                  <TooltipContent>
                    {!address ? "Connect your wallet to manage this pool" : "Your wallet is not the pool admin"}
                  </TooltipContent>
                )}
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1">
                    <Button variant="outline" className="w-full bg-transparent text-green-600 border-green-600/50 hover:bg-green-600/10 disabled:opacity-50"
                      onClick={handleUnpause} disabled={unpausePool.isLoading || !address || !isPaused || !isAdmin}>
                      {unpausePool.isLoading
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Unpausing...</>
                        : <><ShieldCheck className="mr-2 h-4 w-4" />Unpause Pool</>}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!isAdmin && (
                  <TooltipContent>
                    {!address ? "Connect your wallet to manage this pool" : "Your wallet is not the pool admin"}
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-6">
          <p className="text-xs text-muted-foreground mb-2">Your Stellar address</p>
          <p className="text-sm font-mono bg-muted/30 p-2 rounded break-all">
            {address || "Not connected"}
          </p>
        </div>
      </div>
    </Card>
  )
}
