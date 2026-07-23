"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useStellar } from "@/components/web3-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  TrendingUp,
  Wallet,
  PiggyBank,
  Award,
  Calendar,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  AlertTriangle,
  Clock,
  BarChart3,
  ListOrdered,
} from "lucide-react"

interface PoolSummary {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: "active" | "completed" | "paused"
  contribution: number
  total_balance: number
  health_score: number | null
  next_action: string | null
}

interface UpcomingCommitment {
  pool_id: string
  pool_name: string
  amount: number
  deadline: string
  type: string
}

interface PortfolioData {
  total_saved: number
  total_pools: { rotational: number; target: number; flexible: number; total: number }
  total_yield_earned: number
  upcoming_commitments: UpcomingCommitment[]
  reputation_summary: {
    total_deposits: number
    average_on_time_rate: number
    pools_completed: number
  }
  pools: PoolSummary[]
}

type SortField = "name" | "type" | "contribution" | "total_balance" | "health_score"
type SortDir = "asc" | "desc"

export function Portfolio() {
  const { address } = useStellar()
  const [sortField, setSortField] = useState<SortField>("contribution")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const { data, isLoading, error } = useQuery<PortfolioData>({
    queryKey: ["portfolio", "summary", address],
    queryFn: async () => {
      const res = await fetch(`/api/portfolio/summary?wallet=${address}`)
      if (!res.ok) throw new Error("Failed to fetch portfolio summary")
      return res.json()
    },
    enabled: !!address,
    refetchInterval: 30_000,
  })

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
  }

  const sortedPools = useMemo(() => {
    if (!data?.pools) return []
    return [...data.pools].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name)
          break
        case "type":
          cmp = a.type.localeCompare(b.type)
          break
        case "contribution":
          cmp = a.contribution - b.contribution
          break
        case "total_balance":
          cmp = a.total_balance - b.total_balance
          break
        case "health_score":
          cmp = (a.health_score ?? 0) - (b.health_score ?? 0)
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [data?.pools, sortField, sortDir])

  const SortHeader = ({
    field,
    label,
  }: {
    field: SortField
    label: string
  }) => (
    <button
      onClick={() => toggleSort(field)}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {sortField === field ? (
        sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  )

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold">Wallet Connection Required</h3>
        <p className="text-muted-foreground mt-1 max-w-sm">
          Connect your Stellar wallet to view your portfolio summary.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-3 w-20 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-6 bg-destructive/10 border-destructive/20">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-destructive font-medium">
            Failed to load portfolio data. Please try again.
          </p>
        </div>
      </Card>
    )
  }

  if (!data || data.total_pools.total === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">Portfolio</h2>
          <p className="text-muted-foreground mt-1">Your consolidated savings overview</p>
        </div>
        <Card className="border-dashed border-2 py-16 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <PiggyBank className="h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold">No Active Pools</h3>
            <p className="text-muted-foreground max-w-sm">
              Join or create a savings pool to see your portfolio aggregated here.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const scoredPools = data.pools.filter((p) => p.health_score !== null)
  const avgHealth =
    scoredPools.length > 0
      ? Math.round(
          scoredPools.reduce((s, p) => s + (p.health_score ?? 0), 0) / scoredPools.length
        )
      : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Portfolio</h2>
        <p className="text-muted-foreground mt-1">
          Consolidated overview across {data.total_pools.total} pool
          {data.total_pools.total !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Saved
            </CardTitle>
            <Wallet className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.total_saved.toFixed(2)} XLM</div>
            <p className="text-xs text-muted-foreground mt-1">Net deposits minus withdrawals</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Yield Earned
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.total_yield_earned.toFixed(2)} XLM</div>
            <p className="text-xs text-muted-foreground mt-1">Across all pools</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Pools
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.total_pools.total}</div>
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
              {data.total_pools.rotational > 0 && (
                <span>{data.total_pools.rotational} rotational</span>
              )}
              {data.total_pools.target > 0 && (
                <span>{data.total_pools.target} target</span>
              )}
              {data.total_pools.flexible > 0 && (
                <span>{data.total_pools.flexible} flexible</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Reputation
            </CardTitle>
            <Award className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.reputation_summary.average_on_time_rate}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.reputation_summary.pools_completed} pool
              {data.reputation_summary.pools_completed !== 1 ? "s" : ""} completed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Deposit Schedule Timeline + Reputation Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deposit Schedule Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Upcoming Deposits
            </CardTitle>
            <CardDescription>
              {data.upcoming_commitments.length === 0
                ? "No upcoming deposit deadlines"
                : `${data.upcoming_commitments.length} commitment${data.upcoming_commitments.length !== 1 ? "s" : ""} ahead`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.upcoming_commitments.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Clock className="h-8 w-8 text-muted-foreground opacity-40 mb-2" />
                <p className="text-sm text-muted-foreground">All caught up — no pending deposits</p>
              </div>
            ) : (
              <div className="space-y-0">
                {data.upcoming_commitments.map((c, i) => (
                  <div key={c.pool_id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-3 h-3 rounded-full border-2 ${
                          isDeadlineSoon(c.deadline)
                            ? "border-amber-500 bg-amber-500/20"
                            : "border-primary bg-primary/20"
                        }`}
                      />
                      {i < data.upcoming_commitments.length - 1 && (
                        <div className="w-0.5 flex-1 bg-border mt-1" />
                      )}
                    </div>
                    <div className="pb-6 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{c.pool_name}</p>
                        <Badge variant={isDeadlineSoon(c.deadline) ? "destructive" : "secondary"} className="text-xs">
                          {formatRelativeTime(c.deadline)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {c.amount.toFixed(2)} XLM deposit
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reputation Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              Reputation Overview
            </CardTitle>
            <CardDescription>Your savings behaviour across all pools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-center">
              <div className="relative flex items-center justify-center">
                <svg className="w-32 h-32 -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="54"
                    stroke="hsl(var(--muted))"
                    strokeWidth="8"
                    fill="transparent"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="54"
                    stroke="hsl(var(--primary))"
                    strokeWidth="8"
                    strokeDasharray={2 * Math.PI * 54}
                    strokeDashoffset={
                      2 * Math.PI * 54 * (1 - data.reputation_summary.average_on_time_rate / 100)
                    }
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-3xl font-extrabold">
                    {data.reputation_summary.average_on_time_rate}%
                  </span>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase">
                    On-Time Rate
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Total Deposits</p>
                <p className="text-lg font-bold">{data.reputation_summary.total_deposits.toFixed(2)} XLM</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Pools Completed</p>
                <p className="text-lg font-bold">{data.reputation_summary.pools_completed}</p>
              </div>
            </div>

            {avgHealth !== null && (
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Average Pool Health</span>
                  <span className="font-semibold">{avgHealth}%</span>
                </div>
                <Progress value={avgHealth} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pool Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-primary" />
            Pool Comparison
          </CardTitle>
          <CardDescription>
            Sort by any column to compare your pools side by side
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-3 px-3 text-left font-medium">
                    <SortHeader field="name" label="Pool Name" />
                  </th>
                  <th className="py-3 px-3 text-left font-medium">
                    <SortHeader field="type" label="Type" />
                  </th>
                  <th className="py-3 px-3 text-right font-medium">
                    <SortHeader field="contribution" label="Your Contribution" />
                  </th>
                  <th className="py-3 px-3 text-right font-medium">
                    <SortHeader field="total_balance" label="Pool Balance" />
                  </th>
                  <th className="py-3 px-3 text-center font-medium">
                    <SortHeader field="health_score" label="Health" />
                  </th>
                  <th className="py-3 px-3 text-left font-medium">Next Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedPools.map((pool) => (
                  <tr
                    key={pool.id}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-3 px-3 font-medium">{pool.name}</td>
                    <td className="py-3 px-3">
                      <Badge variant="outline" className="capitalize">
                        {pool.type}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">
                      {pool.contribution.toFixed(2)} XLM
                    </td>
                    <td className="py-3 px-3 text-right">
                      {pool.total_balance.toFixed(2)} XLM
                    </td>
                    <td className="py-3 px-3 text-center">
                      {pool.health_score !== null ? (
                        <div className="flex items-center justify-center gap-2">
                          <Progress
                            value={pool.health_score}
                            className="h-1.5 w-12"
                          />
                          <span className="text-xs font-semibold w-8">
                            {pool.health_score}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-sm">
                      {pool.next_action ? (
                        <span className="text-amber-500 text-xs">{pool.next_action}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff < 0) return "Overdue"
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `${days} days`
}

function isDeadlineSoon(dateStr: string): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  return diff >= 0 && diff < 3 * 86400000
}
