/**
 * /api/cron/archive-pools — daily pool archival sweep (issue #212)
 *
 * Scheduled by Vercel Cron at 02:00 UTC (see vercel.json). Vercel Cron issues
 * a GET, so GET is the real handler and POST delegates to it for manual runs
 * and for the endpoint shape the issue specifies.
 *
 * The sweep applies the criteria in lib/archival.ts, sets archived_at and
 * archive_reason on matching pools, writes an archive_log row for each, and
 * notifies the pool admin. It deletes nothing: archived pools keep every
 * member, activity, and metric row, stay readable and exportable, and their
 * on-chain contracts are untouched.
 *
 * Idempotent — already-archived pools are excluded from the query and
 * re-checked by evaluateArchival, so a double run is a no-op.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import {
  evaluateArchival,
  latestActivityAt,
  netBalanceFromActivity,
  type ArchivalCandidate,
  type ArchiveReason,
} from "@/lib/archival"

/**
 * Safety valve. A sweep that wanted to archive more than this in one run is
 * more likely a data problem — a bad backfill, a clock skew — than a real
 * cliff of dead pools, so it stops and reports instead of emptying Explore.
 */
const MAX_ARCHIVALS_PER_RUN = 200

interface PoolRow {
  id: string
  name: string
  status: string
  creator_address: string
  archived_at: string | null
  completed_at: string | null
  emergency_withdrawn_at: string | null
  created_at: string
}

interface ActivityRow {
  pool_id: string
  activity_type: string | null
  amount: number | null
  created_at: string
}

const REASON_MESSAGES: Record<ArchiveReason, string> = {
  completed: "it finished and the 7-day review window has passed",
  inactive_90d: "it had no activity for 90 days and holds no member funds",
  emergency_withdrawn: "funds were withdrawn in an emergency over 30 days ago",
  admin_archived: "an admin archived it",
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = getAdminClient()
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  // Only unarchived pools are candidates — this is the query the
  // idx_pools_archival_sweep partial index exists for.
  const { data: pools, error: poolsError } = await admin
    .from("pools")
    .select(
      "id, name, status, creator_address, archived_at, completed_at, emergency_withdrawn_at, created_at"
    )
    .is("archived_at", null)
    .returns<PoolRow[]>()

  if (poolsError || !pools) {
    await logRun(admin, "failed", poolsError?.message ?? "Failed to fetch pools")
    return NextResponse.json({ error: "Failed to fetch pools" }, { status: 500 })
  }

  if (pools.length === 0) {
    await logRun(admin, "success", null)
    return NextResponse.json(
      { scanned: 0, archived: 0, byReason: {}, errors: [] },
      { headers: { "Cache-Control": "private, no-cache" } }
    )
  }

  // One activity read for the whole sweep rather than a query per pool: the
  // per-pool loop in snapshot-pool-metrics is already the slowest cron here,
  // and this one runs over the same table.
  const { data: activities, error: activityError } = await admin
    .from("pool_activity")
    .select("pool_id, activity_type, amount, created_at")
    .in(
      "pool_id",
      pools.map((p) => p.id)
    )
    .returns<ActivityRow[]>()

  if (activityError) {
    await logRun(admin, "failed", activityError.message)
    return NextResponse.json({ error: "Failed to fetch pool activity" }, { status: 500 })
  }

  const activityByPool = new Map<string, ActivityRow[]>()
  for (const activity of activities ?? []) {
    const bucket = activityByPool.get(activity.pool_id)
    if (bucket) bucket.push(activity)
    else activityByPool.set(activity.pool_id, [activity])
  }

  const candidates: { pool: PoolRow; reason: ArchiveReason; note: string }[] = []

  for (const pool of pools) {
    const poolActivity = activityByPool.get(pool.id) ?? []
    const candidate: ArchivalCandidate = {
      id: pool.id,
      status: pool.status,
      archived_at: pool.archived_at,
      completed_at: pool.completed_at,
      emergency_withdrawn_at: pool.emergency_withdrawn_at,
      last_activity_at: latestActivityAt(poolActivity),
      created_at: pool.created_at,
      net_balance: netBalanceFromActivity(poolActivity),
    }

    const decision = evaluateArchival(candidate, now)
    if (decision.archive && decision.reason) {
      candidates.push({ pool, reason: decision.reason, note: decision.note ?? "" })
    }
  }

  if (candidates.length > MAX_ARCHIVALS_PER_RUN) {
    const message = `Refusing to archive ${candidates.length} pools in one run (limit ${MAX_ARCHIVALS_PER_RUN})`
    await logRun(admin, "warning", message)
    return NextResponse.json(
      { scanned: pools.length, archived: 0, byReason: {}, errors: [message] },
      { status: 409 }
    )
  }

  const errors: string[] = []
  const byReason: Partial<Record<ArchiveReason, number>> = {}
  let archived = 0

  for (const { pool, reason, note } of candidates) {
    const { error: updateError } = await admin
      .from("pools")
      .update({ archived_at: nowIso, archive_reason: reason })
      // Re-assert the unarchived precondition so a manual archive landing
      // between the scan and this write cannot be overwritten.
      .eq("id", pool.id)
      .is("archived_at", null)

    if (updateError) {
      errors.push(`${pool.id}: ${updateError.message}`)
      continue
    }

    archived++
    byReason[reason] = (byReason[reason] ?? 0) + 1

    const { error: logError } = await admin.from("archive_log").insert({
      pool_id: pool.id,
      action: "archived",
      reason,
      triggered_by: "cron",
      automated: true,
      note,
    })
    if (logError) errors.push(`${pool.id} (log): ${logError.message}`)

    // Summary notification to the pool admin. A failure here must not undo a
    // successful archival, so it is recorded and the sweep continues.
    const { error: notifyError } = await admin.from("notifications").insert({
      wallet_address: pool.creator_address?.toLowerCase() ?? "",
      pool_id: pool.id,
      activity_type: "pool_archived",
      message: `"${pool.name}" was archived because ${REASON_MESSAGES[reason]}. Its history is still available under the Archived tab, and you can restore it from the pool page.`,
      read: false,
    })
    if (notifyError) errors.push(`${pool.id} (notify): ${notifyError.message}`)
  }

  await logRun(admin, errors.length > 0 ? "warning" : "success", errors[0] ?? null)

  return NextResponse.json(
    { scanned: pools.length, archived, byReason, errors },
    { headers: { "Cache-Control": "private, no-cache" } }
  )
}

/** Manual/scripted trigger — the issue specifies POST for this endpoint. */
export async function POST(req: NextRequest) {
  return GET(req)
}

async function logRun(
  admin: ReturnType<typeof getAdminClient>,
  status: "success" | "warning" | "failed",
  errorMessage: string | null
) {
  const { error } = await admin.from("cron_job_logs").insert({
    job_name: "archive-pools",
    status,
    error_message: errorMessage,
  })
  if (error) console.error("Failed to log archive-pools run:", error.message)
}
