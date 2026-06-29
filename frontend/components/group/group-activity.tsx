"use client"

import { useState, useEffect, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { formatRelativeTime, formatExactDateTime } from "@/lib/utils"
import {
  ArrowUpRight,
  ArrowDownLeft,
  UserPlus,
  Settings,
  Loader2,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { fetchContractEvents, ActivityEvent } from "@/hooks/useJointSaveContracts"

const PAGE_SIZE = 20

interface SupabaseActivity {
  id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  description: string | null
  created_at: string
  tx_hash: string | null
}

interface GroupActivityProps {
  groupId: string
  /** Contract address when known — used as the shared cache key */
  contractAddress?: string
  startLedger?: number
}

type Activity = ActivityEvent

function toActivity(a: SupabaseActivity): Activity {
  return { ...a, source: "offchain" as const }
}

function mergeAndDedupe(onchain: Activity[], offchain: Activity[]): Activity[] {
  const seen = new Set<string>()
  const merged: Activity[] = []
  for (const a of [...onchain, ...offchain]) {
    const key = a.tx_hash ?? a.id
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(a)
  }
  return merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

/**
 * Filter activities to those whose created_at falls within [from, to].
 * If both are empty the full list is returned unchanged.
 */
function applyDateFilter(activities: Activity[], from: string, to: string): Activity[] {
  if (!from && !to) return activities

  const fromMs = from ? new Date(from).setHours(0, 0, 0, 0) : -Infinity
  // Use end-of-day for the "to" bound so the selected date is fully included.
  const toMs = to ? new Date(to).setHours(23, 59, 59, 999) : Infinity

  return activities.filter((a) => {
    const ts = new Date(a.created_at).getTime()
    return ts >= fromMs && ts <= toMs
  })
}

export function GroupActivity({ groupId, contractAddress, startLedger = 0 }: GroupActivityProps) {
  const cacheKey =
    contractAddress && contractAddress !== "pending_deployment" ? contractAddress : groupId

  const { data, isLoading, refetch: refetchCache } = usePoolData(cacheKey)
  const [onchainActivities, setOnchainActivities] = useState<Activity[]>([])
  const [loadingOnchain, setLoadingOnchain] = useState(false)
  const [page, setPage] = useState(1)

  // Date-range filter state
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")

  const fetchOnchain = useCallback(async () => {
    if (!contractAddress || contractAddress === "pending_deployment") return
    try {
      setLoadingOnchain(true)
      const events = await fetchContractEvents(contractAddress, startLedger)
      setOnchainActivities(events)
    } catch (err) {
      console.error("Failed to fetch onchain events:", err)
    } finally {
      setLoadingOnchain(false)
    }
  }, [contractAddress, startLedger])

  useEffect(() => {
    fetchOnchain()
  }, [fetchOnchain])

  const refetch = useCallback(async () => {
    await Promise.all([refetchCache(), fetchOnchain()])
  }, [refetchCache, fetchOnchain])

  // Reset pagination whenever the date filter changes so the user always
  // sees from the first page of the newly-filtered result set.
  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFromDate(e.target.value)
    setPage(1)
  }

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setToDate(e.target.value)
    setPage(1)
  }

  const clearFilter = () => {
    setFromDate("")
    setToDate("")
    setPage(1)
  }

  const isFiltered = fromDate !== "" || toDate !== ""

  const dbActivities = (data?.db?.pool_activity ?? []).map(toActivity)
  const allActivities = mergeAndDedupe(onchainActivities, dbActivities)

  // Apply date-range filter before pagination
  const filteredActivities = applyDateFilter(allActivities, fromDate, toDate)

  const formatAddress = (address: string | null) => {
    if (!address) return "System"
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const visible = filteredActivities.slice(0, page * PAGE_SIZE)
  const hasMore = visible.length < filteredActivities.length

  if (isLoading && allActivities.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Recent Activity</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={refetch}
          disabled={isLoading || loadingOnchain}
          className="h-8 w-8 p0"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading || loadingOnchain ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ── Date-range filter ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="activity-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="activity-from"
            type="date"
            value={fromDate}
            onChange={handleFromChange}
            max={toDate || undefined}
            className="h-8 text-sm w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="activity-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="activity-to"
            type="date"
            value={toDate}
            onChange={handleToChange}
            min={fromDate || undefined}
            className="h-8 text-sm w-36"
          />
        </div>
        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilter}
            className="h-8 gap-1 text-xs"
            aria-label="Clear date filter"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>
      {/* ─────────────────────────────────────────────────────────────────── */}

      {filteredActivities.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {isFiltered ? "No activity found in the selected date range." : "No activity yet"}
        </p>
      ) : (
        <>
          <div className="space-y-4">
            {visible.map((activity: Activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 pb-4 border-b border-border last:border-0 last:pb-0"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 ${
                    activity.activity_type === "deposit"
                      ? "bg-primary/10"
                      : activity.activity_type === "payout"
                        ? "bg-accent/10"
                        : "bg-muted"
                  }`}
                >
                  {activity.activity_type === "deposit" && (
                    <ArrowUpRight className="h-5 w-5 text-primary" />
                  )}
                  {activity.activity_type === "payout" && (
                    <ArrowDownLeft className="h-5 w-5 text-accent" />
                  )}
                  {activity.activity_type === "member_joined" && (
                    <UserPlus className="h-5 w-5 text-muted-foreground" />
                  )}
                  {!["deposit", "payout", "member_joined"].includes(activity.activity_type) && (
                    <Settings className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-medium text-sm capitalize">
                      {(
                        {
                          deposit: "Deposit",
                          payout: "Payout",
                          withdraw: "Withdraw",
                          complete: "Pool Complete",
                          member_joined: "Member Joined",
                          pool_created: "Pool Created",
                          yield: "Yield Distributed",
                        } as Record<string, string>
                      )[activity.activity_type] ?? activity.activity_type}
                    </p>
                    {activity.amount != null && (
                      <Badge variant="secondary">{activity.amount.toFixed(2)} XLM</Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        activity.source === "onchain"
                          ? "border-blue-400 text-blue-600"
                          : "border-gray-300 text-gray-500"
                      }`}
                    >
                      {activity.source === "onchain" ? "🔗 on-chain" : "📝 off-chain"}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {formatAddress(activity.user_address)} •{" "}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <time
                          dateTime={activity.created_at}
                          className="cursor-default"
                          tabIndex={0}
                        >
                          {formatRelativeTime(activity.created_at)}
                        </time>
                      </TooltipTrigger>
                      <TooltipContent>{formatExactDateTime(activity.created_at)}</TooltipContent>
                    </Tooltip>
                  </p>

                  {activity.description && (
                    <p className="text-xs text-muted-foreground mt-1">{activity.description}</p>
                  )}

                  {activity.tx_hash ? (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${activity.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                    >
                      {activity.tx_hash.slice(0, 8)}…{activity.tx_hash.slice(-6)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">No tx hash</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-4"
              onClick={() => setPage((p: number) => p + 1)}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </Card>
  )
}
