"use client"

import { useState, useEffect } from "react"
import type { FC } from "react"
import { useStellar } from "@/components/web3-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Calendar,
  TrendingUp,
  Users,
  Clock,
  RefreshCw,
  AlertTriangle,
  Copy,
  Check,
  CopyPlus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"
import Link from "next/link"
import {
  formatTokenAmount,
  RotationalPoolState,
  TargetPoolState,
  FlexiblePoolState,
  useBumpPoolState,
  ledgerToEstimatedDate,
  getRpc,
} from "@/hooks/useJointSaveContracts"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { useToast } from "@/hooks/use-toast"
import { useOptimisticTransactions } from "@/hooks/useOptimisticTransactions"
import { GroupMuteNotificationsToggle } from "@/components/group/GroupMuteNotificationsToggle"

interface GroupData {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: string
  description: string | null
  total_saved: number
  target_amount: number | null
  progress: number
  members_count: number
  next_payout: string | null
  next_recipient: string | null
  created_at: string
  contribution_amount: number | null
  minimum_deposit?: number | null
  frequency: string | null
  deadline: string | null
  contract_address: string
  token_symbol?: string
  token_decimals?: number
  members?: string[]
  pool_members?: { member_address: string }[]
}

interface GroupDetailsProps {
  groupId: string
  /** Contract address if already known — avoids a redundant /api/pools fetch */
  contractAddress?: string
  /** On-chain admin address — passed from the parent page after fetchPoolAdmin resolves */
  poolAdmin?: string | null
}

