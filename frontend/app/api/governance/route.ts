/**
 * /api/governance — Off-chain mirror of DAO governance votes (issue #207).
 *
 * Proposals live on-chain; this endpoint only maintains the realtime vote
 * mirror in `governance_votes` so clients can update counts without
 * re-querying Soroban RPC.
 *
 * GET  /api/governance?pool_id=<id>[&proposal_id=<hex>]
 *   Returns mirrored votes, newest first.
 *
 * POST /api/governance { pool_id, proposal_id, voter_address, vote }
 *   Upserts the caller's mirrored vote. One row per (proposal_id, voter).
 */

import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"

const HEX_RE = /^[0-9a-fA-F]{1,128}$/

export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const poolId = req.nextUrl.searchParams.get("pool_id")
  const proposalId = req.nextUrl.searchParams.get("proposal_id")

  if (!poolId) {
    return NextResponse.json({ error: "pool_id required" }, { status: 400 })
  }

  try {
    let query = getAdminClient()
      .from("governance_votes")
      .select("proposal_id, voter_address, vote, created_at")
      .eq("pool_id", poolId)

    if (proposalId) query = query.eq("proposal_id", proposalId.toLowerCase())

    const { data, error } = await query.order("created_at", { ascending: false })

    if (error) throw error

    return NextResponse.json(data ?? [], {
      headers: { "Cache-Control": "private, no-cache" },
    })
  } catch (error) {
    console.error("Governance votes fetch error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch governance votes" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: { pool_id?: string; proposal_id?: string; voter_address?: string; vote?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { pool_id, proposal_id, voter_address, vote } = body
  const voter = voter_address?.toLowerCase()

  if (!pool_id || !proposal_id || !voter || typeof vote !== "boolean") {
    return NextResponse.json(
      { error: "pool_id, proposal_id, voter_address and vote are required" },
      { status: 400 }
    )
  }
  if (!HEX_RE.test(proposal_id)) {
    return NextResponse.json({ error: "proposal_id must be a hex string" }, { status: 400 })
  }

  // Only actual members of the pool may contribute to the mirror.
  const { data: member } = await getAdminClient()
    .from("pool_members")
    .select("id")
    .eq("pool_id", pool_id)
    .eq("member_address", voter)
    .maybeSingle()

  if (!member) {
    return NextResponse.json({ error: "Not a member of this pool" }, { status: 403 })
  }

  try {
    const { data, error } = await getAdminClient()
      .from("governance_votes")
      .upsert(
        {
          pool_id,
          proposal_id: proposal_id.toLowerCase(),
          voter_address: voter,
          vote,
        },
        { onConflict: "proposal_id,voter_address" }
      )
      .select("proposal_id, voter_address, vote, created_at")
      .single()

    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("Governance vote mirror error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record governance vote" },
      { status: 500 }
    )
  }
}
