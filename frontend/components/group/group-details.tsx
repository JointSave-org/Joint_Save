"use client"

import { useState, useEffect } from "react"
import type { FC } from "react"
import { useTranslations } from "next-intl"
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
  Share2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"
import { Link } from "@/i18n/navigation"
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
import { KNOWN_CONTRACT_VERSIONS } from "@/lib/constants"
import { isContractVersionUnknown } from "@/lib/contract-version"
import { useToast } from "@/hooks/use-toast"
import { useOptimisticTransactions } from "@/hooks/useOptimisticTransactions"
import { GroupMuteNotificationsToggle } from "@/components/group/GroupMuteNotificationsToggle"

const FREQUENCY_KEYS = ["daily", "weekly", "biweekly", "monthly"] as const

function VersionWarning({
  onchainState,
  poolType,
}: {
  onchainState: RotationalPoolState | TargetPoolState | FlexiblePoolState
  poolType: string
}) {
  const t = useTranslations("group.details")
  if (!(poolType in KNOWN_CONTRACT_VERSIONS)) return null
  const cv = (onchainState as { contractVersion?: number | null }).contractVersion
  if (
    isContractVersionUnknown(
      cv ?? null,
      KNOWN_CONTRACT_VERSIONS[poolType as keyof typeof KNOWN_CONTRACT_VERSIONS]
    )
  ) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 mb-4 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>{t("versionWarning", { version: cv })}</span>
      </div>
    )
  }
  return null
}

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
  // Intentionally narrowed to only the fields this component uses.
  // The /api/pools response includes additional columns (id, user_address,
  // amount, created_at, tx_hash) that are not needed here.
  pool_activity?: { activity_type: string; description: string | null }[]
  creator_address?: string
}

interface GroupDetailsProps {
  groupId: string
  /** Contract address if already known — avoids a redundant /api/pools fetch */
  contractAddress?: string
  /** On-chain admin address — passed from the parent page after fetchPoolAdmin resolves */
  poolAdmin?: string | null
}

