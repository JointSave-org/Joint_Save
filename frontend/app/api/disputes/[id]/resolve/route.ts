/**
 * /api/disputes/[id]/resolve — Pool admin resolution (issue #208)
 *
 * POST { admin_address, outcome: "upheld" | "dismissed", resolution }
 *
 * Lets the pool creator close an active dispute directly — used for tie
 * votes, expired windows that should still get a verdict, or urgent cases.
 * Requires a written resolution note and logs to pool_activity.
 */

import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { writeLimiter } from "@/lib/rate-limit"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let body: { admin_address?: string; outcome?: string; resolution?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const adminAddress =
    typeof body.admin_address === "string" ? body.admin_address.toLowerCase() : ""
  const outcome = body.outcome
  const resolution = typeof body.resolution === "string" ? body.resolution.trim() : ""

  if (!id || !adminAddress) {
    return NextResponse.json(
      { error: "dispute id and admin_address are required" },
      { status: 400 }
    )
  }
  if (outcome !== "upheld" && outcome !== "dismissed") {
    return NextResponse.json({ error: 'outcome must be "upheld" or "dismissed"' }, { status: 422 })
  }
  if (!resolution) {
    return NextResponse.json({ error: "resolution note is required" }, { status: 422 })
  }

  const admin = getAdminClient()
  const { data: dispute } = await admin.from("disputes").select("*").eq("id", id).maybeSingle()
  if (!dispute) return NextResponse.json({ error: "Dispute not found" }, { status: 404 })

  const { data: pool } = await admin
    .from("pools")
    .select("creator_address")
    .eq("id", dispute.pool_id)
    .maybeSingle()
  if (!pool || pool.creator_address?.toLowerCase() !== adminAddress) {
    return NextResponse.json({ error: "Only the pool admin can resolve disputes" }, { status: 403 })
  }

  if (!["open", "voting"].includes(dispute.status)) {
    return NextResponse.json({ error: `Dispute is already ${dispute.status}` }, { status: 409 })
  }

  const resolvedStatus = outcome === "upheld" ? "resolved_upheld" : "resolved_dismissed"

  const { data: updated, error: updateError } = await admin
    .from("disputes")
    .update({
      status: resolvedStatus,
      resolution,
      resolved_by: adminAddress,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  await admin.from("pool_activity").insert({
    pool_id: dispute.pool_id,
    activity_type: "dispute_resolved",
    user_address: adminAddress,
    description:
      outcome === "upheld"
        ? `Dispute upheld by admin: ${resolution.slice(0, 140)}`
        : `Dispute dismissed by admin: ${resolution.slice(0, 140)}`,
  })

  return NextResponse.json({ dispute: updated })
}
