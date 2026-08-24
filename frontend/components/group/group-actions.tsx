"use client"

import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { useState, useEffect, useCallback, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldOff,
  ShieldCheck,
  Clock,
  UserPlus,
  Trash2,
  LogOut,
} from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import {
  useRotationalDeposit,
  useTriggerPayout,
  useTargetContribute,
  useTargetWithdraw,
  useTargetRefund,
  useFlexibleDeposit,
  useFlexibleWithdraw,
  usePausePool,
  useUnpausePool,
  useAddPoolMember,
  useRemovePoolMember,
  useLeavePool,
  fetchRotationalState,
  fetchPoolMembers,
  buildContractCallTx,
} from "@/hooks/useJointSaveContracts"
import { simulateTransaction } from "@/lib/tx-simulator"
import { TxSimulationDialog } from "@/components/shared/tx-simulation-dialog"
import type { SimulationOutcome } from "@/lib/tx-simulator"
import { nativeToScVal } from "@stellar/stellar-sdk"
import { validateStellarAddress } from "@/lib/form-validation"
import { getTokenBySymbol, getTokenBalance, formatUsdApprox } from "@/lib/token-utils"
import { useOptimisticTransactions } from "@/hooks/useOptimisticTransactions"
import { toastManager } from "@/lib/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSearchParams } from "next/navigation"
import {
  findRecentPendingTransaction,
  pendingTransactionLabel,
  type PendingTransactionType,
} from "@/lib/pending-transactions"

interface GroupActionsProps {
  groupId: string
  poolAddress: string
  poolType: "rotational" | "target" | "flexible"
  tokenAddress: string
  creatorAddress?: string
  isPaused?: boolean
  poolAdmin?: string | null
  onPauseChange?: () => void
}

// ── E2E test seam ─────────────────────────────────────────────────────────────
// When NEXT_PUBLIC_E2E=true, skip the pre-flight simulation dialog and submit
// directly. Building + simulating a real tx requires a live Soroban RPC and a
// funded account, which Playwright runs stub out at the contract layer instead
// (see useJointSaveContracts.ts). Dead code in production — the flag is unset.
const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"

async function logActivity(
  poolId: string,
  type: string,
  userAddress: string,
  amount: string | null,
  txHash: string,
  memberAddress?: string
) {
  try {
    await fetch("/api/pools", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: poolId,
        activity: {
          activity_type: type,
          user_address: userAddress,
          amount: amount ? parseFloat(amount) : null,
          token_amount: amount ? parseFloat(amount) : null,
          tx_hash: txHash,
        },
        memberAddress: memberAddress || null,
      }),
    })
  } catch {}
}

/**
 * Record a deposit in Supabase only after the transaction hash is verified
 * as successful on Horizon (see app/api/pools/deposit/route.ts). Verification
 * is retried briefly since Horizon may lag a freshly confirmed ledger.
 */
async function verifyAndLogDeposit(
  poolId: string,
  userAddress: string,
  txHash: string,
  amount: string | null
) {
  const payload = {
    poolId,
    userAddress,
    txHash,
    amount: amount ? parseFloat(amount) : null,
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/pools/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) return
      if (res.status === 422) return // tx not on Horizon (yet) — tracker keeps watching
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt))
  }
}

/**
 * Fire-and-forget: send a push notification to pool members via the
 * server-side proxy endpoint. The client never touches CRON_SECRET —
 * the secret is added server-side in /api/notifications/push-event.
 */
async function triggerPushNotification(
  poolId: string,
  eventType: string,
  title: string,
  body: string
) {
  try {
    await fetch("/api/notifications/push-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pool_id: poolId, event_type: eventType, title, body }),
    })
  } catch {
    // Non-critical — never let push failure break the deposit flow.
  }
}

async function logAdminAction(
  poolId: string,
  adminAddress: string,
  actionType: string,
  targetAddress: string | null,
  txHash: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await fetch("/api/admin/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poolId,
        adminAddress,
        actionType,
        targetAddress,
        txHash,
        metadata: metadata || {},
      }),
    })
  } catch {}
}

function confirmRecentPendingTransaction(
  address: string | null,
  poolId: string,
  type: PendingTransactionType,
  confirmMessage: (label: string) => string
): boolean {
  if (!address) return true
  const recent = findRecentPendingTransaction(address, poolId, type)
  if (!recent) return true
  return window.confirm(confirmMessage(pendingTransactionLabel(type)))
}

