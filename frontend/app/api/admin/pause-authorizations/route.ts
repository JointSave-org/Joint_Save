/**
 * Pre-signed authorizations that let the circuit breaker pause a pool on-chain.
 *
 * ```
 * GET  /api/admin/pause-authorizations?poolId=<id>&callerAddress=<address>
 * POST /api/admin/pause-authorizations   { admin_address, pool_id, entry_xdr }
 * POST /api/admin/pause-authorizations   { admin_address, action: "revoke", id }
 * ```
 *
 * The pool admin signs a `SorobanAuthorizationEntry` covering exactly
 * `pause(admin)` on their own pool and hands it over. The platform stores it and
 * submits it if the breaker trips, paying the fee itself. It never holds the
 * admin's key, and the entry authorises nothing but that one call.
 *
 * The entry is validated here rather than trusted: what the client claims it
 * signed and what it actually signed are checked against each other, and against
 * the pool's contract and admin.
 *
 * The entry XDR is never returned by GET. It is a bearer credential: anyone
 * holding it could pause the pool, which would be a griefing vector against the
 * pool's own members.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"
import { jsonPrivate } from "@/lib/cache-headers"
import { currentLedger, inspectPauseAuthorization } from "@/lib/server/pause-onchain"

/**
 * An entry has to be good for a while to be worth storing. Below this the admin
 * would be re-signing constantly and the breaker would rarely find one usable.
 * About a day at six seconds per ledger.
 */
const MIN_USEFUL_LEDGERS = 14_400

export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const poolId = req.nextUrl.searchParams.get("poolId")
  const callerAddress = req.nextUrl.searchParams.get("callerAddress")
  if (!poolId || !callerAddress) {
    return NextResponse.json({ error: "poolId and callerAddress are required" }, { status: 400 })
  }

  const admin = getAdminClient()

  const { data: pool } = await admin
    .from("pools")
    .select("id, creator_address, contract_address")
    .eq("id", poolId)
    .maybeSingle()
  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 })
  if (callerAddress.toLowerCase() !== pool.creator_address.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: rows, error } = await admin
    .from("pause_authorizations")
    // Note the absent entry_xdr: it never leaves the server.
    .select("id, expiration_ledger, used_at, used_by_incident, revoked_at, created_at")
    .eq("pool_id", poolId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: "Failed to fetch authorizations" }, { status: 500 })
  }

  const ledger = await currentLedger()
  const authorizations = (rows ?? []).map((row) => ({
    ...row,
    status:
      row.revoked_at !== null
        ? "revoked"
        : row.used_at !== null
          ? "used"
          : ledger !== null && row.expiration_ledger <= ledger
            ? "expired"
            : "active",
  }))

  return jsonPrivate({
    currentLedger: ledger,
    authorizations,
    /** True when the breaker could pause this pool on-chain right now. */
    armed: authorizations.some((a) => a.status === "active"),
  })
}

export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: {
    admin_address?: string
    pool_id?: string
    entry_xdr?: string
    action?: string
    id?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const adminAddress = typeof body.admin_address === "string" ? body.admin_address.trim() : ""
  if (!adminAddress) {
    return NextResponse.json({ error: "admin_address is required" }, { status: 400 })
  }

  const admin = getAdminClient()

  // ── Revoke ────────────────────────────────────────────────────────────────
  if (body.action === "revoke") {
    if (!body.id) {
      return NextResponse.json({ error: "id is required to revoke" }, { status: 400 })
    }

    const { data: existing } = await admin
      .from("pause_authorizations")
      .select("id, pool_id")
      .eq("id", body.id)
      .maybeSingle()
    if (!existing) {
      return NextResponse.json({ error: "Authorization not found" }, { status: 404 })
    }

    const { data: pool } = await admin
      .from("pools")
      .select("creator_address")
      .eq("id", existing.pool_id)
      .maybeSingle()
    if (!pool || pool.creator_address?.toLowerCase() !== adminAddress.toLowerCase()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { error } = await admin
      .from("pause_authorizations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.id)
      .is("revoked_at", null)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ revoked: true })
  }

  // ── Register ──────────────────────────────────────────────────────────────
  const poolId = typeof body.pool_id === "string" ? body.pool_id : ""
  const entryXdr = typeof body.entry_xdr === "string" ? body.entry_xdr.trim() : ""
  if (!poolId || !entryXdr) {
    return NextResponse.json({ error: "pool_id and entry_xdr are required" }, { status: 400 })
  }

  const { data: pool } = await admin
    .from("pools")
    .select("id, creator_address, contract_address")
    .eq("id", poolId)
    .maybeSingle()
  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 })
  if (pool.creator_address?.toLowerCase() !== adminAddress.toLowerCase()) {
    return NextResponse.json(
      { error: "Only the pool admin can authorise the automatic pause" },
      { status: 403 }
    )
  }
  if (!pool.contract_address) {
    return NextResponse.json(
      { error: "This pool has no contract address on record" },
      { status: 409 }
    )
  }

  const inspection = inspectPauseAuthorization(entryXdr)
  if (!inspection.ok) {
    return NextResponse.json({ error: inspection.reason }, { status: 422 })
  }
  if (inspection.contractAddress !== pool.contract_address) {
    return NextResponse.json(
      { error: "The authorization is for a different contract than this pool's" },
      { status: 422 }
    )
  }
  if (inspection.adminAddress?.toLowerCase() !== pool.creator_address.toLowerCase()) {
    return NextResponse.json(
      { error: "The authorization was signed by an address that is not this pool's admin" },
      { status: 422 }
    )
  }

  const ledger = await currentLedger()
  const expirationLedger = inspection.expirationLedger ?? 0
  if (ledger !== null && expirationLedger - ledger < MIN_USEFUL_LEDGERS) {
    return NextResponse.json(
      {
        error:
          "That authorization expires too soon to be useful. Sign one valid for at least a day.",
      },
      { status: 422 }
    )
  }

  const { data: created, error } = await admin
    .from("pause_authorizations")
    .insert({
      pool_id: poolId,
      contract_address: pool.contract_address,
      admin_address: pool.creator_address,
      entry_xdr: entryXdr,
      expiration_ledger: expirationLedger,
    })
    .select("id, expiration_ledger, created_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from("pool_activity").insert({
    pool_id: poolId,
    activity_type: "security_pause_authorized",
    user_address: adminAddress,
    description: `Admin pre-authorised the automatic pause until ledger ${expirationLedger}`,
  })

  return NextResponse.json({ authorization: created }, { status: 201 })
}
