/**
 * POST /api/admin/incidents/[id]
 *
 * Admin review and recovery for one incident. Three actions, all of them
 * requiring the pool's creator:
 *
 *  - `resolve`: close the incident with a note. The pool stays paused.
 *  - `resume`: close it and put the pool back to active.
 *  - `record_onchain`: attach the hash of the `pause` or `unpause`
 *    transaction the admin signed with their own wallet.
 *
 * There is deliberately no action here that moves funds. `emergency_withdraw`
 * remains a manual, admin-only contract call and is never reachable from an
 * automated path or from this endpoint.
 *
 * Authorization follows `/api/disputes/[id]/resolve`: the caller's address is
 * compared server-side against the pool's `creator_address`.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"

type IncidentAdminAction = "resolve" | "resume" | "record_onchain"

const ACTIONS: IncidentAdminAction[] = ["resolve", "resume", "record_onchain"]

/** Stellar transaction hashes are 64 hex characters. */
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let body: {
    admin_address?: string
    action?: string
    resolution_notes?: string
    tx_hash?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const adminAddress =
    typeof body.admin_address === "string" ? body.admin_address.toLowerCase() : ""
  const action = body.action as IncidentAdminAction | undefined
  const notes = typeof body.resolution_notes === "string" ? body.resolution_notes.trim() : ""
  const txHash = typeof body.tx_hash === "string" ? body.tx_hash.trim() : ""

  if (!id || !adminAddress) {
    return NextResponse.json(
      { error: "incident id and admin_address are required" },
      { status: 400 }
    )
  }
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(", ")}` },
      { status: 422 }
    )
  }

  const admin = getAdminClient()

  const { data: incident } = await admin.from("incidents").select("*").eq("id", id).maybeSingle()
  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 })
  }

  const { data: pool } = await admin
    .from("pools")
    .select("id, name, status, creator_address")
    .eq("id", incident.pool_id)
    .maybeSingle()
  if (!pool || pool.creator_address?.toLowerCase() !== adminAddress) {
    return NextResponse.json(
      { error: "Only the pool admin can act on this incident" },
      { status: 403 }
    )
  }

  const now = new Date().toISOString()

  // ── Record the on-chain transaction the admin signed ──────────────────────
  if (action === "record_onchain") {
    if (!TX_HASH_PATTERN.test(txHash)) {
      return NextResponse.json(
        { error: "tx_hash must be a 64-character hex hash" },
        { status: 422 }
      )
    }

    const { data: updated, error } = await admin
      .from("incidents")
      .update({
        onchain_status: "confirmed",
        onchain_tx_hash: txHash,
        updated_at: now,
      })
      .eq("id", id)
      .select("*")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await admin.from("pool_activity").insert({
      pool_id: incident.pool_id,
      activity_type: "security_onchain_pause",
      user_address: adminAddress,
      tx_hash: txHash,
      description: `Admin signed the on-chain pause for incident ${id}`,
    })

    return NextResponse.json({ incident: updated })
  }

  // ── Resolve, optionally resuming the pool ─────────────────────────────────
  if (incident.status === "resolved") {
    return NextResponse.json({ error: "Incident is already resolved" }, { status: 409 })
  }
  if (!notes) {
    return NextResponse.json({ error: "resolution_notes is required" }, { status: 422 })
  }

  const { data: updated, error: updateError } = await admin
    .from("incidents")
    .update({
      status: "resolved",
      resolved_by: adminAddress,
      resolution_notes: notes,
      resolved_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .select("*")
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  let resumed = false
  if (action === "resume" && pool.status === "paused") {
    const { data: resumedPool, error: resumeError } = await admin
      .from("pools")
      .update({ status: "active", pause_reason: null, paused_at: null })
      .eq("id", incident.pool_id)
      .eq("status", "paused")
      .select("id")

    if (resumeError) {
      return NextResponse.json({ error: resumeError.message }, { status: 500 })
    }
    resumed = (resumedPool ?? []).length > 0
  }

  await admin.from("pool_activity").insert({
    pool_id: incident.pool_id,
    activity_type: resumed ? "security_incident_resumed" : "security_incident_resolved",
    user_address: adminAddress,
    description: `${resumed ? "Pool resumed" : "Incident resolved"}: ${notes.slice(0, 140)}`,
  })

  return NextResponse.json({
    incident: updated,
    resumed,
    /**
     * Resuming here only lifts the platform pause. If the admin already signed
     * an on-chain pause, the contract is still paused and needs its own
     * `unpause` call, signed by the same wallet.
     */
    onchainUnpauseRequired: resumed && incident.onchain_status === "confirmed",
  })
}
