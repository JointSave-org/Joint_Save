"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useStellar } from "@/components/web3-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  TrendingUp,
  Download,
  AlertTriangle,
  Activity as ActivityIcon,
  ShieldAlert,
  Loader2,
  Users,
  Wallet,
  Calendar,
  Layers,
} from "lucide-react"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts"

interface AnalyticsData {
  totalPools: number
  totalSaved: number
  totalDeposits: number
  totalWithdrawals: number
  averageHealthScore: number
  poolsAnalytics: Array<{
    id: string
    name: string
    type: 'rotational' | 'target' | 'flexible'
    status: string
    balance: number
    healthScore: number
    riskIndicator: 'Low' | 'Medium' | 'High'
  }>
  globalChartData: Array<{
    date: string
    deposits: number
    withdrawals: number
    balance: number
  }>
}

interface PoolAnalyticsData {
  pool: {
    id: string
    name: string
    type: 'rotational' | 'target' | 'flexible'
    status: 'active' | 'completed' | 'paused'
    target_amount?: number | null
    deadline?: string | null
    created_at: string
  }
  metrics: {
    currentBalance: number
    totalDeposits: number
    totalWithdrawals: number
    health: {
      healthScore: number
      participationRate: number
      riskIndicator: 'Low' | 'Medium' | 'High'
    }
    prediction: {
      daysToTarget: number
      projectedDate: string | null
      message: string
    }
    membersCount: number
    activeMembersCount: number
    lateMembersCount: number
    pendingMembersCount: number
  }
  chartData: Array<{
    date: string
    deposits: number
    withdrawals: number
    balance: number
  }>
}

