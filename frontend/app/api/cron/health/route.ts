import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { readLimiter } from "@/lib/rate-limit"

const JOB_NAME = "auto-trigger-payouts"
const DEGRADED_AFTER_MS = 2 * 60 * 60 * 1000 // 2 hours
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * GET /api/cron/health
 *
 * Reports the health of the auto-trigger-payouts cron: the last successful
 * run (a pool_id-IS-NULL heartbeat row the Edge Function writes once per
 * completed invocation) and any per-pool failures logged in the last 24h.
 * Degraded when no successful run has landed in the last 2 hours — the cron
 * fires every 15 minutes, so that gap means several runs in a row failed.
 */
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const supabase = getAdminClient()
  const now = Date.now()

  const { data: lastSuccess, error: successError } = await supabase
    .from("cron_job_logs")
    .select("created_at")
    .eq("job_name", JOB_NAME)
    .eq("status", "success")
    .is("pool_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (successError) {
    return NextResponse.json({ error: "Failed to read cron job logs" }, { status: 500 })
  }

  const { data: failures, error: failuresError } = await supabase
    .from("cron_job_logs")
    .select("id, pool_id, error_message, created_at")
    .eq("job_name", JOB_NAME)
    .eq("status", "failed")
    .gte("created_at", new Date(now - FAILURE_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })

  if (failuresError) {
    return NextResponse.json({ error: "Failed to read cron job logs" }, { status: 500 })
  }

  const lastSuccessfulRun = lastSuccess?.created_at ?? null
  const neverRun = !lastSuccessfulRun
  const isDegraded = !neverRun && now - new Date(lastSuccessfulRun!).getTime() > DEGRADED_AFTER_MS

  return NextResponse.json({
    status: neverRun ? "pending" : isDegraded ? "degraded" : "healthy",
    lastSuccessfulRun,
    failuresLast24h: failures?.length ?? 0,
    failures: failures ?? [],
  })
}