export function GroupActions({
  groupId,
  poolAddress,
  poolType,
  tokenAddress: _tokenAddress,
  creatorAddress: _creatorAddress,
  isPaused = false,
  poolAdmin = null,
  onPauseChange,
}: GroupActionsProps) {
  const t = useTranslations("group.actions")
  const { address } = useStellar()
  const searchParams = useSearchParams()
  // Arriving from the onboarding wizard with ?highlight=deposit draws attention
  // to the deposit button and scrolls it into view.
  const highlightDeposit = searchParams.get("highlight") === "deposit"
  const depositButtonRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (highlightDeposit) {
      const timer = setTimeout(() => {
        depositButtonRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        })
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [highlightDeposit])

  const isAdmin = !!address && !!poolAdmin && address.toUpperCase() === poolAdmin.toUpperCase()
  const [depositAmount, setDepositAmount] = useState("")
  const [withdrawAmount, setWithdrawAmount] = useState("")

  // Pool metadata from Supabase
  const [poolData, setPoolData] = useState<Record<string, unknown> | null>(null)
  const [members, setMembers] = useState<string[]>([])
  const [newMember, setNewMember] = useState("")
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const isPending = !poolAddress || poolAddress === "pending_deployment"
  // Token display metadata (persisted on the pool row; defaults to native XLM)
  const tokenSymbol: string = (poolData?.token_symbol as string) ?? "XLM"
  const tokenDecimals: number = (poolData?.token_decimals as number) ?? 7
  const toBaseUnits = (amount: number) => BigInt(Math.round(amount * 10 ** tokenDecimals))

  // Wallet balance in the pool's deposit currency (for the deposit form) —
  // resolved via the token registry so both native XLM and USDC work.
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  useEffect(() => {
    if (!address) {
      setWalletBalance(null)
      return
    }
    let cancelled = false
    const token = getTokenBySymbol(tokenSymbol) ?? getTokenBySymbol("XLM")!
    setBalanceLoading(true)
    getTokenBalance(address, token)
      .then((bal) => {
        if (!cancelled) setWalletBalance(bal)
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [address, tokenSymbol])

  // Modal Preview states
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [isConfirmLoading, setIsConfirmLoading] = useState(false)
  const [previewData, setPreviewData] = useState<{
    type: "withdraw" | "payout"
    amount: number
    details: { label: string; value: string; isDeduction?: boolean }[]
    onConfirm: () => Promise<void>
  } | null>(null)

  // Simulation dialog state
  const [simOpen, setSimOpen] = useState(false)
  const [simOutcome, setSimOutcome] = useState<SimulationOutcome | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [simLabel, setSimLabel] = useState("Transaction")
  const pendingSimConfirmRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!groupId) return
    fetch(`/api/pools?id=${groupId}`)
      .then((res) => res.json())
      .then((data) => setPoolData(data))
      .catch(() => undefined)
  }, [groupId])

  const refreshMembers = useCallback(async () => {
    if (isPending || !isAdmin || !poolAddress) return
    const onchainMembers = await fetchPoolMembers(poolAddress)
    setMembers(onchainMembers)
  }, [isAdmin, isPending, poolAddress])

  useEffect(() => {
    void refreshMembers()
  }, [refreshMembers])

  const rotationalDeposit = useRotationalDeposit(poolAddress)
  const triggerPayout = useTriggerPayout(poolAddress)
  const targetContribute = useTargetContribute(poolAddress, depositAmount, tokenDecimals)
  const targetWithdraw = useTargetWithdraw(poolAddress)
  const targetRefund = useTargetRefund(poolAddress)
  const flexibleDeposit = useFlexibleDeposit(poolAddress, depositAmount, tokenDecimals)
  const flexibleWithdraw = useFlexibleWithdraw(poolAddress, withdrawAmount, tokenDecimals)
  const pausePool = usePausePool(poolAddress)
  const unpausePool = useUnpausePool(poolAddress)
  const addPoolMember = useAddPoolMember(poolAddress)
  const removePoolMember = useRemovePoolMember(poolAddress)
  const leavePool = useLeavePool(poolAddress)

  const { optimisticState, registerOptimistic, updateTxHash } =
    useOptimisticTransactions(poolAddress)

  // Watch for confirmation/failure from optimistic state
  useEffect(() => {
    const { pendingTx } = optimisticState
    if (!pendingTx) return

    if (pendingTx.status === "confirmed") {
      const txHash = pendingTx.txHash
      toastManager.success(
        t("confirmedSuffix", { type: pendingTx.type }),
        undefined,
        txHash
      )
      setDepositAmount("")
      setWithdrawAmount("")
    } else if (pendingTx.status === "failed") {
      toastManager.error(
        t("failedSuffix", { type: pendingTx.type, error: pendingTx.error || t("retryDefault") })
      )
    }
  }, [optimisticState])

  // ── Simulation helper ────────────────────────────────────────────────────
  const simulateAndShow = useCallback(
    async (
      label: string,
      txArgs: { method: string; args: ReturnType<typeof nativeToScVal>[] },
      onConfirm: () => Promise<void>
    ) => {
      if (!address) return toastManager.error(t("connectWalletFirst"))
      // E2E: the stubbed contract layer returns a canned tx hash without any
      // network, so there is nothing to simulate — run the submit path directly.
      if (IS_E2E) {
        await onConfirm()
        return
      }
      setSimLabel(label)
      setSimOutcome(null)
      setIsSimulating(true)
      setSimOpen(true)
      pendingSimConfirmRef.current = onConfirm
      try {
        const tx = await buildContractCallTx(address, poolAddress, txArgs.method, ...txArgs.args)
        const outcome = await simulateTransaction(tx)
        setSimOutcome(outcome)
      } catch {
        setSimOutcome({
          success: false,
          unavailable: true,
          error: "Network error",
          friendlyMessage: t("simulationUnavailable"),
        })
      } finally {
        setIsSimulating(false)
      }
    },
    [address, poolAddress, t]
  )

  const handleSimConfirm = useCallback(async () => {
    setSimOpen(false)
    if (pendingSimConfirmRef.current) {
      await pendingSimConfirmRef.current()
      pendingSimConfirmRef.current = null
    }
  }, [])

  const handleDeposit = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))
    if (isPaused) return toastManager.error(t("depositsDisabled"))
    if (
      !confirmRecentPendingTransaction(address, poolAddress, "deposit", (label) =>
        t("recentPendingConfirm", { type: label })
      )
    )
      return

    const depositArgs =
      poolType === "rotational"
        ? { method: "deposit", args: [nativeToScVal(address, { type: "address" })] }
        : {
            method: "deposit",
            args: [
              nativeToScVal(address, { type: "address" }),
              nativeToScVal(toBaseUnits(parseFloat(depositAmount)), { type: "i128" }),
            ],
          }

    await simulateAndShow(
      isRotational ? t("deposit") : isTarget ? t("contribute") : t("deposit"),
      depositArgs,
      async () => {
        const amount =
          poolType !== "rotational" ? toBaseUnits(parseFloat(depositAmount)) : undefined
        registerOptimistic("deposit", address, amount)

        let txHash: string | undefined
        if (poolType === "rotational") txHash = await rotationalDeposit.deposit()
        else if (poolType === "target") txHash = await targetContribute.contribute()
        else txHash = await flexibleDeposit.deposit()

        if (txHash) {
          updateTxHash(txHash)
          await verifyAndLogDeposit(groupId, address, txHash, depositAmount || null)
          void triggerPushNotification(
            groupId,
            "event_deposit",
            t("pushDepositTitle"),
            t("pushDepositBody", { amountSuffix: depositAmount ? ` ${depositAmount} ${tokenSymbol}` : "" })
          )
          toastManager.info(t("depositSubmitted"))
        }
      }
    )
  }

  const handleWithdrawClick = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))
    if (isPaused) return toastManager.error(t("withdrawalsDisabled"))

    if (poolType === "target") {
      if (
        !confirmRecentPendingTransaction(address, poolAddress, "withdraw", (label) =>
          t("recentPendingConfirm", { type: label })
        )
      )
        return
      await simulateAndShow(
        t("withdraw"),
        { method: "withdraw", args: [nativeToScVal(address, { type: "address" })] },
        async () => {
          registerOptimistic("withdraw", address)
          const txHash = await targetWithdraw.withdraw()
          if (txHash) {
            updateTxHash(txHash)
            await logActivity(groupId, "withdraw", address, null, txHash)
            toastManager.info(t("withdrawalSubmitted"))
          }
        }
      )
    } else {
      const amount = parseFloat(withdrawAmount)
      if (isNaN(amount) || amount <= 0) return toastManager.error(t("invalidWithdrawalAmount"))

      const feePercent = (poolData?.withdrawal_fee as number) ?? 0
      const feeAmount = amount * (feePercent / 100)
      const netAmount = amount - feeAmount

      await simulateAndShow(
        t("withdraw"),
        {
          method: "withdraw",
          args: [
            nativeToScVal(address, { type: "address" }),
            nativeToScVal(toBaseUnits(amount), { type: "i128" }),
          ],
        },
        async () => {
          setPreviewData({
            type: "withdraw",
            amount,
            details: [
              { label: t("withdrawAmountLabel"), value: `${amount.toFixed(2)} ${tokenSymbol}` },
              {
                label: t("withdrawalFeeLabel", { percent: feePercent }),
                value: `-${feeAmount.toFixed(2)} ${tokenSymbol}`,
                isDeduction: true,
              },
              {
                label: t("netAmountReceive"),
                value: `${netAmount.toFixed(2)} ${tokenSymbol}`,
              },
            ],
            onConfirm: async () => {
              if (
                !confirmRecentPendingTransaction(address, poolAddress, "withdraw", (label) =>
                  t("recentPendingConfirm", { type: label })
                )
              )
                return
              const amountStroops = toBaseUnits(amount)
              registerOptimistic("withdraw", address, amountStroops)
              const txHash = await flexibleWithdraw.withdraw()
              if (txHash) {
                updateTxHash(txHash)
                await logActivity(groupId, "withdraw", address, withdrawAmount || null, txHash)
                toastManager.info(t("withdrawalSubmitted"))
                setWithdrawAmount("")
              }
            },
          })
          setIsPreviewOpen(true)
        }
      )
    }
  }

  const handleTriggerPayoutClick = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))
    if (isPaused) return toastManager.error(t("payoutsDisabled"))

    await simulateAndShow(
      t("triggerPayout"),
      { method: "trigger_payout", args: [nativeToScVal(address, { type: "address" })] },
      async () => {
        setPreviewLoading(true)
        try {
          const state = await fetchRotationalState(poolAddress)

          if (state.treasuryFeeBps === null || state.relayerFeeBps === null) {
            toastManager.error(t("feeConfigError"))
            return
          }

          const treasuryFeeBps = state.treasuryFeeBps
          const relayerFeeBps = state.relayerFeeBps
          const depositCount = state.depositCount
          const currentRound = state.currentRound
          const members = state.members
          const beneficiary = members[currentRound] || t("unknownBeneficiary")

          const treasuryPercent = treasuryFeeBps / 100
          const relayerPercent = relayerFeeBps / 100

          const contribution = parseFloat((poolData?.contribution_amount as string) ?? "0")
          const totalCollected = contribution * depositCount
          const treasuryCut = totalCollected * (treasuryFeeBps / 10000)
          const relayerCut = totalCollected * (relayerFeeBps / 10000)
          const payoutAmount = totalCollected - treasuryCut - relayerCut

          const shortAddress = (addr: string) =>
            addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-6)}` : addr

          setPreviewData({
            type: "payout",
            amount: totalCollected,
            details: [
              {
                label: t("totalCollected"),
                value: t("totalCollectedDetail", {
                  total: totalCollected.toFixed(2),
                  symbol: tokenSymbol,
                  paid: depositCount,
                  members: members.length,
                }),
              },
              {
                label: t("treasuryFeeLabel", { percent: treasuryPercent }),
                value: `-${treasuryCut.toFixed(2)} ${tokenSymbol}`,
                isDeduction: true,
              },
              {
                label: t("relayerFeeLabel", { percent: relayerPercent }),
                value: `-${relayerCut.toFixed(2)} ${tokenSymbol}`,
                isDeduction: true,
              },
              {
                label: t("netRecipientPayout"),
                value: `${payoutAmount.toFixed(2)} ${tokenSymbol}`,
              },
              { label: t("beneficiaryAddress"), value: shortAddress(beneficiary) },
              {
                label: t("yourRelayerReward"),
                value: `${relayerCut.toFixed(2)} ${tokenSymbol}`,
              },
            ],
            onConfirm: async () => {
              if (
                !confirmRecentPendingTransaction(address, poolAddress, "trigger_payout", (label) =>
                  t("recentPendingConfirm", { type: label })
                )
              )
                return
              registerOptimistic("trigger_payout", address)
              const txHash = await triggerPayout.trigger()
              if (txHash) {
                updateTxHash(txHash)
                await logActivity(groupId, "payout", address, null, txHash)
                void triggerPushNotification(
                  groupId,
                  "event_payout",
                  t("pushPayoutTitle"),
                  t("pushPayoutBody")
                )
                toastManager.info(t("payoutSubmitted"))
              }
            },
          })
          setIsPreviewOpen(true)
        } catch (e: unknown) {
          const msg = (e as Error).message || t("failedToLoadPayoutDetails")
          toastManager.error(msg)
        } finally {
          setPreviewLoading(false)
        }
      }
    )
  }

  const handleRefund = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))
    if (
      !confirmRecentPendingTransaction(address, poolAddress, "withdraw", (label) =>
        t("recentPendingConfirm", { type: label })
      )
    )
      return
    await simulateAndShow(
      t("refund"),
      { method: "refund", args: [nativeToScVal(address, { type: "address" })] },
      async () => {
        registerOptimistic("withdraw", address)
        const txHash = await targetRefund.refund()
        if (txHash) {
          updateTxHash(txHash)
          await logActivity(groupId, "refund", address, null, txHash)
          toastManager.info(t("refundSubmitted"))
        }
      }
    )
  }

  const handlePause = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))
    await simulateAndShow(
      t("pausePool"),
      { method: "pause", args: [nativeToScVal(address, { type: "address" })] },
      async () => {
        const txHash = await pausePool.pause()
        if (txHash) {
          await logAdminAction(groupId, address, "pause", null, txHash)
          void triggerPushNotification(
            groupId,
            "event_paused",
            t("pushPausedTitle"),
            t("pushPausedBody")
          )
          toastManager.success(t("poolPausedSuccess"), undefined, txHash)
        }
        onPauseChange?.()
      }
    )
  }

  const handleUnpause = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))
    await simulateAndShow(
      t("unpausePool"),
      { method: "unpause", args: [nativeToScVal(address, { type: "address" })] },
      async () => {
        const txHash = await unpausePool.unpause()
        if (txHash) {
          await logAdminAction(groupId, address, "unpause", null, txHash)
          void triggerPushNotification(
            groupId,
            "event_paused",
            t("pushResumedTitle"),
            t("pushResumedBody")
          )
          toastManager.success(t("poolUnpausedSuccess"), undefined, txHash)
        }
        onPauseChange?.()
      }
    )
  }

  const handleAddMember = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (!isAdmin) return toastManager.error(t("onlyAdminCanManageMembers"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))

    const validation = validateStellarAddress(newMember.trim().toUpperCase())
    if (!validation.valid) return toastManager.error(validation.message)

    const memberAddr = newMember.trim().toUpperCase()
    await simulateAndShow(
      t("addMember"),
      {
        method: "add_member",
        args: [
          nativeToScVal(address, { type: "address" }),
          nativeToScVal(memberAddr, { type: "address" }),
        ],
      },
      async () => {
        const txHash = await addPoolMember.addMember(memberAddr)
        if (txHash) {
          await logActivity(groupId, "member_added", address, null, txHash, memberAddr)
          await logAdminAction(groupId, address, "add_member", memberAddr, txHash)
          void triggerPushNotification(
            groupId,
            "event_member_joined",
            t("pushMemberJoinedTitle"),
            t("pushMemberJoinedBody")
          )
          toastManager.success(t("memberAddedSuccess"), undefined, txHash)
          setNewMember("")
          await refreshMembers()
        }
      }
    )
  }

  const handleRemoveMember = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (!isAdmin) return toastManager.error(t("onlyAdminCanManageMembers"))
    if (isPending) return toastManager.error(t("contractNotDeployed"))
    if (!memberToRemove) return

    await simulateAndShow(
      t("removeMember"),
      {
        method: "remove_member",
        args: [
          nativeToScVal(address, { type: "address" }),
          nativeToScVal(memberToRemove, { type: "address" }),
        ],
      },
      async () => {
        const txHash = await removePoolMember.removeMember(memberToRemove)
        if (txHash) {
          await logActivity(groupId, "member_removed", address, null, txHash, memberToRemove)
          await logAdminAction(groupId, address, "remove_member", memberToRemove, txHash)
          void triggerPushNotification(
            groupId,
            "event_member_left",
            t("pushMemberRemovedTitle"),
            t("pushMemberRemovedBody")
          )
          toastManager.success(t("memberRemovedSuccess"), undefined, txHash)
          setMemberToRemove(null)
          await refreshMembers()
        }
      }
    )
  }

  const isDepositLoading =
    optimisticState.pendingTx?.type === "deposit" && optimisticState.pendingTx.status === "pending"
      ? true
      : poolType === "rotational"
        ? rotationalDeposit.isLoading
        : poolType === "target"
          ? targetContribute.isLoading
          : flexibleDeposit.isLoading

  const isWithdrawLoading =
    optimisticState.pendingTx?.type === "withdraw" && optimisticState.pendingTx.status === "pending"
      ? true
      : poolType === "target"
        ? targetWithdraw.isLoading
        : flexibleWithdraw.isLoading

  const isRotational = poolType === "rotational"
  const isTarget = poolType === "target"
  const isFlexible = poolType === "flexible"
  const actionsDisabled = isPaused || isPending || !address
  const formatAddress = (addr: string) =>
    addr.length > 18 ? `${addr.slice(0, 8)}...${addr.slice(-8)}` : addr

  // Helper to render pending badge
  const renderPendingBadge = () => {
    const { pendingTx } = optimisticState
    if (pendingTx && pendingTx.status === "pending") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-xs font-medium">
          <Clock className="h-3 w-3 animate-spin" />
          {t("pendingEllipsis")}
        </span>
      )
    }
    return null
  }

  return (
    <>
      {isPaused && (
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive mb-4 text-sm font-medium">
          {t("poolPausedBanner")}
        </div>
      )}

      {isPending && !isPaused && (
        <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 mb-4 text-sm">
          {t("contractPendingBanner")}
        </div>
      )}

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">
          {t("quickActions")} {renderPendingBadge()}
        </h3>

        {/* Skeleton while pool metadata is loading */}
        {!poolData && !isPending && (
          <div className="space-y-6" aria-label={t("loadingActionsAria")}>
            {/* deposit field + button */}
            <div className="space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* withdraw field + button */}
            <div className="border-t border-border pt-6 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            {/* admin controls */}
            <div className="border-t border-border pt-6 space-y-3">
              <Skeleton className="h-4 w-24" />
              <div className="flex gap-2">
                <Skeleton className="h-9 flex-1 rounded-md" />
                <Skeleton className="h-9 flex-1 rounded-md" />
              </div>
            </div>
          </div>
        )}

        {/* Actual form — shown once pool metadata resolves (or contract is pending) */}
        {(poolData || isPending) && (
          <div className="space-y-6">
            {/* Deposit / Contribute */}

            <div ref={depositButtonRef} className="space-y-3">
              {highlightDeposit && (
                <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/40 px-3 py-2 text-sm font-medium text-primary animate-pulse">
                  <ArrowUpRight className="h-4 w-4" />
                  {t("firstDepositHint")}
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label htmlFor="deposit">
                  {isRotational
                    ? t("depositFixedAmount")
                    : isTarget
                      ? t("contributeAmount", { symbol: tokenSymbol })
                      : t("depositAmount", { symbol: tokenSymbol })}
                </Label>
                {address &&
                  (balanceLoading ? (
                    <Skeleton className="h-3 w-24" />
                  ) : (
                    walletBalance !== null && (
                      <span className="text-xs text-muted-foreground">
                        {t("balance", { amount: walletBalance.toFixed(2), symbol: tokenSymbol })}
                      </span>
                    )
                  ))}
              </div>
              {!isRotational && (
                <Input
                  id="deposit"
                  type="number"
                  step="0.01"
                  placeholder="100"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  disabled={isDepositLoading || actionsDisabled}
                />
              )}
              {!isRotational && depositAmount && !isNaN(parseFloat(depositAmount)) && (
                <p className="text-xs text-muted-foreground">
                  {formatUsdApprox(
                    parseFloat(depositAmount),
                    getTokenBySymbol(tokenSymbol) ?? getTokenBySymbol("XLM")!
                  )}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {isRotational && t("rotationalDepositHint")}
                {isTarget && t("targetDepositHint")}
                {isFlexible && t("flexibleDepositHint")}
              </p>
              {tokenSymbol === "USDC" && address && walletBalance === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t.rich("noUsdcHint", {
                    link: (chunks) => (
                      <Link href="/bridge" className="text-primary hover:underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              )}
              <Button
                className={`w-full bg-primary hover:bg-primary/90 ${
                  highlightDeposit ? "ring-4 ring-primary/30 animate-pulse" : ""
                }`}
                onClick={handleDeposit}
                disabled={isDepositLoading || actionsDisabled}
              >
                {isDepositLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("processing")}
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    {isTarget ? t("contribute") : t("deposit")}
                  </>
                )}
              </Button>
            </div>

            {/* Withdraw */}
            {!isRotational && (
              <div className="border-t border-border pt-6 space-y-3">
                <Label htmlFor="withdraw">
                  {isTarget ? t("withdrawShare") : t("withdrawAmount", { symbol: tokenSymbol })}
                </Label>
                {isFlexible && (
                  <Input
                    id="withdraw"
                    type="number"
                    step="0.01"
                    placeholder="100"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    disabled={isWithdrawLoading || actionsDisabled}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {isTarget && t("targetWithdrawHint")}
                  {isFlexible && t("flexibleWithdrawHint")}
                </p>
                <Button
                  variant="outline"
                  className="w-full bg-transparent"
                  onClick={handleWithdrawClick}
                  disabled={isWithdrawLoading || actionsDisabled || (isFlexible && !withdrawAmount)}
                >
                  {isWithdrawLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("processing")}
                    </>
                  ) : (
                    <>
                      <ArrowDownLeft className="mr-2 h-4 w-4" />
                      {t("withdraw")}
                    </>
                  )}
                </Button>

                {isTarget && (
                  <Button
                    variant="ghost"
                    className="w-full text-destructive hover:text-destructive"
                    onClick={handleRefund}
                    disabled={targetRefund.isLoading || actionsDisabled}
                  >
                    {targetRefund.isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("processing")}
                      </>
                    ) : (
                      t("refundIfDeadlinePassed")
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Rotational payout trigger */}
            {isRotational && (
              <div className="border-t border-border pt-6 space-y-3">
                <p className="text-xs text-muted-foreground">{t("rotationalPayoutHint")}</p>
                <Button
                  variant="outline"
                  className="w-full bg-transparent"
                  onClick={handleTriggerPayoutClick}
                  disabled={
                    optimisticState.pendingTx?.type === "trigger_payout" ||
                    triggerPayout.isLoading ||
                    previewLoading ||
                    actionsDisabled
                  }
                >
                  {optimisticState.pendingTx?.type === "trigger_payout" ||
                  triggerPayout.isLoading ||
                  previewLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {previewLoading ? t("calculatingPreview") : t("processing")}
                    </>
                  ) : (
                    <>
                      <ArrowDownLeft className="mr-2 h-4 w-4" />
                      {t("triggerPayout")}
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Admin: Pause / Unpause */}
            {!isPending && (
              <div className="border-t border-border pt-6 space-y-3">
                <p className="text-xs text-muted-foreground font-medium">{t("adminControls")}</p>
                {!isAdmin && (
                  <p className="text-xs text-muted-foreground">{t("onlyAdminCanPause")}</p>
                )}
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-1">
                        <Button
                          variant="outline"
                          className="w-full bg-transparent text-destructive border-destructive/50 hover:bg-destructive/10 disabled:opacity-50"
                          onClick={handlePause}
                          disabled={pausePool.isLoading || !address || isPaused || !isAdmin}
                        >
                          {pausePool.isLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {t("pausing")}
                            </>
                          ) : (
                            <>
                              <ShieldOff className="mr-2 h-4 w-4" />
                              {t("pausePool")}
                            </>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!isAdmin && (
                      <TooltipContent>
                        {!address ? t("connectWalletToManage") : t("notPoolAdmin")}
                      </TooltipContent>
                    )}
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-1">
                        <Button
                          variant="outline"
                          className="w-full bg-transparent text-green-600 border-green-600/50 hover:bg-green-600/10 disabled:opacity-50"
                          onClick={handleUnpause}
                          disabled={unpausePool.isLoading || !address || !isPaused || !isAdmin}
                        >
                          {unpausePool.isLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {t("unpausing")}
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              {t("unpausePool")}
                            </>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!isAdmin && (
                      <TooltipContent>
                        {!address ? t("connectWalletToManage") : t("notPoolAdmin")}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </div>
              </div>
            )}

            {isAdmin && !isPending && (
              <div className="border-t border-border pt-6 space-y-4">
                <p className="text-xs text-muted-foreground font-medium">{t("manageMembers")}</p>
                <div className="space-y-2">
                  <Label htmlFor="new-member">{t("addStellarAddress")}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-member"
                      value={newMember}
                      onChange={(event) => setNewMember(event.target.value)}
                      placeholder="G..."
                      disabled={addPoolMember.isLoading || removePoolMember.isLoading}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddMember}
                      disabled={
                        addPoolMember.isLoading || removePoolMember.isLoading || !newMember.trim()
                      }
                      aria-label={t("addMemberAria")}
                    >
                      {addPoolMember.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {members.map((member) => (
                    <div
                      key={member}
                      className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                    >
                      <span className="text-xs font-mono break-all">{formatAddress(member)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setMemberToRemove(member)}
                        disabled={removePoolMember.isLoading || addPoolMember.isLoading}
                        aria-label={t("removeMemberAria", { member })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isAdmin && address && !isPending && (
              <div className="border-t border-border pt-6 space-y-3">
                <p className="text-xs text-muted-foreground font-medium">{t("leavePool")}</p>
                <Button
                  variant="outline"
                  className="w-full bg-transparent text-destructive border-destructive/50 hover:bg-destructive/10"
                  onClick={() => setShowLeaveDialog(true)}
                  disabled={leavePool.isLoading || isPaused}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {t("leavePool")}
                </Button>
              </div>
            )}

            <div className="border-t border-border pt-6">
              <p className="text-xs text-muted-foreground mb-2">{t("yourStellarAddress")}</p>
              <p className="text-sm font-mono bg-muted/30 p-2 rounded break-all">
                {address || t("notConnected")}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-[425px] bg-background border border-border">
          <DialogHeader>
            <DialogTitle>
              {previewData?.type === "withdraw"
                ? t("confirmWithdrawal")
                : t("confirmRotationalPayout")}
            </DialogTitle>
            <DialogDescription>
              {previewData?.type === "withdraw"
                ? t("withdrawalReviewDescription")
                : t("payoutReviewDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="rounded-lg border border-border p-4 bg-muted/20 space-y-3">
              {previewData?.details.map((detail, idx) => {
                const isLast = idx === previewData.details.length - 1
                return (
                  <div
                    key={idx}
                    className={`flex justify-between items-start gap-4 text-sm ${
                      isLast
                        ? "pt-3 border-t border-border font-semibold text-foreground text-base"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span>{detail.label}</span>
                    <span
                      className={`${
                        detail.isDeduction
                          ? "text-destructive font-medium"
                          : isLast
                            ? "text-primary font-bold"
                            : "text-foreground font-medium"
                      } break-all font-mono`}
                    >
                      {detail.value}
                    </span>
                  </div>
                )
              })}
            </div>

            {previewData?.type === "payout" && (
              <p className="text-xs text-muted-foreground text-center">{t("relayerRewardHint")}</p>
            )}

            {error && <p className="text-xs text-destructive text-center">{error}</p>}
            {successMsg && <p className="text-xs text-green-600 text-center">{successMsg}</p>}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsPreviewOpen(false)}
              disabled={isConfirmLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={async () => {
                setIsConfirmLoading(true)
                setError("")
                setSuccessMsg("")
                try {
                  if (previewData?.onConfirm) {
                    await previewData.onConfirm()
                  }
                  setIsPreviewOpen(false)
                } catch (e: unknown) {
                  setError((e as Error).message || t("transactionFailed"))
                  setIsPreviewOpen(false)
                } finally {
                  setIsConfirmLoading(false)
                }
              }}
              disabled={isConfirmLoading}
            >
              {isConfirmLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("signing")}
                </>
              ) : (
                t("confirmAndSign")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showLeaveDialog}
        onOpenChange={(open) => {
          if (!open) setShowLeaveDialog(false)
        }}
      >
        <DialogContent className="sm:max-w-[425px] bg-background border border-border">
          <DialogHeader>
            <DialogTitle>{t("leaveThisPool")}</DialogTitle>
            <DialogDescription>
              {poolType === "rotational" && t("leaveRotationalWarning")}
              {poolType === "target" && t("leaveTargetWarning")}
              {poolType === "flexible" && t("leaveFlexibleWarning")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowLeaveDialog(false)}
              disabled={leavePool.isLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!address) return
                setShowLeaveDialog(false)
                await simulateAndShow(
                  t("leavePool"),
                  { method: "leave_pool", args: [nativeToScVal(address, { type: "address" })] },
                  async () => {
                    setError("")
                    setSuccessMsg("")
                    try {
                      const txHash = await leavePool.leavePool()
                      if (txHash && address) {
                        await logActivity(groupId, "member_left", address, null, txHash)
                        setSuccessMsg(t("youHaveLeft"))
                      }
                    } catch (e: unknown) {
                      setError((e as Error).message || t("transactionFailed"))
                    }
                  }
                )
              }}
              disabled={leavePool.isLoading}
            >
              {leavePool.isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("leaving")}
                </>
              ) : (
                t("leavePool")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!memberToRemove}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null)
        }}
      >
        <DialogContent className="sm:max-w-[425px] bg-background border border-border">
          <DialogHeader>
            <DialogTitle>{t("removeMember")}</DialogTitle>
            <DialogDescription>
              {t("removeMemberDescription", { member: memberToRemove || t("thisAddress") })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setMemberToRemove(null)}
              disabled={removePoolMember.isLoading}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveMember}
              disabled={removePoolMember.isLoading}
            >
              {removePoolMember.isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("removing")}
                </>
              ) : (
                t("remove")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TxSimulationDialog
        open={simOpen}
        onOpenChange={setSimOpen}
        simulation={simOutcome}
        isSimulating={isSimulating}
        onConfirm={handleSimConfirm}
        txLabel={simLabel}
      />
    </>
  )
}