export function AnalyticsDashboard() {
  const { address } = useStellar()
  const [selectedPoolId, setSelectedPoolId] = useState<string>("overview")

  // Fetch general user dashboard analytics
  const {
    data: generalData,
    isLoading: isGeneralLoading,
    error: generalError,
  } = useQuery<AnalyticsData>({
    queryKey: ["analytics", "general", address],
    queryFn: async () => {
      const res = await fetch(`/api/analytics?userAddress=${address}`)
      if (!res.ok) throw new Error("Failed to fetch analytics")
      return res.json()
    },
    enabled: !!address,
    refetchInterval: 10000, // 10s real-time fetching
  })

  // Fetch selected pool analytics
  const {
    data: poolData,
    isLoading: isPoolLoading,
    error: poolError,
  } = useQuery<PoolAnalyticsData>({
    queryKey: ["analytics", "pool", selectedPoolId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics?poolId=${selectedPoolId}`)
      if (!res.ok) throw new Error("Failed to fetch pool analytics")
      return res.json()
    },
    enabled: selectedPoolId !== "overview" && selectedPoolId !== "",
    refetchInterval: 10000, // 10s real-time fetching
  })

  // Export to CSV Function
  const handleExportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,"
    const headers = ["Date", "Cumulative Deposits (XLM)", "Cumulative Withdrawals (XLM)", "Net Savings/Balance (XLM)"]
    csvContent += headers.join(",") + "\n"

    const dataPoints = selectedPoolId === "overview"
      ? generalData?.globalChartData || []
      : poolData?.chartData || []

    dataPoints.forEach((point) => {
      const row = [point.date, point.deposits, point.withdrawals, point.balance]
      csvContent += row.join(",") + "\n"
    })

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    const filename = selectedPoolId === "overview"
      ? "jointsave_portfolio_analytics.csv"
      : `jointsave_pool_${selectedPoolId}_analytics.csv`
    link.setAttribute("download", filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Wallet className="h-12 w-12 text-muted-foreground mb-4 animate-bounce" />
        <h3 className="text-xl font-semibold">Wallet Connection Required</h3>
        <p className="text-muted-foreground mt-1 max-w-sm">
          Please connect your Stellar wallet to view savings pool analytics and performance metrics.
        </p>
      </div>
    )
  }

  if (isGeneralLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium animate-pulse">Aggregating advanced pool analytics...</p>
      </div>
    )
  }

  if (generalError) {
    return (
      <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl text-center">
        <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <h4 className="font-semibold text-destructive">Analytics Load Failed</h4>
        <p className="text-sm text-muted-foreground mt-1">
          {generalError instanceof Error ? generalError.message : "An error occurred while fetching metrics."}
        </p>
      </div>
    )
  }

  const COLORS = ["#00C49F", "#FFBB28", "#FF8042"]
  const hasPools = (generalData?.totalPools || 0) > 0

  return (
    <div className="space-y-6">
      {/* Dashboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">
            Advanced Analytics
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <p className="text-xs text-muted-foreground">
              Real-time balance tracking active (refreshes every 10s)
            </p>
          </div>
        </div>

        {/* Drill down select & Export */}
        <div className="flex items-center gap-2">
          {hasPools && (
            <Select value={selectedPoolId} onValueChange={setSelectedPoolId}>
              <SelectTrigger className="w-[200px] bg-background border-border hover:bg-muted/50 transition-colors">
                <SelectValue placeholder="Select Analytics View" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overview">Portfolio Overview</SelectItem>
                {generalData?.poolsAnalytics.map((pool) => (
                  <SelectItem key={pool.id} value={pool.id}>
                    {pool.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={!hasPools}
            className="flex items-center gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-300"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        </div>
      </div>

      {!hasPools ? (
        <Card className="border-dashed border-2 py-16 text-center">
          <CardContent className="flex flex-col items-center justify-center">
            <ActivityIcon className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold">No Analytics Data Yet</h3>
            <p className="text-muted-foreground max-w-sm mt-1">
              Join or create a savings pool first. Once contributions start, you'll see advanced analytics here.
            </p>
          </CardContent>
        </Card>
      ) : selectedPoolId === "overview" ? (
        /* ================= OVERVIEW MODE ================= */
        <div className="space-y-6">
          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-card/50 backdrop-blur-md border-border/80 shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Net Savings</CardTitle>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(generalData?.totalSaved || 0).toFixed(2)} XLM</div>
                <p className="text-xs text-muted-foreground mt-1">Across all savings groups</p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur-md border-border/80 shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Contributions</CardTitle>
                <Layers className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(generalData?.totalDeposits || 0).toFixed(2)} XLM</div>
                <p className="text-xs text-muted-foreground mt-1">Cumulative deposits made</p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur-md border-border/80 shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Payouts / Outflows</CardTitle>
                <Wallet className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(generalData?.totalWithdrawals || 0).toFixed(2)} XLM</div>
                <p className="text-xs text-muted-foreground mt-1">Withdrawals and payouts received</p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur-md border-border/80 shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Average Pool Health</CardTitle>
                <ActivityIcon className="h-4 w-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{generalData?.averageHealthScore || 100}%</div>
                <p className="text-xs text-muted-foreground mt-1">Overall savings behavior score</p>
              </CardContent>
            </Card>
          </div>

          {/* Historical Performance Area Chart */}
          <Card className="p-6 bg-card/40 backdrop-blur-lg border-border">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-lg font-bold">Historical Portfolio Performance</CardTitle>
              <CardDescription>Visualizing deposit accumulation, withdrawals, and total balance trends over time.</CardDescription>
            </CardHeader>
            <div className="h-[320px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={generalData?.globalChartData || []}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary, #00C49F)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--color-primary, #00C49F)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorDeposits" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} unit=" XLM" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(17, 24, 39, 0.95)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                      color: "#fff",
                    }}
                  />
                  <Legend verticalAlign="top" height={36} />
                  <Area
                    type="monotone"
                    name="Net Savings (Balance)"
                    dataKey="balance"
                    stroke="#00C49F"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorBalance)"
                  />
                  <Area
                    type="monotone"
                    name="Total Deposits"
                    dataKey="deposits"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    fillOpacity={1}
                    fill="url(#colorDeposits)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Group Health Scoring & Risk Indicators List */}
          <Card className="bg-card/40 border-border">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Group Health Scoring & Risk Indicators</CardTitle>
              <CardDescription>
                Summary of risk levels based on savings activity and late payment factors.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/80 text-muted-foreground font-semibold">
                      <th className="py-3 px-4">Pool Name</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Health Score</th>
                      <th className="py-3 px-4">Risk Level</th>
                      <th className="py-3 px-4 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generalData?.poolsAnalytics.map((pool) => (
                      <tr
                        key={pool.id}
                        onClick={() => setSelectedPoolId(pool.id)}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4 font-medium">{pool.name}</td>
                        <td className="py-3.5 px-4 capitalize text-muted-foreground">{pool.type}</td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <Progress value={pool.healthScore} className="h-1.5 w-16" />
                            <span className="font-semibold">{pool.healthScore}%</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge
                            className={
                              pool.riskIndicator === "High"
                                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                                : pool.riskIndicator === "Medium"
                                ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                                : "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                            }
                          >
                            {pool.riskIndicator} Risk
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-right font-semibold">{pool.balance.toFixed(2)} XLM</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* ================= DRILL-DOWN MODE ================= */
        isPoolLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground animate-pulse">Loading specific pool analysis...</p>
          </div>
        ) : poolError ? (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-center text-destructive">
            Failed to load pool analytics.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Quick pool overview cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Health Score Card */}
              <Card className="bg-card/50 border-border relative overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Pool Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center py-4">
                  <div className="relative flex items-center justify-center">
                    {/* Ring score visualization */}
                    <svg className="w-28 h-28 transform -rotate-90">
                      <circle cx="56" cy="56" r="46" stroke="rgba(255,255,255,0.05)" strokeWidth="8" fill="transparent" />
                      <circle
                        cx="56"
                        cy="56"
                        r="46"
                        stroke={
                          (poolData?.metrics.health.healthScore || 100) >= 80
                            ? "#00C49F"
                            : (poolData?.metrics.health.healthScore || 100) >= 50
                            ? "#FFBB28"
                            : "#FF8042"
                        }
                        strokeWidth="8"
                        strokeDasharray={2 * Math.PI * 46}
                        strokeDashoffset={2 * Math.PI * 46 * (1 - (poolData?.metrics.health.healthScore || 100) / 100)}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-3xl font-extrabold">{poolData?.metrics.health.healthScore}%</span>
                      <span className="text-[10px] text-muted-foreground font-semibold uppercase">Score</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Badge
                      className={
                        poolData?.metrics.health.riskIndicator === "High"
                          ? "bg-red-500/10 text-red-500"
                          : poolData?.metrics.health.riskIndicator === "Medium"
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-emerald-500/10 text-emerald-500"
                      }
                    >
                      {poolData?.metrics.health.riskIndicator} Risk Level
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Balances Card */}
              <Card className="bg-card/50 border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Pool Balances
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  <div>
                    <span className="text-xs text-muted-foreground">Current Pool Balance</span>
                    <div className="text-3xl font-black text-primary">
                      {poolData?.metrics.currentBalance.toFixed(2)} XLM
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/80">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Deposits</span>
                      <span className="text-sm font-bold">{poolData?.metrics.totalDeposits.toFixed(2)} XLM</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Withdrawals</span>
                      <span className="text-sm font-bold">{poolData?.metrics.totalWithdrawals.toFixed(2)} XLM</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Predictive Analytics Card */}
              <Card className="bg-card/50 border-border relative overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-primary" />
                    Predictive Analytics
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-2">
                  {poolData?.pool.type === "target" ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {poolData?.metrics.prediction.message}
                      </p>
                      {poolData?.metrics.prediction.daysToTarget > 0 && (
                        <div className="pt-2">
                          <span className="text-xs font-semibold text-muted-foreground block mb-1">
                            Progress toward Target ({poolData.pool.target_amount} XLM)
                          </span>
                          <Progress
                            value={Math.min(
                              100,
                              ((poolData?.metrics.currentBalance || 0) / (poolData.pool.target_amount || 1)) * 100
                            )}
                            className="h-2"
                          />
                        </div>
                      )}
                    </div>
                  ) : poolData?.pool.type === "rotational" ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Rotational cycles execute automatically once all member contributions are verified.
                      </p>
                      <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-1.5 mt-2 border border-border/50">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Round Duration:</span>
                          <span className="font-semibold">
                            {poolData?.pool.round_duration
                              ? `${Math.round(poolData.pool.round_duration / 86400)} days`
                              : "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cycle Payouts:</span>
                          <span className="font-semibold text-emerald-400">
                            {poolData?.pool.target_amount || poolData?.metrics.totalDeposits || 0} XLM
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>
                        Flexible saving structure allows withdrawals at any time (subject to configured fees).
                      </p>
                      <p className="text-xs pt-1">
                        Predictive models suggest maintaining deposits for a minimum of 30 days to optimize yield compounding benefits.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Charts & Participation Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Pool Chart */}
              <Card className="lg:col-span-2 p-6 bg-card/40 border-border">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="text-lg font-bold">Pool Saving Accumulation Timeline</CardTitle>
                </CardHeader>
                <div className="h-[280px] w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={poolData?.chartData || []}>
                      <defs>
                        <linearGradient id="colorPoolBalance" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00C49F" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#00C49F" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="date" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} unit=" XLM" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "rgba(17, 24, 39, 0.95)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "8px",
                          color: "#fff",
                        }}
                      />
                      <Area
                        type="monotone"
                        name="Pool Balance"
                        dataKey="balance"
                        stroke="#00C49F"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorPoolBalance)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* User Participation Breakdown (Donut Chart) */}
              <Card className="bg-card/40 border-border p-6 flex flex-col justify-between">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="text-lg font-bold">Participation Metrics</CardTitle>
                  <CardDescription>Breakdown of current round payment status</CardDescription>
                </CardHeader>

                <div className="flex-1 h-[180px] flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Paid", value: poolData?.metrics.activeMembersCount || 0 },
                          { name: "Pending", value: poolData?.metrics.pendingMembersCount || 0 },
                          { name: "Late", value: poolData?.metrics.lateMembersCount || 0 },
                        ].filter((d) => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        <Cell fill="#00C49F" />
                        <Cell fill="#FFBB28" />
                        <Cell fill="#FF8042" />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2 mt-4 pt-4 border-t border-border/80">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-emerald-500" />
                      <span>Active / Paid</span>
                    </div>
                    <span className="font-bold">{poolData?.metrics.activeMembersCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-amber-500" />
                      <span>Pending</span>
                    </div>
                    <span className="font-bold">{poolData?.metrics.pendingMembersCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-red-500" />
                      <span>Late</span>
                    </div>
                    <span className="font-bold">{poolData?.metrics.lateMembersCount}</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )
      )}
    </div>
  )
}