export function GroupDetails({ groupId, contractAddress, poolAdmin }: GroupDetailsProps) {
  const [copied, setCopied] = useState(false)
  const [currentLedger, setCurrentLedger] = useState<number | null>(null)
  const { toast } = useToast()
  const { address } = useStellar()
  const isAdmin = !!address && !!poolAdmin && address.toUpperCase() === poolAdmin.toUpperCase()

  // Use contract address as cache key when available; otherwise key on DB id.
  // The provider resolves DB data first, so the DB id key works fine too.
  const cacheKey =
    contractAddress && contractAddress !== "pending_deployment" ? contractAddress : groupId

  const { data, isLoading, isStale, isPaused, ttlDays, error, refetch } = usePoolData(cacheKey)
  const { optimisticState } = useOptimisticTransactions(cacheKey)
  const { bumpPoolState, isLoading: isBumping } = useBumpPoolState(
    (data?.db?.contract_address as string) || ""
  )

  const group = (data?.db ?? null) as GroupData | null

  useEffect(() => {
    getRpc()
      .getLatestLedger()
      .then((l) => setCurrentLedger(l.sequence))
      .catch(() => {})
  }, [])

  const handleExtendStorage = async () => {
    try {
      const txHash = await bumpPoolState()
      if (txHash) {
        toast({
          title: "Storage Extended!",
          description: "Pool storage lease has been successfully extended.",
        })
        refetch()
      } else {
        toast({
          title: "Failed to extend storage",
          description: "Could not extend storage. Please check your wallet connection.",
          variant: "destructive",
        })
      }
    } catch (err: unknown) {
      console.error("Extend storage error:", err)
      toast({
        title: "Error extending storage",
        description: (err as Error).message || "An unexpected error occurred.",
        variant: "destructive",
      })
    }
  }
  const onchainState = data?.onchain ?? null

  const isPending = (addr: string) => !addr || addr === "pending_deployment"
  const formatType = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

  const handleCopy = async () => {
    if (!group) return
    try {
      await navigator.clipboard.writeText(group.contract_address)
      setCopied(true)
      const { dismiss } = toast({
        title: "Copied!",
        description: "Contract address copied to clipboard.",
      })
      setTimeout(() => {
        setCopied(false)
        dismiss()
      }, 2000)
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please copy the address manually.",
        variant: "destructive",
      })
    }
  }

  if (isLoading && !group) {
    return (
      <Card className="p-6" aria-label="Loading group details">
        {/* header */}
        <div className="flex items-start justify-between mb-6">
          <div className="space-y-3">
            <Skeleton className="h-9 w-52" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>

        {/* description */}
        <Skeleton className="h-4 w-3/4 mb-6" />

        {/* stat tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-4 rounded-lg bg-muted/30 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>

        {/* progress bar area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
      </Card>
    )
  }

  if (error || !group) {
    return (
      <Card className="p-6 bg-destructive/10 text-destructive">
        <p>{error || "Group not found"}</p>
      </Card>
    )
  }

  // Token display metadata (persisted on the pool row; defaults to native XLM)
  const tokenSymbol: string = group.token_symbol ?? "XLM"
  const tokenDecimals: number = group.token_decimals ?? 7
  const fmt = (v: bigint) => formatTokenAmount(v, tokenDecimals)

  // ── Live stats (prefer onchain data over DB) ────────────────────────────────
  const getLiveStats = () => {
    const base: {
      icon: FC<{ className?: string }>
      label: string
      value: string | number
      isPending?: boolean
      isOptimistic?: boolean
    }[] = [{ icon: Users, label: "Members", value: group.members_count || 0 }]
    const { pendingTx } = optimisticState

    if (group.type === "rotational" && onchainState) {
      const s = onchainState as RotationalPoolState
      const nextPayout =
        s.nextPayoutTime > 0 ? new Date(s.nextPayoutTime * 1000).toLocaleDateString() : "N/A"
      base.unshift({
        icon: TrendingUp,
        label: "Round",
        value: `${s.currentRound + 1} / ${s.members.length || group.members_count}`,
      })
      base.push({ icon: Clock, label: "Next Payout", value: nextPayout })
      base.push({
        icon: Calendar,
        label: "Frequency",
        value: group.frequency || "N/A",
      })
    } else if (group.type === "target" && onchainState) {
      const s = onchainState as TargetPoolState
      let totalSavedDisplay = fmt(s.totalDeposited).toFixed(2)
      let isPendingValue = false

      // Apply optimistic deposit if pending
      if (
        pendingTx &&
        pendingTx.status === "pending" &&
        pendingTx.type === "deposit" &&
        pendingTx.amount
      ) {
        const optimistic = fmt(s.totalDeposited + pendingTx.amount)
        totalSavedDisplay = optimistic.toFixed(2)
        isPendingValue = true
      }

      base.unshift({
        icon: TrendingUp,
        label: "Total Saved",
        value: totalSavedDisplay,
        isPending: isPendingValue,
        isOptimistic: isPendingValue,
      })
      base.push({
        icon: Calendar,
        label: "Target",
        value: `${fmt(s.targetAmount).toFixed(2)} ${tokenSymbol}`,
      })
      let deadlineValue = "N/A"
      if (s.deadlineLedger && currentLedger) {
        const estimated = ledgerToEstimatedDate(s.deadlineLedger, currentLedger)
        deadlineValue = `${estimated.toLocaleDateString()} (ledger ${s.deadlineLedger.toLocaleString()})`
      } else if (group.deadline) {
        deadlineValue = new Date(group.deadline).toLocaleDateString()
      }
      base.push({ icon: Clock, label: "Deadline", value: deadlineValue })
    } else if (group.type === "flexible" && onchainState) {
      const s = onchainState as FlexiblePoolState
      let userBalanceDisplay = fmt(s.userBalance).toFixed(2)
      let isPendingValue = false

      // Apply optimistic changes
      if (pendingTx && pendingTx.status === "pending") {
        if (pendingTx.type === "deposit" && pendingTx.amount) {
          const optimistic = fmt(s.userBalance + pendingTx.amount)
          userBalanceDisplay = optimistic.toFixed(2)
          isPendingValue = true
        } else if (pendingTx.type === "withdraw" && pendingTx.amount) {
          const optimistic = fmt(s.userBalance - pendingTx.amount)
          userBalanceDisplay = optimistic.toFixed(2)
          isPendingValue = true
        }
      }

      base.unshift({
        icon: TrendingUp,
        label: "Total Balance",
        value: `${fmt(s.totalBalance).toFixed(2)} ${tokenSymbol}`,
      })
      base.push({
        icon: Clock,
        label: "Your Balance",
        value: userBalanceDisplay,
        isPending: isPendingValue,
        isOptimistic: isPendingValue,
      })
      base.push({
        icon: Calendar,
        label: "Status",
        value: s.isActive ? "Active" : "Inactive",
      })
    } else {
      // Fallback to DB data
      base.unshift({
        icon: TrendingUp,
        label: "Total Saved",
        value: `${(group.total_saved || 0).toFixed(2)} ${tokenSymbol}`,
      })
      if (group.type === "rotational") {
        base.push({
          icon: Clock,
          label: "Next Payout",
          value: group.next_payout || "N/A",
        })
        base.push({
          icon: Calendar,
          label: "Frequency",
          value: group.frequency || "N/A",
        })
      } else if (group.type === "target") {
        base.push({
          icon: Calendar,
          label: "Target",
          value: `${(group.target_amount || 0).toFixed(2)} ${tokenSymbol}`,
        })
        base.push({
          icon: Clock,
          label: "Deadline",
          value: group.deadline ? new Date(group.deadline).toLocaleDateString() : "N/A",
        })
      } else {
        base.push({ icon: Clock, label: "Status", value: group.status })
        base.push({
          icon: Calendar,
          label: "Created",
          value: new Date(group.created_at).toLocaleDateString(),
        })
      }
    }
    return base
  }

  const getProgress = () => {
    if (group.type === "target" && onchainState) {
      const s = onchainState as TargetPoolState
      const { pendingTx } = optimisticState

      let total = s.totalDeposited
      if (
        pendingTx &&
        pendingTx.status === "pending" &&
        pendingTx.type === "deposit" &&
        pendingTx.amount
      ) {
        total = s.totalDeposited + pendingTx.amount
      }

      if (s.targetAmount === 0n) return 0
      return Math.min(100, Number((total * 100n) / s.targetAmount))
    }
    return group.progress || 0
  }

  const getTargetDisplay = () => {
    if (group.type === "target" && onchainState) {
      const s = onchainState as TargetPoolState
      const { pendingTx } = optimisticState

      let saved = fmt(s.totalDeposited)
      if (
        pendingTx &&
        pendingTx.status === "pending" &&
        pendingTx.type === "deposit" &&
        pendingTx.amount
      ) {
        saved = fmt(s.totalDeposited + pendingTx.amount)
      }

      return { saved, target: fmt(s.targetAmount) }
    }
    return { saved: group.total_saved || 0, target: group.target_amount || 0 }
  }

  const stats = getLiveStats()
  const progress = getProgress()
  const targetDisplay = getTargetDisplay()

  const LOW_MEMBER_THRESHOLD = 2
  const hasLowMemberCount =
    group.type === "rotational" && (group.members_count ?? 0) <= LOW_MEMBER_THRESHOLD

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{group.name}</h1>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{formatType(group.type)}</Badge>
              <Badge className="bg-primary/10 text-primary hover:bg-primary/20">
                {group.status}
              </Badge>
              {onchainState && (
                <Badge variant="outline" className="text-xs">
                  Live onchain
                </Badge>
              )}
              {ttlDays !== null && (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    ttlDays < 7 ? "text-destructive border-destructive/40 bg-destructive/10" : ""
                  }`}
                >
                  State expires in {ttlDays} days
                </Badge>
              )}
              {isStale && !isLoading && (
                <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/40">
                  Stale
                </Badge>
              )}
              {optimisticState.pendingTx && optimisticState.pendingTx.status === "pending" && (
                <Badge
                  variant="outline"
                  className="text-xs text-yellow-600 border-yellow-600/40 bg-yellow-500/10"
                >
                  Pending…
                </Badge>
              )}
            </div>
          </div>
          {/* Manual refresh binds to provider refetch — no local state needed */}
          <Button
            variant="ghost"
            size="icon"
            onClick={refetch}
            disabled={isLoading}
            aria-label="Refresh pool data"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {group.description && <p className="text-muted-foreground mb-6">{group.description}</p>}

        {hasLowMemberCount && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 mb-4 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              This pool has very few members remaining — consider inviting more members or planning
              for a shorter cycle.
            </span>
          </div>
        )}

        {isPaused && !isPending(group.contract_address) && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>⚠️ Pool Paused — All deposits and withdrawals are currently disabled.</span>
          </div>
        )}

        {ttlDays !== null && ttlDays < 7 && !isPending(group.contract_address) && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-destructive/10 text-destructive mb-4 text-sm font-medium">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>
                ⚠️ Pool storage is expiring soon (less than 7 days remaining). Please extend its
                storage life.
              </span>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="shrink-0 self-start sm:self-auto"
              onClick={handleExtendStorage}
              disabled={isBumping}
            >
              {isBumping ? "Extending..." : "Extend Storage"}
            </Button>
          </div>
        )}

        {isPending(group.contract_address) && (
          <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 mb-4 text-sm">
            Contract pending deployment. Run <code>scripts/deploy.sh</code> and update the contract
            address.
          </div>
        )}

        {!isPending(group.contract_address) && (
          <div className="mb-4 p-2 rounded bg-muted/30 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground font-mono break-all min-w-0">
              Contract: {group.contract_address}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleCopy}
                aria-label="Copy contract address"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
        )}

        {!isPending(group.contract_address) && group.status !== "pending" && isAdmin && (() => {
          const memberAddresses = group.pool_members?.map((m) => m.member_address) ?? group.members ?? []
          const base = `/dashboard/create/${group.type}?duplicate=1`
            + `&name=${encodeURIComponent(group.name)}`
            + `&description=${encodeURIComponent(group.description || "")}`
            + `&members=${encodeURIComponent(JSON.stringify(memberAddresses))}`
            + `&token=${encodeURIComponent(group.token_symbol || "XLM")}`
          const typeParams =
            group.type === "rotational"
              ? `&amount=${group.contribution_amount || ""}&frequency=${encodeURIComponent(group.frequency || "weekly")}`
              : group.type === "target"
              ? `&targetAmount=${group.target_amount || ""}`
              : `&minimumDeposit=${group.minimum_deposit ?? group.contribution_amount ?? ""}`
          return (
            <div className="mb-4 space-y-2">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
                <CopyPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>
                  Starting a new cycle deploys a <strong>fresh, independent contract</strong> — the original pool is unaffected.
                </span>
              </div>
              <Button variant="outline" size="sm" className="w-full gap-2" asChild>
                <Link href={base + typeParams}>
                  <CopyPlus className="h-4 w-4" />
                  Start New Cycle / Duplicate Pool
                </Link>
              </Button>
            </div>
          )
        })()}

        {/* Per-pool notification mute (email only) */}
        <div className="mb-4">
          {/* pool_id in DB is the same as groupId route param */}
          <GroupMuteNotificationsToggle poolId={groupId} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {stats.map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: i * 0.1 }}
              className={`p-4 rounded-lg ${
                stat.isOptimistic
                  ? "bg-yellow-500/10 border-2 border-dashed border-yellow-500/50 opacity-75"
                  : "bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <stat.icon className="h-4 w-4" />
                <span className="text-sm">{stat.label}</span>
                {stat.isOptimistic && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-medium">
                    pending
                  </span>
                )}
              </div>
              <p
                className={`text-2xl font-bold ${stat.isOptimistic ? "text-yellow-700 dark:text-yellow-400" : ""}`}
              >
                {stat.value}
              </p>
            </motion.div>
          ))}
        </div>

        {group.type === "target" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress to Target</span>
              <span className="font-medium">
                {targetDisplay.saved.toFixed(2)} / {targetDisplay.target.toFixed(2)} {tokenSymbol}
                {optimisticState.pendingTx?.status === "pending" &&
                  optimisticState.pendingTx.type === "deposit" && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-medium">
                      pending
                    </span>
                  )}
              </span>
            </div>
            <Progress value={progress} className="h-3" />
            <p className="text-xs text-muted-foreground">
              {progress.toFixed(1)}% complete
              {optimisticState.pendingTx?.status === "pending" &&
                optimisticState.pendingTx.type === "deposit" && (
                  <span className="ml-2 text-yellow-600 dark:text-yellow-400">
                    (optimistic update in progress)
                  </span>
                )}
            </p>
          </div>
        )}
      </Card>
    </motion.div>
  )
}
