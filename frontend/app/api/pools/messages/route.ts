/**
 * /api/pools/messages — Pool group chat API
 *
 * GET  /api/pools/messages?pool_id=<id>&wallet=<addr>&cursor=<iso>
 *   Returns the 50 most recent messages, optionally before `cursor` for
 *   infinite-scroll pagination.  Verifies the requesting wallet is a member.
 *
 * POST /api/pools/messages  { pool_id, wallet_address, message }
 *   Inserts a new message.  Enforces member check, length cap, and a
 *   per-sender 3-second DB-backed rate limit so it works correctly across
 *   all serverless instances (no shared in-memory state).
 */

import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter } from "@/lib/rate-limit"
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_RATE_LIMIT_MS } from "@/lib/constants"
import { jsonPublic } from "@/lib/cache-headers"

const PAGE_SIZE = 50

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isMember(poolId: string, wallet: string): Promise<boolean> {
  const { data } = await getAdminClient()
    .from("pool_members")
    .select("id")
    .eq("pool_id", poolId)
    .eq("member_address", wallet.toLowerCase())
    .maybeSingle()
  return data !== null
}

/**
 * DB-backed rate limit: fetch the sender's most recent message timestamp for
 * this pool.  Works correctly across all serverless instances because it reads
 * from the shared database rather than a module-scoped Map.
 *
 * Returns the number of milliseconds the caller must still wait, or 0 if they
 * are allowed to send now.
 */
async function getRateLimitWaitMs(poolId: string, wallet: string): Promise<number> {
  const { data } = await getAdminClient()
    .from("pool_messages")
    .select("created_at")
    .eq("pool_id", poolId)
    .eq("sender_address", wallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return 0

  const lastMs = new Date(data.created_at).getTime()
  const elapsed = Date.now() - lastMs
  return elapsed < CHAT_RATE_LIMIT_MS ? CHAT_RATE_LIMIT_MS - elapsed : 0
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const { searchParams } = req.nextUrl
  const poolId = searchParams.get("pool_id")
  const wallet = searchParams.get("wallet")?.toLowerCase()
  const cursor = searchParams.get("cursor") // ISO timestamp — load messages before this

  if (!poolId) return NextResponse.json({ error: "pool_id required" }, { status: 400 })
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })

  // Verify membership before returning any messages (mirrors the RLS policy).
  const member = await isMember(poolId, wallet)
  if (!member) {
    return NextResponse.json({ error: "Not a member of this pool" }, { status: 403 })
  }

  let query = getAdminClient()
    .from("pool_messages")
    .select("id, pool_id, sender_address, message, created_at")
    .eq("pool_id", poolId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE)

  if (cursor) {
    query = query.lt("created_at", cursor)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return in chronological order so the UI can simply append.
  const messages = (data ?? []).reverse()
  return jsonPublic({ messages, hasMore: (data ?? []).length === PAGE_SIZE })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { pool_id?: string; wallet_address?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { pool_id, wallet_address, message } = body
  const wallet = wallet_address?.toLowerCase()

  if (!pool_id) return NextResponse.json({ error: "pool_id required" }, { status: 400 })
  if (!wallet) return NextResponse.json({ error: "wallet_address required" }, { status: 400 })
  if (!message || message.trim().length === 0) {
    return NextResponse.json({ error: "message required" }, { status: 400 })
  }

  // Length cap
  if (message.length > CHAT_MESSAGE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Message exceeds ${CHAT_MESSAGE_MAX_LENGTH} character limit` },
      { status: 422 }
    )
  }

  // DB-backed per-sender rate limit — safe across all serverless instances
  const waitMs = await getRateLimitWaitMs(pool_id, wallet)
  if (waitMs > 0) {
    return NextResponse.json(
      {
        error: "TOO_MANY_REQUESTS",
        message: `Please wait ${Math.ceil(waitMs / 1000)} second(s) before sending another message.`,
        retryAfterMs: waitMs,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(waitMs / 1000)) },
      }
    )
  }

  // Verify membership (server-enforced, not just UI-gated)
  const member = await isMember(pool_id, wallet)
  if (!member) {
    return NextResponse.json({ error: "Not a member of this pool" }, { status: 403 })
  }

  const { data, error } = await getAdminClient()
    .from("pool_messages")
    .insert({
      pool_id,
      sender_address: wallet,
      message: message.trim(),
    })
    .select("id, pool_id, sender_address, message, created_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: data }, { status: 201 })
}
