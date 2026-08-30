/**
 * /api/pools/[id]/unarchive — reverse a pool archival (issue #212)
 *
 * PUT { admin_address, note? }
 *
 * The escape hatch for a false positive: an admin returning to a pool the
 * daily sweep hid, or undoing their own manual archival. Clears archived_at
 * and archive_reason so the pool returns to Explore and the active My Groups
 * tab, and logs the reversal to archive_log alongside the archival it undoes.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"
import type { ArchiveReason } from "@/lib/archival"

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let body: { admin_address?: string; note?: string }
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

  const admin = getAdminClient()

  const { data: pool } = await admin
    .from("pools")
    .select("id, name, creator_address, archived_at, archive_reason")
    .eq("id", id)
    .maybeSingle()

  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 })

  if (pool.creator_address?.toLowerCase() !== adminAddress) {
    return NextResponse.json(
      { error: "Only the pool admin can unarchive this pool" },
      { status: 403 }
    )
  }

  if (!pool.archived_at) {
    return NextResponse.json({ error: "Pool is not archived" }, { status: 409 })
  }

  // Carried onto the log row so the reversal records what it undid — an
  // unarchive with no reason of its own would lose that context.
  const previousReason = (pool.archive_reason as ArchiveReason | null) ?? "admin_archived"

  const { data: updated, error: updateError } = await admin
    .from("pools")
    .update({ archived_at: null, archive_reason: null })
    .eq("id", id)
    .select("*")
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  await admin.from("archive_log").insert({
    pool_id: id,
    action: "unarchived",
    reason: previousReason,
    triggered_by: adminAddress,
    automated: false,
    note,
  })

  await admin.from("pool_activity").insert({
    pool_id: id,
    activity_type: "pool_unarchived",
    user_address: adminAddress,
    description: note ? `Pool restored from archive: ${note}` : "Pool restored from archive",
  })

  return NextResponse.json({ success: true, pool: updated })
}
