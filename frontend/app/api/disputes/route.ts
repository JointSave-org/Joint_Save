/**
 * /api/disputes — Pool dispute resolution API (issue #208)
 *
 * GET  /api/disputes?pool_id=<id>[&status=open,voting]
 *   Lists disputes for a pool, newest first.
 *
 * POST /api/disputes
 *   { pool_id, filer_address, dispute_type, description,
 *     target_address?, evidence_urls? }
 *   Files a new dispute. Members only; one active dispute per filer per pool;
 *   auto-expires after DISPUTE_EXPIRY_HOURS.
 */

import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"
import {
  DISPUTE_DESCRIPTION_MAX_LENGTH,
  DISPUTE_EXPIRY_HOURS,
  DISPUTE_MAX_EVIDENCE_URLS,
  isDisputeType,
  validateEvidenceUrls,
} from "@/lib/disputes"
import type { DisputeStatus } from "@/lib/disputes"

const ACTIVE_STATUSES = ["open", "voting"] as const

interface DisputeRow {
  id: string
  pool_id: string
  filer_address: string
  target_address: string | null
  dispute_type: string
  description: string
  evidence_urls: string[]
  status: string
  resolution: string | null
  votes_for: number
  votes_against: number
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  expires_at: string
}

async function isMember(poolId: string, wallet: string): Promise<boolean> {
  const { data } = await getAdminClient()
    .from("pool_members")
    .select("id")
    .eq("pool_id", poolId)
    .eq("member_address", wallet.toLowerCase())
    .maybeSingle()
  return data !== null
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const poolId = req.nextUrl.searchParams.get("pool_id")
  const statusParam = req.nextUrl.searchParams.get("status")
  if (!poolId) return NextResponse.json({ error: "pool_id required" }, { status: 400 })

  let query = getAdminClient()
    .from("disputes")
    .select("*")
    .eq("pool_id", poolId)
    .order("created_at", { ascending: false })
    .limit(100)

  if (statusParam) {
    const VALID_STATUSES: readonly DisputeStatus[] = [
      "open",
      "voting",
      "resolved_upheld",
      "resolved_dismissed",
      "expired",
    ]
    const statuses = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is DisputeStatus => (VALID_STATUSES as readonly string[]).includes(s))
    if (statuses.length > 0) query = query.in("status", statuses)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ disputes: data ?? [] })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const poolId = typeof body.pool_id === "string" ? body.pool_id : ""
  const filer = typeof body.filer_address === "string" ? body.filer_address.toLowerCase() : ""
  const target =
    typeof body.target_address === "string" && body.target_address.trim().length > 0
      ? body.target_address.trim().toLowerCase()
      : null
  const disputeType = body.dispute_type
  const description = typeof body.description === "string" ? body.description.trim() : ""

  if (!poolId || !filer) {
    return NextResponse.json({ error: "pool_id and filer_address are required" }, { status: 400 })
  }
  if (!isDisputeType(disputeType)) {
    return NextResponse.json(
      {
        error:
          "dispute_type must be one of: missed_deposit, unfair_penalty, admin_abuse, member_misconduct, other",
      },
      { status: 422 }
    )
  }
  if (!description || description.length > DISPUTE_DESCRIPTION_MAX_LENGTH) {
    return NextResponse.json(
      { error: `description is required (max ${DISPUTE_DESCRIPTION_MAX_LENGTH} characters)` },
      { status: 422 }
    )
  }

  const evidence = validateEvidenceUrls(body.evidence_urls)
  if (evidence.invalid.length > 0) {
    return NextResponse.json(
      { error: "evidence_urls must be valid http(s) URLs", invalid: evidence.invalid },
      { status: 422 }
    )
  }

  // Filer must be a pool member; an identified target must be too.
  const filerIsMember = await isMember(poolId, filer)
  if (!filerIsMember) {
    return NextResponse.json({ error: "Not a member of this pool" }, { status: 403 })
  }
  if (target && target !== filer) {
    const admin = getAdminClient()
    const [targetIsMember, { data: pool }] = await Promise.all([
      isMember(poolId, target),
      admin.from("pools").select("creator_address").eq("id", poolId).maybeSingle(),
    ])
    const isAdmin = pool?.creator_address?.toLowerCase() === target
    if (!targetIsMember && !isAdmin) {
      return NextResponse.json(
        { error: "Target address is not a pool participant" },
        { status: 422 }
      )
    }
  }

  // One active dispute per filer per pool keeps the queue focused.
  const { data: existing } = await getAdminClient()
    .from("disputes")
    .select("id")
    .eq("pool_id", poolId)
    .eq("filer_address", filer)
    .in("status", ACTIVE_STATUSES)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: "You already have an active dispute in this pool" },
      { status: 409 }
    )
  }

  const expiresAt = new Date(Date.now() + DISPUTE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()

  const { data, error } = await getAdminClient()
    .from("disputes")
    .insert({
      pool_id: poolId,
      filer_address: filer,
      target_address: target,
      dispute_type: disputeType,
      description,
      evidence_urls: evidence.valid.slice(0, DISPUTE_MAX_EVIDENCE_URLS),
      status: "open",
      expires_at: expiresAt,
    })
    .select("*")
    .single<DisputeRow>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await getAdminClient()
    .from("pool_activity")
    .insert({
      pool_id: poolId,
      activity_type: "dispute_filed",
      user_address: filer,
      description: `Dispute filed (${disputeType})`,
    })

  return NextResponse.json({ dispute: data }, { status: 201 })
}
