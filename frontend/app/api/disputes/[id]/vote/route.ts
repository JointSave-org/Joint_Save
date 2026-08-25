/**
 * /api/disputes/[id]/vote — Cast a member vote on a dispute (issue #208)
 *
 * POST { voter_address, vote: boolean }
 *
 * Rules:
 *  - Voter must be a pool member and cannot be the filer or the target.
 *  - One vote per wallet per dispute (enforced by the dispute_votes PK).
 *  - The dispute must still be open/voting and unexpired.
 *  - When one side reaches half the pool (rounded up), the dispute is
 *    auto-resolved and logged to pool_activity.
 */

import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { writeLimiter } from "@/lib/rate-limit"
import { canVoteOnDispute, votesNeededToResolve } from "@/lib/disputes"
import type { Database } from "@/lib/supabase"

type DisputeRow = Database["public"]["Tables"]["disputes"]["Row"]
type DisputeUpdate = Database["public"]["Tables"]["disputes"]["Update"]

const UNIQUE_VIOLATION = "23505"

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let body: { voter_address?: string; vote?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const voter = typeof body.voter_address === "string" ? body.voter_address.toLowerCase() : ""
  const vote = body.vote
  if (!id || !voter || typeof vote !== "boolean") {
    return NextResponse.json(
      { error: "dispute id, voter_address and boolean vote are required" },
      { status: 400 }
    )
  }

  const admin = getAdminClient()
  const { data: dispute } = await admin
    .from("disputes")
    .select("*")
    .eq("id", id)
    .maybeSingle<DisputeRow>()
  if (!dispute) return NextResponse.json({ error: "Dispute not found" }, { status: 404 })

  if (!["open", "voting"].includes(dispute.status)) {
    return NextResponse.json({ error: `Dispute is already ${dispute.status}` }, { status: 409 })
  }
  if (new Date(dispute.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Voting window has expired" }, { status: 409 })
  }

  // Server-side membership check (UI gating is not security).
  const { data: membership } = await admin
    .from("pool_members")
    .select("id")
    .eq("pool_id", dispute.pool_id)
    .eq("member_address", voter)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this pool" }, { status: 403 })
  }

  if (!canVoteOnDispute(voter, dispute, false)) {
    return NextResponse.json({ error: "Filers and dispute targets cannot vote" }, { status: 403 })
  }

  const { error: insertError } = await admin.from("dispute_votes").insert({
    dispute_id: id,
    voter_address: voter,
    vote,
  })
  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: "You have already voted on this dispute" }, { status: 409 })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  const forCount = dispute.votes_for + (vote ? 1 : 0)
  const againstCount = dispute.votes_against + (vote ? 0 : 1)

  // Majority threshold: half of current members, rounded up.
  const { count: memberCount } = await admin
    .from("pool_members")
    .select("id", { count: "exact", head: true })
    .eq("pool_id", dispute.pool_id)
  const needed = votesNeededToResolve(memberCount ?? 0)

  let resolvedStatus: DisputeRow["status"] | null = null
  if (needed > 0 && forCount >= needed) resolvedStatus = "resolved_upheld"
  else if (needed > 0 && againstCount >= needed) resolvedStatus = "resolved_dismissed"

  const update: DisputeUpdate = {
    votes_for: forCount,
    votes_against: againstCount,
  }
  if (dispute.status === "open") update.status = "voting"
  if (resolvedStatus) {
    update.status = resolvedStatus
    update.resolved_by = voter
    update.resolved_at = new Date().toISOString()
  }

  const { data: updated, error: updateError } = await admin
    .from("disputes")
    .update(update)
    .eq("id", id)
    .select("*")
    .single<DisputeRow>()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  if (resolvedStatus) {
    await admin.from("pool_activity").insert({
      pool_id: dispute.pool_id,
      activity_type: "dispute_resolved",
      user_address: voter,
      description:
        resolvedStatus === "resolved_upheld"
          ? "Dispute upheld by community vote"
          : "Dispute dismissed by community vote",
    })
  }

  return NextResponse.json({ dispute: updated })
}
