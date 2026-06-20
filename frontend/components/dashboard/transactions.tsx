"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowUpRight, ArrowDownLeft, Loader2, Download } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { formatRelativeTime, formatExactDateTime } from "@/lib/utils"

interface Activity {
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
}

export function Transactions() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

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
          .select(`
            *,
            pools ( name, type )
          `)
          .order("created_at", { ascending: false })
          .limit(500)

        if (error) throw error

        const rows = (data ?? []).map((row: any) => ({
          ...row,
          pool_name: row.pools?.name ?? null,
          pool_type: row.pools?.type ?? null,
        }))
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
    return activities.filter((a) => {
      if (dateFrom && new Date(a.created_at) < new Date(dateFrom)) return false
      if (dateTo && new Date(a.created_at) > new Date(dateTo + "T23:59:59")) return false
      if (poolFilter !== "all" && a.pool_id !== poolFilter) return false
      if (typeFilter !== "all" && a.activity_type !== typeFilter) return false
      return true
    })
  }, [activities, dateFrom, dateTo, poolFilter, typeFilter])

  const exportCSV = () => {
    const header = ["Date", "Pool Name", "Pool Type", "Activity Type", "Amount", "Transaction Hash"]
    const rows = filtered.map((a) => [
      new Date(a.created_at).toLocaleDateString(),
      a.pool_name ?? "",
      a.pool_type ?? "",
      a.activity_type,
      a.amount != null ? a.amount.toFixed(2) : "",
      a.tx_hash ?? "",
    ])

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold">Transaction History</h2>
          <p className="text-muted-foreground mt-1">View all deposits and payouts</p>
        </div>
        <Button onClick={exportCSV} variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40"
          placeholder="From"
          aria-label="Filter from date"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40"
          placeholder="To"
          aria-label="Filter to date"
        />
        {poolOptions.length > 0 && (
          <Select value={poolFilter} onValueChange={setPoolFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by pool">
              <SelectValue placeholder="All Pools" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Pools</SelectItem>
              {poolOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {activityTypes.length > 0 && (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44" aria-label="Filter by activity type">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {activityTypes.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card className="divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            No transactions found
          </div>
        ) : (
          filtered.map((activity) => (
            <div key={activity.id} className="p-6 hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                    activity.activity_type === "deposit" ? "bg-primary/10" : "bg-accent/10"
                  }`}>
                    {activity.activity_type === "deposit" ? (
                      <ArrowUpRight className="h-6 w-6 text-primary" />
                    ) : (
                      <ArrowDownLeft className="h-6 w-6 text-accent" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold capitalize">{activity.activity_type}</h3>
                      <Badge variant="default" className="bg-primary/10 text-primary">
                        Completed
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{activity.description}</p>
                    {activity.pool_name && (
                      <p className="text-xs text-muted-foreground capitalize">
                        {activity.pool_name} · {activity.pool_type}
                      </p>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <time
                          dateTime={activity.created_at}
                          className="text-xs text-muted-foreground mt-1 cursor-default block"
                          tabIndex={0}
                        >
                          {formatRelativeTime(activity.created_at)}
                        </time>
                      </TooltipTrigger>
                      <TooltipContent>{formatExactDateTime(activity.created_at)}</TooltipContent>
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
