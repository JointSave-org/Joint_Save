"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { formatRelativeTime, formatExactDateTime } from "@/lib/utils"
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowUpDown,
  Download,
  UserPlus,
  Settings,
  Search,
  Loader2,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { DateRangePicker } from "@/components/shared/date-range-picker"
import { ACTIVITY_TYPES } from "@/lib/activity-query"

const ACTIVITY_TYPE_KEYS = [
  "deposit",
  "payout",
  "withdraw",
  "complete",
  "member_joined",
  "member_added",
  "member_removed",
  "pool_created",
  "yield",
] as const

interface Activity {
  id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  token_amount: number | null
  description: string | null
  tx_hash: string | null
  on_chain_timestamp: string | null
  block_number: number | null
  fee_charged: number | null
  created_at: string
}

interface LastIndexed {
  ledger: number
  indexedAt: string
}

interface ActivityResponse {
  activities: Activity[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
  lastIndexed: LastIndexed | null
}

interface GroupActivityProps {
  groupId: string
  /** Contract address when known — enables the Re-index action. */
  contractAddress?: string
  /** Kept for call-site compatibility; indexing now tracks its own ledger. */
  startLedger?: number
}

export function GroupActivity({ groupId, contractAddress }: GroupActivityProps) {
  const t = useTranslations("group.activity")
  const locale = useLocale()
  const { address } = useStellar()

  const activityTypeLabel = (type: string): string =>
    (ACTIVITY_TYPE_KEYS as readonly string[]).includes(type)
      ? t(`types.${type}` as "types.deposit")
      : type

  // The refresh action must also refresh the shared pool cache (balances and
  // on-chain state shown elsewhere on the page), as it did before the feed
  // moved to the server-side activity API.
  const cacheKey =
    contractAddress && contractAddress !== "pending_deployment" ? contractAddress : groupId
  const { refetch: refetchPoolCache } = usePoolData(cacheKey)

  // Filters
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, 300)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [activityType, setActivityType] = useState("all")
  const [sort, setSort] = useState<"newest" | "oldest">("newest")

