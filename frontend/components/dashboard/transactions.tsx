"use client"

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
import { ArrowUpRight, ArrowDownLeft, Download, Loader2 } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { formatRelativeTime, formatExactDateTime } from "@/lib/utils"
import { buildCsv, downloadCsv } from "@/lib/csv-export"

export interface Activity {
  id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  description: string | null
  created_at: string
  pool_id: string
  tx_hash: string | null
  pool_name: string | null
  pool_type: string | null
  token_symbol: string | null
}

export function Transactions() {
  const t = useTranslations("dashboard.transactions")
  const tPool = useTranslations("pool")
  const locale = useLocale()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<string>("all")
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc")

  // Filters
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [poolFilter, setPoolFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const { data, error } = await supabase
          .from("pool_activity")
          .select(
            `
            *,
            pools ( name, type, token_symbol )
          `
          )
          .order("created_at", { ascending: false })
          .limit(500)

        if (error) throw error

        const rows = (data ?? []).map(
          (
            row: Record<string, unknown> & {
              pools?: {
                name?: string | null
                type?: string | null
                token_symbol?: string | null
              } | null
            }
          ) => ({
            ...row,
            pool_name: row.pools?.name ?? null,
            pool_type: row.pools?.type ?? null,
            token_symbol: row.pools?.token_symbol ?? null,
          })
        )
        setActivities(rows)
      } catch (err) {
        console.error("Failed to fetch activities:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchActivities()
  }, [])

  const poolOptions = useMemo(() => {
    const seen = new Map<string, string>()
    activities.forEach((a) => {
      if (a.pool_id && a.pool_name) seen.set(a.pool_id, a.pool_name)
    })
    return Array.from(seen.entries())
  }, [activities])

  const activityTypes = useMemo(
    () => Array.from(new Set(activities.map((a) => a.activity_type))),
    [activities]
  )

  const filtered = useMemo(() => {
    return activities
      .filter((a) => {
        if (dateFrom && new Date(a.created_at) < new Date(dateFrom)) return false
        if (dateTo && new Date(a.created_at) > new Date(dateTo + "T23:59:59")) return false
        if (poolFilter !== "all" && a.pool_id !== poolFilter) return false
        if (typeFilter !== "all" && a.activity_type.toLowerCase() !== typeFilter.toLowerCase())
          return false
        if (filterType !== "all" && a.activity_type.toLowerCase() !== filterType.toLowerCase())
          return false
        return true
      })
      .sort((a, b) => {
        const timeA = new Date(a.created_at).getTime()
        const timeB = new Date(b.created_at).getTime()
        return sortOrder === "desc" ? timeB - timeA : timeA - timeB
      })
  }, [activities, dateFrom, dateTo, poolFilter, typeFilter, filterType, sortOrder])

  const exportCSV = () => {
    if (filtered.length === 0) return
    const headers = [
      t("csvHeaders.date"),
      t("csvHeaders.poolName"),
      t("csvHeaders.poolType"),
      t("csvHeaders.activityType"),
      t("csvHeaders.amount"),
      t("csvHeaders.txHash"),
    ]
    const rows = filtered.map((a) => [
      new Date(a.created_at).toISOString().slice(0, 10),
      a.pool_name ?? "",
      a.pool_type ?? "",
      a.activity_type,
      a.amount != null ? `${a.amount.toFixed(2)} ${a.token_symbol ?? "XLM"}` : "",
      a.tx_hash ?? "",
    ])

    const csv = buildCsv(headers, rows)
    downloadCsv(csv, `transactions-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const activityTypeLabel = (type: string) => {
    const key = type.toLowerCase()
    return ["deposit", "withdraw", "payout", "refund"].includes(key)
      ? t(`activityType.${key}`)
      : type
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">{t("title")}</h2>
          <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label={t("filterTransactionsAria")}
            className="bg-background border border-input rounded-md px-3 py-1.5 text-sm"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">{t("filterAll")}</option>
            <option value="deposit">{t("filterDeposits")}</option>
            <option value="withdraw">{t("filterWithdrawals")}</option>
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
          >
            {t("sortLabel", { order: sortOrder.toUpperCase() })}
          </Button>

          <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" /> {t("exportCsv")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40"
          aria-label={t("filterFromAria")}
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40"
          aria-label={t("filterToAria")}
        />
        {poolOptions.length > 0 && (
          <Select value={poolFilter} onValueChange={setPoolFilter}>
            <SelectTrigger className="w-44" aria-label={t("filterByPoolAria")}>
              <SelectValue placeholder={t("allPools")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allPools")}</SelectItem>
              {poolOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {activityTypes.length > 0 && (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44" aria-label={t("filterByTypeAria")}>
              <SelectValue placeholder={t("filterAll")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAll")}</SelectItem>
              {activityTypes.map((type) => (
                <SelectItem key={type} value={type} className="capitalize">
                  {activityTypeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card className="divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">{t("noTransactionsYet")}</div>
        ) : (
          filtered.map((activity) => (
            <div key={activity.id} className="p-6 hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                      activity.activity_type === "deposit" ? "bg-primary/10" : "bg-accent/10"
                    }`}
                  >
                    {activity.activity_type === "deposit" ? (
                      <ArrowUpRight className="h-6 w-6 text-primary" />
                    ) : (
                      <ArrowDownLeft className="h-6 w-6 text-accent" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{activityTypeLabel(activity.activity_type)}</h3>
                      <Badge variant="default" className="bg-primary/10 text-primary">
                        {t("completed")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{activity.description}</p>
                    {activity.pool_name && (
                      <p className="text-xs text-muted-foreground">
                        {activity.pool_name}
                        {activity.pool_type && ` · ${tPool(`type.${activity.pool_type}`)}`}
                      </p>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <time
                          dateTime={activity.created_at}
                          className="text-xs text-muted-foreground mt-1 cursor-default block"
                          tabIndex={0}
                        >
                          {formatRelativeTime(activity.created_at, locale)}
                        </time>
                      </TooltipTrigger>
                      <TooltipContent>
                        {formatExactDateTime(activity.created_at, locale)}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <div className="text-right">
                  {activity.amount != null && (
                    <p className="text-xl font-bold">{activity.amount.toFixed(2)} XLM</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