export function GroupDetails({ groupId, contractAddress, poolAdmin }: GroupDetailsProps) {
  const t = useTranslations("group.details")
  const tPool = useTranslations("pool")
  const tFrequency = useTranslations("pool.create.rotational.frequency")
  const [copied, setCopied] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState(false)
  const [currentLedger, setCurrentLedger] = useState<number | null>(null)
  const { toast } = useToast()
  const { address } = useStellar()
  const isAdmin = !!address && !!poolAdmin && address.toUpperCase() === poolAdmin.toUpperCase()

  const frequencyLabel = (freq: string | null): string => {
    if (!freq) return t("notAvailable")
    return (FREQUENCY_KEYS as readonly string[]).includes(freq)
      ? tFrequency(freq as (typeof FREQUENCY_KEYS)[number])
      : freq
  }

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
  const isCreator =
    !!address &&
    !!group?.creator_address &&
    address.toLowerCase() === group.creator_address.toLowerCase()

  // The auto-trigger-payouts cron marks its activity rows with this marker
  // (see supabase/functions/cron/auto-trigger-payouts) — its presence means
  // the cron has successfully run for this pool at least once.
  const hasAutoTrigger =
    group?.type === "rotational" &&
    (group?.pool_activity ?? []).some((a) => a.description?.includes("auto_trigger_payout"))

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
          title: t("storageExtended"),
          description: t("storageExtendedDescription"),
        })
        refetch()
      } else {
        toast({
          title: t("extendStorageFailed"),
          description: t("extendStorageFailedDescription"),
          variant: "destructive",
        })
      }
    } catch (err: unknown) {
      console.error("Extend storage error:", err)
      toast({
        title: t("extendStorageError"),
        description: (err as Error).message || t("unexpectedError"),
        variant: "destructive",
      })
    }
  }
  const onchainState = data?.onchain ?? null

  const isPending = (addr: string) => !addr || addr === "pending_deployment"

  const handleCopy = async () => {
    if (!group) return
    try {
      await navigator.clipboard.writeText(group.contract_address)
      setCopied(true)
      const { dismiss } = toast({
        title: t("copiedTitle"),
        description: t("copiedDescription"),
      })
      setTimeout(() => {
        setCopied(false)
        dismiss()
      }, 2000)
    } catch {
      toast({
        title: t("copyFailedTitle"),
        description: t("copyFailedDescription"),
        variant: "destructive",
      })
    }
  }

  const handleShareInvite = async () => {
    if (!group) return
    try {
      const inviteUrl = `${window.location.origin}/join/${group.contract_address}`
      await navigator.clipboard.writeText(inviteUrl)
      setCopiedInvite(true)
      const { dismiss } = toast({
        title: t("linkCopiedTitle"),
        description: t("linkCopiedDescription"),
      })
      setTimeout(() => {
        setCopiedInvite(false)
        dismiss()
      }, 2000)
    } catch {
      toast({
        title: t("copyFailedTitle"),
        description: t("copyInviteFailedDescription"),
        variant: "destructive",
      })
    }
  }

  if (isLoading && !group) {
    return (
      <Card className="p-6" aria-label={t("loadingLabel")}>
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
        <p>{error || t("groupNotFound")}</p>
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
    }[] = [{ icon: Users, label: t("membersLabel"), value: group.members_count || 0 }]
    const { pendingTx } = optimisticState

    if (group.type === "rotational" && onchainState) {
      const s = onchainState as RotationalPoolState
      const nextPayout =
        s.nextPayoutTime > 0
          ? new Date(s.nextPayoutTime * 1000).toLocaleDateString()
          : t("notAvailable")
      base.unshift({
        icon: TrendingUp,
        label: t("round"),
        value: `${s.currentRound + 1} / ${s.members.length || group.members_count}`,
      })
      base.push({ icon: Clock, label: t("nextPayout"), value: nextPayout })
      base.push({
        icon: Calendar,
        label: t("frequency"),
        value: frequencyLabel(group.frequency),
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
        label: t("totalSaved"),
        value: totalSavedDisplay,
        isPending: isPendingValue,
        isOptimistic: isPendingValue,
      })
      base.push({
        icon: Calendar,
        label: t("target"),
        value: `${fmt(s.targetAmount).toFixed(2)} ${tokenSymbol}`,
      })
      let deadlineValue = t("notAvailable")
      if (s.deadlineLedger && currentLedger) {
        const estimated = ledgerToEstimatedDate(s.deadlineLedger, currentLedger)
        deadlineValue = `${estimated.toLocaleDateString()} (ledger ${s.deadlineLedger.toLocaleString()})`
      } else if (group.deadline) {
        deadlineValue = new Date(group.deadline).toLocaleDateString()
      }
      base.push({ icon: Clock, label: t("deadline"), value: deadlineValue })
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
        label: t("totalBalance"),
        value: `${fmt(s.totalBalance).toFixed(2)} ${tokenSymbol}`,
      })
      base.push({
        icon: Clock,
        label: t("yourBalance"),
        value: userBalanceDisplay,
        isPending: isPendingValue,
        isOptimistic: isPendingValue,
      })
      base.push({
        icon: Calendar,
        label: t("status"),
        value: s.isActive ? t("active") : t("inactive"),
      })
    } else {
      // Fallback to DB data
      base.unshift({
        icon: TrendingUp,
        label: t("totalSaved"),
        value: `${(group.total_saved || 0).toFixed(2)} ${tokenSymbol}`,
      })
      if (group.type === "rotational") {
        base.push({
          icon: Clock,
          label: t("nextPayout"),
          value: group.next_payout || t("notAvailable"),
        })
        base.push({
          icon: Calendar,
          label: t("frequency"),
          value: frequencyLabel(group.frequency),
        })
      } else if (group.type === "target") {
        base.push({
          icon: Calendar,
          label: t("target"),
          value: `${(group.target_amount || 0).toFixed(2)} ${tokenSymbol}`,
        })
        base.push({
          icon: Clock,
          label: t("deadline"),
          value: group.deadline ? new Date(group.deadline).toLocaleDateString() : t("notAvailable"),
        })
      } else {
        base.push({ icon: Clock, label: t("status"), value: tPool(`status.${group.status}`) })
        base.push({
          icon: Calendar,
          label: t("created"),
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

  const duplicateMemberAddresses =
    group.pool_members?.map((m) => m.member_address) ?? group.members ?? []
  let duplicateTypeParams = ""
  if (group.type === "rotational") {
    duplicateTypeParams = `&amount=${group.contribution_amount || ""}&frequency=${encodeURIComponent(group.frequency || "weekly")}`
  } else if (group.type === "target") {
    duplicateTypeParams = `&targetAmount=${group.target_amount || ""}`
  } else {
    duplicateTypeParams = `&minimumDeposit=${group.minimum_deposit ?? group.contribution_amount ?? ""}`
  }
  const duplicateHref =
    `/dashboard/create/${group.type}?duplicate=1` +
    `&name=${encodeURIComponent(group.name)}` +
    `&description=${encodeURIComponent(group.description || "")}` +
    `&members=${encodeURIComponent(JSON.stringify(duplicateMemberAddresses))}` +
    `&token=${encodeURIComponent(group.token_symbol || "XLM")}` +
    duplicateTypeParams

  const showDuplicateButton =
    !isPending(group.contract_address) && group.status !== "pending" && isAdmin

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
              <Badge variant="secondary" aria-label={"Pool type: " + tPool(`type.${group.type}`)}>
                {tPool(`type.${group.type}`)}
              </Badge>
              <Badge className="bg-primary/10 text-primary hover:bg-primary/20" aria-label={"Pool status: " + tPool(`status.${group.status}`)}>
                {tPool(`status.${group.status}`)}
              </Badge>
              {onchainState && (
                <Badge variant="outline" className="text-xs" aria-label="Status: Live onchain">
                  {t("liveOnchain")}
                </Badge>
              )}
              {hasAutoTrigger && (
                <Badge variant="outline" className="text-xs text-blue-600 border-blue-400" aria-label="Status: Auto-trigger enabled">
                  {t("autoTriggerEnabled")}
                </Badge>
              )}
              {ttlDays !== null && (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    ttlDays < 7 ? "text-destructive border-destructive/40 bg-destructive/10" : ""
                  }`}
                  aria-label={`State expires in ${ttlDays} days`}
                >
                  {t("stateExpiresIn", { days: ttlDays })}
                </Badge>
              )}
              {isStale && !isLoading && (
                <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/40" aria-label="Status: Stale data">
                  {t("stale")}
                </Badge>
              )}
              {optimisticState.pendingTx && optimisticState.pendingTx.status === "pending" && (
                <Badge
                  variant="outline"
                  className="text-xs text-yellow-600 border-yellow-600/40 bg-yellow-500/10"
                  aria-label="Status: Transaction pending"
                >
                  {t("pendingEllipsis")}
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
            aria-label={t("refreshAria")}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {group.description && <p className="text-muted-foreground mb-6">{group.description}</p>}

        {hasLowMemberCount && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 mb-4 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{t("lowMemberWarning")}</span>
          </div>
        )}

        {isPaused && !isPending(group.contract_address) && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{t("poolPausedWarning")}</span>
          </div>
        )}

        {ttlDays !== null && ttlDays < 7 && !isPending(group.contract_address) && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-destructive/10 text-destructive mb-4 text-sm font-medium">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{t("storageExpiringWarning")}</span>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="shrink-0 self-start sm:self-auto"
              onClick={handleExtendStorage}
              disabled={isBumping}
            >
              {isBumping ? t("extending") : t("extendStorage")}
            </Button>
          </div>
        )}

        {isPending(group.contract_address) && (
          <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 mb-4 text-sm">
            {t.rich("pendingDeployment", { code: (chunks) => <code>{chunks}</code> })}
          </div>
        )}

        {!isPending(group.contract_address) && onchainState && (
          <VersionWarning onchainState={onchainState} poolType={group.type} />
        )}

        {!isPending(group.contract_address) && (
          <div className="mb-4 p-2 rounded bg-muted/30 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground font-mono break-all min-w-0">
              {t("contractLabel", { address: group.contract_address })}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleCopy}
                aria-label={t("copyContractAria")}
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

        {showDuplicateButton && (
          <div className="mb-4 space-y-2">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
              <CopyPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <span>
                {t.rich("newCycleNotice", { strong: (chunks) => <strong>{chunks}</strong> })}
              </span>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2" asChild>
              <Link href={duplicateHref}>
                <CopyPlus className="h-4 w-4" />
                {t("startNewCycle")}
              </Link>
            </Button>
          </div>
        )}

        {isCreator && group.contract_address && !isPending(group.contract_address) && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 mb-4"
            onClick={handleShareInvite}
          >
            {copiedInvite ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
            {copiedInvite ? t("linkCopiedButton") : t("shareInviteLink")}
          </Button>
        )}

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
                    {t("pending")}
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
              <span className="text-muted-foreground">{t("progressToTarget")}</span>
              <span className="font-medium">
                {targetDisplay.saved.toFixed(2)} / {targetDisplay.target.toFixed(2)} {tokenSymbol}
                {optimisticState.pendingTx?.status === "pending" &&
                  optimisticState.pendingTx.type === "deposit" && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-medium">
                      {t("pending")}
                    </span>
                  )}
              </span>
            </div>
            <Progress value={progress} className="h-3" />
            <p className="text-xs text-muted-foreground">
              {t("percentComplete", { percent: progress.toFixed(1) })}
              {optimisticState.pendingTx?.status === "pending" &&
                optimisticState.pendingTx.type === "deposit" && (
                  <span className="ml-2 text-yellow-600 dark:text-yellow-400">
                    {t("optimisticUpdateInProgress")}
                  </span>
                )}
            </p>
          </div>
        )}
      </Card>
    </motion.div>
  )
}
