"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useStellar } from "@/components/web3-provider"
import { Wallet, Award, TrendingUp, Users, Loader2 } from "lucide-react"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import {
  fetchTargetState,
  fetchFlexibleState,
  fetchReputation,
  stroopsToXlm,
  type ReputationScore,
} from "@/hooks/useJointSaveContracts"

interface ProfileStats {
  totalSaved: number        // live on-chain XLM across all pools
  groupsJoined: number      // distinct pools the address is a member of
  successfulPayouts: number // payout/withdraw activity count
  reputation: number        // 0-100 derived from on-chain behaviour
  onChain: ReputationScore  // raw on-chain reputation tracker data
}

async function fetchProfileStats(address: string): Promise<ProfileStats> {
  const lower = address.toLowerCase()

  // Fetch all pools where user is a member
  const { data: memberships } = await supabase
    .from("pool_members")
    .select("pool_id, pools(id, type, contract_address, target_amount)")
    .eq("member_address", lower)

  const pools: any[] = (memberships || [])
    .map((m: any) => m.pools)
    .filter(Boolean)

  // Fetch activity for reputation signals
  const { data: activity } = await supabase
    .from("pool_activity")
    .select("activity_type")
    .eq("user_address", lower)

  const activityList = activity || []
  const depositCount = activityList.filter((a: any) => a.activity_type === "deposit").length
  const payoutCount = activityList.filter(
    (a: any) => a.activity_type === "payout" || a.activity_type === "withdraw"
  ).length

  // Fetch live on-chain balances in parallel
  let totalSaved = 0
  await Promise.all(
    pools.map(async (pool) => {
      if (!pool.contract_address || pool.contract_address === "pending_deployment") return
      try {
        if (pool.type === "target") {
          const state = await fetchTargetState(pool.contract_address, address)
          totalSaved += stroopsToXlm(state.userBalance)
        } else if (pool.type === "flexible") {
          const state = await fetchFlexibleState(pool.contract_address, address)
          totalSaved += stroopsToXlm(state.userBalance)
        }
        // rotational: no per-user balance view — skip
      } catch {}
    })
  )

  // On-chain reputation tracker (deposits, completed pools, missed rounds).
  const onChain = await fetchReputation(address)
  const hasOnChainHistory =
    onChain.totalDeposits > 0n || onChain.poolsCompleted > 0 || onChain.missedRounds > 0

  // Prefer the genuine on-chain on-time rate once the tracker has data for
  // this address; otherwise fall back to the off-chain activity heuristic
  // (starts at 50, +5 per deposit (max +40), +10 per payout (max +10)).
  const reputation = hasOnChainHistory
    ? Math.round(onChain.onTimeRate / 100)
    : Math.min(100, 50 + Math.min(depositCount * 5, 40) + Math.min(payoutCount * 10, 10))

  return {
    totalSaved,
    groupsJoined: pools.length,
    successfulPayouts: payoutCount,
    reputation,
    onChain,
  }
}

export function Profile() {
  const { address } = useStellar()
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!address) { setLoading(false); return }
    fetchProfileStats(address)
      .then(setStats)
      .catch(() =>
        setStats({
          totalSaved: 0,
          groupsJoined: 0,
          successfulPayouts: 0,
          reputation: 50,
          onChain: { totalDeposits: 0n, poolsCompleted: 0, missedRounds: 0, onTimeRate: 10000 },
        })
      )
      .finally(() => setLoading(false))
  }, [address])

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k XLM` : `${n.toFixed(2)} XLM`

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Profile</h2>
        <p className="text-muted-foreground mt-1">Your on-chain savings reputation</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Wallet className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Wallet Address</h3>
              <p className="text-sm text-muted-foreground font-mono">
                {address ? `${address.slice(0, 10)}...${address.slice(-8)}` : "Not connected"}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Reputation Score</span>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <span className="text-2xl font-bold text-primary">{stats?.reputation ?? 50}%</span>
                )}
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-700"
                  style={{ width: `${stats?.reputation ?? 0}%` }}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <Badge className="bg-primary/10 text-primary hover:bg-primary/20">
                <Award className="h-3 w-3 mr-1" />
                {(stats?.reputation ?? 0) >= 80 ? "Trusted Member" : (stats?.reputation ?? 0) >= 60 ? "Active Saver" : "New Member"}
              </Badge>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-lg mb-6">Savings Statistics</h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-sm text-muted-foreground">Total Saved</span>
                </div>
                <span className="text-lg font-bold">{fmt(stats?.totalSaved ?? 0)}</span>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-sm text-muted-foreground">Groups Joined</span>
                </div>
                <span className="text-lg font-bold">{stats?.groupsJoined ?? 0}</span>
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Award className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-sm text-muted-foreground">Successful Payouts</span>
                </div>
                <span className="text-lg font-bold">{stats?.successfulPayouts ?? 0}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="font-semibold text-lg mb-6">Reputation Breakdown</h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-muted/30">
              <p className="text-sm text-muted-foreground">On-Time Rate</p>
              <p className="text-2xl font-bold mt-1">
                {((stats?.onChain.onTimeRate ?? 10000) / 100).toFixed(0)}%
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <p className="text-sm text-muted-foreground">Pools Completed</p>
              <p className="text-2xl font-bold mt-1">{stats?.onChain.poolsCompleted ?? 0}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <p className="text-sm text-muted-foreground">Missed Rounds</p>
              <p className="text-2xl font-bold mt-1">{stats?.onChain.missedRounds ?? 0}</p>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6 bg-muted/30">
        <h3 className="text-lg font-semibold mb-2">About Reputation Score</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Your reputation score is calculated from your on-chain savings activity — deposits, payouts, and group participation.
        </p>
        <ul className="space-y-2 text-sm">
          {[
            "Access to premium savings groups",
            "Lower fees on transactions",
            "Eligibility for microcredit loans",
          ].map((benefit) => (
            <li key={benefit} className="flex gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
              <span className="text-muted-foreground">{benefit}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