  // Data
  const [activities, setActivities] = useState<Activity[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [lastIndexed, setLastIndexed] = useState<LastIndexed | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Guards against out-of-order responses when filters change quickly.
  const requestSeq = useRef(0)

  const buildParams = useCallback(
    (targetPage: number) => {
      const params = new URLSearchParams()
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim())
      if (fromDate) params.set("date_from", fromDate)
      if (toDate) params.set("date_to", toDate)
      if (activityType !== "all") params.set("activity_type", activityType)
      if (sort !== "newest") params.set("sort", sort)
      if (targetPage > 1) params.set("page", String(targetPage))
      return params
    },
    [debouncedSearch, fromDate, toDate, activityType, sort]
  )

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      const seq = ++requestSeq.current
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const res = await fetch(`/api/pools/${groupId}/activity?${buildParams(targetPage)}`)
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error || t("failedToLoadActivity"))
        }
        const data = (await res.json()) as Partial<ActivityResponse> | null
        if (seq !== requestSeq.current) return // stale response
        const rows = Array.isArray(data?.activities) ? data.activities : []
        setActivities((prev) => (append ? [...prev, ...rows] : rows))
        setPage(data?.page ?? targetPage)
        setHasMore(data?.hasMore ?? false)
        setTotal(data?.total ?? rows.length)
        setLastIndexed(data?.lastIndexed ?? null)
        setError(null)
      } catch (err) {
        if (seq !== requestSeq.current) return
        setError((err as Error)?.message || t("failedToLoadActivity"))
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [groupId, buildParams, t]
  )

  // Refetch from page 1 whenever a filter changes (search is debounced).
  useEffect(() => {
    fetchPage(1, false)
  }, [fetchPage])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchPoolCache?.(), fetchPage(1, false)])
  }, [refetchPoolCache, fetchPage])

  const handleReindex = async () => {
    if (!address || !contractAddress || contractAddress === "pending_deployment") return
    setIndexing(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/pools/${groupId}/index-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": address,
        },
        body: JSON.stringify({ wallet_address: address }),
      })
      const body = await res.json().catch(() => null)
      if (res.status === 403) {
        setNotice(t("onlyMembersCanReindex"))
        return
      }
      if (!res.ok) {
        setNotice(body?.error || t("indexingFailed"))
        return
      }
      if (body?.warning) setNotice(body.warning)
      await fetchPage(1, false)
    } catch {
      setNotice(t("indexingFailed"))
    } finally {
      setIndexing(false)
    }
  }

  const handleExport = async () => {
    if (!address) return
    setExporting(true)
    setNotice(null)
    try {
      const params = buildParams(1)
      params.delete("page")
      params.set("wallet", address)
      const res = await fetch(`/api/pools/${groupId}/activity/export?${params}`)
      if (res.status === 429) {
        const body = await res.json().catch(() => null)
        const wait = body?.retryAfterSec
        setNotice(
          wait
            ? t("exportLimitReachedWithWait", { minutes: Math.ceil(wait / 60) })
            : t("exportLimitReached")
        )
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setNotice(body?.error || t("exportFailed"))
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") || ""
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ?? `pool-activity-${groupId.slice(0, 8)}.csv`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setNotice(t("exportFailed"))
    } finally {
      setExporting(false)
    }
  }

  const formatAddress = (addr: string | null) => {
    if (!addr) return t("system")
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const isFiltered =
    debouncedSearch.trim() !== "" || fromDate !== "" || toDate !== "" || activityType !== "all"
  const canReindex = !!address && !!contractAddress && contractAddress !== "pending_deployment"

  if (loading && activities.length === 0 && !error) {
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
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold">{t("recentActivity")}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="h-8 w-8 p-0"
          aria-label={t("refreshActivityAria")}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ── Indexing status ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {lastIndexed ? (
            <>
              {t("lastIndexed")}{" "}
              <Tooltip>
                <TooltipTrigger asChild>
                  <time dateTime={lastIndexed.indexedAt} className="cursor-default" tabIndex={0}>
                    {formatRelativeTime(lastIndexed.indexedAt, locale)}
                  </time>
                </TooltipTrigger>
                <TooltipContent>
                  {formatExactDateTime(lastIndexed.indexedAt, locale)}
                </TooltipContent>
              </Tooltip>
            </>
          ) : (
            t("neverIndexed")
          )}
        </p>
        {canReindex && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 text-xs px-2"
            onClick={handleReindex}
            disabled={indexing}
          >
            <RefreshCw className={`h-3 w-3 ${indexing ? "animate-spin" : ""}`} />
            {indexing ? t("indexingEllipsis") : t("reindex")}
          </Button>
        )}
      </div>

      {/* ── Search + filters ───────────────────────────────────────────────── */}
      <div className="space-y-3 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t("searchActivityPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 pr-8 text-sm"
            aria-label={t("searchActivityAria")}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t("clearSearchAria")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker
            from={fromDate}
            to={toDate}
            onChange={(from, to) => {
              setFromDate(from)
              setToDate(to)
            }}
            idPrefix="activity"
          />
          <Select value={activityType} onValueChange={setActivityType}>
            <SelectTrigger className="h-8 w-40 text-sm" aria-label={t("filterByTypeAria")}>
              <SelectValue placeholder={t("allTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTypes")}</SelectItem>
              {ACTIVITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {activityTypeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
            aria-label={t("toggleSortOrderAria")}
          >
            <ArrowUpDown className="h-3 w-3" />
            {sort === "newest" ? t("newestFirst") : t("oldestFirst")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={handleExport}
            disabled={exporting || !address || total === 0}
            title={!address ? t("connectWalletToExport") : undefined}
          >
            {exporting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {t("export")}
          </Button>
        </div>
      </div>
      {/* ───────────────────────────────────────────────────────────────────── */}

      {notice && (
        <p className="text-xs text-amber-600 dark:text-amber-500 mb-3" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive text-center py-4" role="alert">
          {error}
        </p>
      )}

      {!error && activities.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {isFiltered ? t("noActivityMatchesFilters") : t("noActivityYet")}
        </p>
      ) : (
        !error && (
          <>
            <div className="space-y-4">
              {activities.map((activity) => (
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
                        {activityTypeLabel(activity.activity_type)}
                      </p>
                      {activity.amount != null && (
                        <Badge variant="secondary">{activity.amount.toFixed(2)} XLM</Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          activity.on_chain_timestamp
                            ? "border-blue-400 text-blue-600"
                            : "border-gray-300 text-gray-500"
                        }`}
                      >
                        {activity.on_chain_timestamp ? t("onChain") : t("offChain")}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {formatAddress(activity.user_address)} •{" "}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <time
                            dateTime={activity.on_chain_timestamp ?? activity.created_at}
                            className="cursor-default"
                            tabIndex={0}
                          >
                            {formatRelativeTime(
                              activity.on_chain_timestamp ?? activity.created_at,
                              locale
                            )}
                          </time>
                        </TooltipTrigger>
                        <TooltipContent>
                          {formatExactDateTime(
                            activity.on_chain_timestamp ?? activity.created_at,
                            locale
                          )}
                        </TooltipContent>
                      </Tooltip>
                      {activity.block_number != null && (
                        <> • {t("ledgerNumber", { number: activity.block_number })}</>
                      )}
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
                      <p className="text-xs text-muted-foreground mt-1">{t("noTxHash")}</p>
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
                onClick={() => fetchPage(page + 1, true)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("loadMore", { shown: activities.length, total })
                )}
              </Button>
            )}
          </>
        )
      )}
    </Card>
  )
}
