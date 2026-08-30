/**
 * GET /api/admin/incidents?poolId=<id>&callerAddress=<address>
 *
 * The review queue for a pool: every automatic decision the security circuit
 * breaker took, including the ones it decided against and the ones dry-run held
 * back. This is what an admin opens after a notification says their pool was
 * paused.
 *
 * Authorization mirrors `/api/admin/audit-log`: the caller's address is checked
 * server-side against the pool's `creator_address` before anything is returned.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { readLimiter } from "@/lib/rate-limit"
import { jsonPrivate } from "@/lib/cache-headers"

/** Newest first, and capped: this is a review screen, not an export. */
const MAX_ROWS = 100

export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const poolId = req.nextUrl.searchParams.get("poolId")
  if (!poolId) {
    return NextResponse.json({ error: "poolId is required" }, { status: 400 })
  }

  const callerAddress = req.nextUrl.searchParams.get("callerAddress")
  if (!callerAddress) {
    return NextResponse.json({ error: "callerAddress is required" }, { status: 400 })
  }

  const admin = getAdminClient()

  const { data: pool, error: poolErr } = await admin
    .from("pools")
    .select("id, name, status, creator_address, pause_reason, paused_at")
    .eq("id", poolId)
    .maybeSingle()

  if (poolErr || !pool) {
    return NextResponse.json({ error: "Pool not found" }, { status: 404 })
  }

  if (callerAddress.toLowerCase() !== pool.creator_address.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: incidents, error: incidentsErr } = await admin
    .from("incidents")
    .select("*")
    .eq("pool_id", poolId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS)

  if (incidentsErr) {
    return NextResponse.json({ error: "Failed to fetch incidents" }, { status: 500 })
  }

  const rows = incidents ?? []

  return jsonPrivate({
    pool: {
      id: pool.id,
      name: pool.name,
      status: pool.status,
      pause_reason: pool.pause_reason,
      paused_at: pool.paused_at,
    },
    incidents: rows,
    summary: {
      total: rows.length,
      open: rows.filter((i) => i.status === "open").length,
      executed: rows.filter((i) => i.executed).length,
      dryRun: rows.filter((i) => i.dry_run).length,
      // Pauses the platform applied that still need the admin's signature
      // on-chain. The contract stays live until they sign.
      awaitingOnchain: rows.filter((i) => i.onchain_status === "pending").length,
    },
  })
}
