import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { readLimiter } from "@/lib/rate-limit"

// Batched sparkline data for many pools in one request, so the
// Explore/My Groups grid doesn't fire one fetch per card.
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const idsParam = req.nextUrl.searchParams.get("poolIds")
  if (!idsParam) return NextResponse.json({ error: "poolIds required" }, { status: 400 })
  const poolIds = idsParam.split(",").filter(Boolean).slice(0, 100)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from("pool_daily_metrics")
    .select("pool_id, date, total_balance")
    .in("pool_id", poolIds)
    .gte("date", thirtyDaysAgo)
    .order("date", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byPool: Record<string, number[]> = {}
  for (const row of data || []) {
    if (!byPool[row.pool_id]) byPool[row.pool_id] = []
    byPool[row.pool_id].push(row.total_balance)
  }

  return NextResponse.json({ history: byPool })
}