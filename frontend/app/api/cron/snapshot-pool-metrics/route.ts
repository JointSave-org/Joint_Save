import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"

// Snapshots each pool's current balance into pool_daily_metrics.
// Triggered daily by Vercel Cron (see vercel.json). Reuses the same
// deposit/withdrawal aggregation logic as /api/analytics.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getAdminClient()

  const { data: pools, error: poolsError } = await supabase
    .from("pools")
    .select("id")
    .returns<{ id: string }[]>()
  if (poolsError || !pools) {
    return NextResponse.json({ error: "Failed to fetch pools" }, { status: 500 })
  }

  const today = new Date().toISOString().slice(0, 10)
  let updated = 0
  const errors: string[] = []

  for (const pool of pools) {
    const { data: activities, error: actError } = await supabase
      .from("pool_activity")
      .select("activity_type, amount")
      .eq("pool_id", pool.id)
      .returns<{ activity_type: string; amount: number | null }[]>()

    if (actError) {
      errors.push(`${pool.id}: ${actError.message}`)
      continue
    }

    const acts = activities || []
    const totalDeposits = acts
      .filter((a) => a.activity_type?.toLowerCase() === "deposit")
      .reduce((sum, a) => sum + (a.amount || 0), 0)
    const totalWithdrawals = acts
      .filter(
        (a) =>
          a.activity_type?.toLowerCase() === "withdraw" ||
          a.activity_type?.toLowerCase() === "payout"
      )
      .reduce((sum, a) => sum + (a.amount || 0), 0)

    const { count: activeMembersCount } = await supabase
      .from("pool_members")
      .select("*", { count: "exact", head: true })
      .eq("pool_id", pool.id)
      .eq("status", "paid")

    const payload = {
      pool_id: pool.id,
      date: today,
      total_balance: totalDeposits - totalWithdrawals,
      total_deposits: totalDeposits,
      total_withdrawals: totalWithdrawals,
      active_members_count: activeMembersCount ?? 0,
    }

    const { error: upsertError } = await supabase
      .from("pool_daily_metrics")
      .upsert(payload as never, { onConflict: "pool_id,date" })

    if (upsertError) {
      errors.push(`${pool.id}: ${upsertError.message}`)
    } else {
      updated++
    }
  }

  return NextResponse.json({ updated, total: pools.length, errors })
}