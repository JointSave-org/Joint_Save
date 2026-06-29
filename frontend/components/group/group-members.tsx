"use client"

import { Card } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CheckCircle2, Clock, XCircle, AlertCircle, Award, Copy, Check } from "lucide-react"
import { useState, useEffect } from "react"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { useOptimisticTransactions } from "@/hooks/useOptimisticTransactions"
import {
  RotationalPoolState,
  fetchReputation,
  type ReputationScore,
} from "@/hooks/useJointSaveContracts"
import { useToast } from "@/hooks/use-toast"
import { countPendingMembers, filterPendingMembers } from "@/lib/member-filters"

interface Member {
  id: string
  member_address: string
  contribution_amount: number
  status: "pending" | "paid" | "late"
  joined_at: string
}

interface GroupMembersProps {
  groupId: string
  contractAddress?: string
  poolType?: "rotational" | "target" | "flexible"
}

// Status-coded avatar tint so each member's deposit status reads at a glance,
// matching the per-row status icon colors (green=paid, yellow=pending, red=late).
const statusAvatarClass: Record<Member["status"], string> = {
  paid: "bg-primary/10 text-primary",
  pending: "bg-yellow-500/10 text-yellow-800 dark:text-yellow-300",
  late: "bg-destructive/10 text-destructive",
}

export function GroupMembers({ groupId, contractAddress, poolType }: GroupMembersProps) {
  // Prefer contract address as the cache key (already warming from GroupDetails
  // and GroupActivity on the same page). Fall back to DB id for pending pools.
  const cacheKey =
    contractAddress && contractAddress !== "pending_deployment" ? contractAddress : groupId

  const { data, isLoading } = usePoolData(cacheKey)
  const { optimisticState } = useOptimisticTransactions(cacheKey)
  const { toast } = useToast()

  const members: Member[] = data?.db?.pool_members ?? []
  const onchainState = data?.onchain

  const [reputations, setReputations] = useState<Record<string, ReputationScore>>({})
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const [showPendingOnly, setShowPendingOnly] = useState(false)

  const handleCopyMemberAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      setCopiedAddress(address)
      toast({ title: "Address copied", description: "Member address copied to clipboard." })
      setTimeout(() => setCopiedAddress(null), 2500)
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please copy the address manually.",
        variant: "destructive",
      })
    }
  }

  useEffect(() => {
    if (members.length === 0) return
    const loadReputations = async () => {
      const results = await Promise.allSettled(
        members.map(
          async (m) => [m.member_address, await fetchReputation(m.member_address)] as const
        )
      )
      setReputations(
        Object.fromEntries(
          results
            .filter(
              (r): r is PromiseFulfilledResult<readonly [string, ReputationScore]> =>
                r.status === "fulfilled"
            )
            .map((r) => r.value)
        )
      )
    }
    loadReputations()
  }, [members])

  const formatAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`

  // Get next payout recipient for rotational pools
  const getNextPayoutRecipient = (): string | null => {
    if (poolType !== "rotational" || !onchainState) return null
    const s = onchainState as RotationalPoolState
    if (s.members.length === 0) return null
    // Next recipient is at currentRound % members.length
    const nextIndex = s.currentRound % s.members.length
    return s.members[nextIndex]?.toUpperCase() ?? null
  }

  const isPayoutPending =
    optimisticState.pendingTx?.status === "pending" &&
    optimisticState.pendingTx.type === "trigger_payout"
  const nextRecipient = getNextPayoutRecipient()

  // Client-side "pending only" view derived from data already on the page (no fetching).
  const pendingCount = countPendingMembers(members)
  const visibleMembers = showPendingOnly ? filterPendingMembers(members) : members

  if (isLoading && members.length === 0) {
    return (
      <Card className="p-6" aria-label="Loading members">
        <Skeleton className="h-6 w-32 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                {/* avatar */}
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              {/* status icon */}
              <Skeleton className="h-4 w-4 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Members ({members.length})</h3>
          {members.length > 0 && (
            <Badge
              variant="secondary"
              className="text-xs font-normal whitespace-nowrap tabular-nums"
            >
              {pendingCount} pending
            </Badge>
          )}
        </div>
        {members.length > 0 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={showPendingOnly ? "pending" : "all"}
            onValueChange={(v) => setShowPendingOnly(v === "pending")}
            aria-label="Filter members by deposit status"
          >
            <ToggleGroupItem value="all" aria-label="Show all members">
              Show all
            </ToggleGroupItem>
            <ToggleGroupItem value="pending" aria-label="Show pending members only">
              Pending only
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No members yet</p>
      ) : visibleMembers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Everyone has deposited</p>
      ) : (
        <div className="space-y-3">
          {visibleMembers.map((member) => {
            const isPendingPayout =
              isPayoutPending && member.member_address.toUpperCase() === nextRecipient
            return (
              <div
                key={member.id}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  isPendingPayout
                    ? "bg-yellow-500/10 border-2 border-dashed border-yellow-500/50"
                    : "bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className={statusAvatarClass[member.status]}>
                      {member.member_address.slice(2, 4).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-sm font-mono">
                        {formatAddress(member.member_address)}
                      </p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => handleCopyMemberAddress(member.member_address)}
                        aria-label="Copy member address"
                      >
                        {copiedAddress === member.member_address ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {member.contribution_amount.toFixed(2)} XLM
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isPendingPayout && (
                    <>
                      <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 font-medium">
                        payout pending
                      </span>
                    </>
                  )}
                  {!isPendingPayout && (
                    <>
                      {member.status === "paid" && (
                        <CheckCircle2
                          className="h-4 w-4 text-primary"
                          role="img"
                          aria-label="Paid"
                        />
                      )}
                      {member.status === "pending" && (
                        <Clock
                          className="h-4 w-4 text-yellow-700 dark:text-yellow-400"
                          role="img"
                          aria-label="Pending"
                        />
                      )}
                      {member.status === "late" && (
                        <XCircle
                          className="h-4 w-4 text-destructive"
                          role="img"
                          aria-label="Late"
                        />
                      )}
                    </>
                  )}
                  {reputations[member.member_address] && (
                    <Badge variant="outline" className="text-xs font-normal gap-1">
                      <Award className="h-3 w-3" />
                      {Math.round(reputations[member.member_address].onTimeRate / 100)}% on-time
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
