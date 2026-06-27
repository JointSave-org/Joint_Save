import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { readLimiter } from "@/lib/rate-limit"

export interface AuditRow {
  id: string
  pool_id: string
  pool_name: string | null
  activity_type: string
  user_address: string | null
  amount: number | null
  tx_hash: string | null
  description: string | null
  created_at: string
  /** True when the DB total_saved disagrees with the activity sum for this pool. */
  inconsistent: boolean
}

/**
 * GET /api/admin/audit-log?poolId=<id>
 *
 * Returns all pool_activity rows for the given pool together with a
 * per-pool consistency flag: `inconsistent` is true when the pool's
 * recorded `total_saved` diverges from the sum of deposit/withdrawal
 * activity rows by more than 0.01 (floating-point tolerance).
 *
 * Only the pool creator should call this route; the component enforces
 * that guard on the client side.  A missing poolId returns 400.
 */
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const poolId = req.nextUrl.searchParams.get("poolId")
  if (!poolId) {
    return NextResponse.json({ error: "poolId is required" }, { status: 400 })
  }

  const { data: pool, error: poolErr } = await supabase
    .from("pools")
    .select("id, name, total_saved")
    .eq("id", poolId)
    .single()

  if (poolErr || !pool) {
    return NextResponse.json({ error: "Pool not found" }, { status: 404 })
  }

  const { data: activity, error: actErr } = await supabase
    .from("pool_activity")
    .select("id, pool_id, activity_type, user_address, amount, tx_hash, description, created_at")
    .eq("pool_id", poolId)
    .order("created_at", { ascending: false })

  if (actErr) {
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })
  }

  const rows = activity ?? []

  // ── Consistency check ──────────────────────────────────────────────────────
  const activityNet = rows.reduce((sum: number, r: { activity_type: string; amount: number | null }) => {
    const amt = r.amount ?? 0
    const t = r.activity_type.toLowerCase()
    if (t === "deposit") return sum + amt
    if (t === "withdraw" || t === "payout") return sum - amt
    return sum
  }, 0)

  const recorded = pool.total_saved ?? 0
  const inconsistent = Math.abs(activityNet - recorded) > 0.01

  const auditRows: AuditRow[] = rows.map((r: { id: string; pool_id: string; activity_type: string; user_address: string | null; amount: number | null; tx_hash: string | null; description: string | null; created_at: string }) => ({
    ...r,
    pool_name: pool.name,
    inconsistent,
  }))

  return NextResponse.json({ rows: auditRows, inconsistent, activityNet, recorded })
}
