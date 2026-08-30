/**
 * /api/pools/[id]/archive — manual pool archival (issue #212)
 *
 * PUT { admin_address, reason?, note? }
 *
 * Lets the pool creator archive a pool ahead of the daily sweep — a circle
 * that wound down early, a duplicate, a test pool. Nothing is deleted: the
 * pool keeps every member, activity, and metric row it owned, and its
 * on-chain contract is unaffected. The pool simply leaves Explore and the
 * active My Groups tab and becomes read-only.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"
import { checkWalletProof } from "@/lib/server/wallet-proof"
import { archivePoolMessage } from "@/lib/wallet-proof"
import { isArchiveReason, type ArchiveReason } from "@/lib/archival"

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let body: {
    admin_address?: string
    signature?: string
    signed_at?: number
    reason?: string
    note?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const adminAddress =
    typeof body.admin_address === "string" ? body.admin_address.toLowerCase() : ""
  const note = typeof body.note === "string" ? body.note.trim() || null : null

  if (!id || !adminAddress) {
    return NextResponse.json({ error: "pool id and admin_address are required" }, { status: 400 })
  }

  // A manual archival is `admin_archived` unless the admin names a specific
  // reason — the same vocabulary the cron writes, so the log stays uniform.
  const reason: ArchiveReason = isArchiveReason(body.reason) ? body.reason : "admin_archived"
  if (body.reason !== undefined && !isArchiveReason(body.reason)) {
    return NextResponse.json(
      {
        error:
          "reason must be one of: completed, inactive_90d, admin_archived, emergency_withdrawn",
      },
      { status: 422 }
    )
  }

  const admin = getAdminClient()

  const { data: pool } = await admin
    .from("pools")
    .select("id, name, creator_address, archived_at")
    .eq("id", id)
    .maybeSingle()

  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 })

  if (pool.creator_address?.toLowerCase() !== adminAddress) {
    return NextResponse.json(
      { error: "Only the pool admin can archive this pool" },
      { status: 403 }
    )
  }

  // Ownership alone is not proof: admin_address is caller-supplied. The
  // signature is verified against the pool's admin as the database knows it, so
  // naming someone else's address buys nothing.
  const proof = checkWalletProof({
    address: pool.creator_address,
    message: archivePoolMessage(id, Number(body.signed_at)),
    signature: body.signature,
    signedAt: body.signed_at,
  })
  if (!proof.ok) {
    return NextResponse.json({ error: proof.reason }, { status: 403 })
  }

  if (pool.archived_at) {
    return NextResponse.json({ error: "Pool is already archived" }, { status: 409 })
  }

  const archivedAt = new Date().toISOString()

  const { data: updated, error: updateError } = await admin
    .from("pools")
    .update({ archived_at: archivedAt, archive_reason: reason })
    .eq("id", id)
    .select("*")
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  await admin.from("archive_log").insert({
    pool_id: id,
    action: "archived",
    reason,
    triggered_by: adminAddress,
    automated: false,
    note,
  })

  // Mirrored into the activity feed so members see why the pool went quiet
  // rather than finding it silently gone from their list.
  await admin.from("pool_activity").insert({
    pool_id: id,
    activity_type: "pool_archived",
    user_address: adminAddress,
    description: note ? `Pool archived by admin: ${note}` : "Pool archived by admin",
  })

  return NextResponse.json({ success: true, pool: updated })
}
