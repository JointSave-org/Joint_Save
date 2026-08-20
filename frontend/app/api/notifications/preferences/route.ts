import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"

// ─── GET /api/notifications/preferences?wallet=<address>&poolId=<id> ─────────
// Returns the preference row for the given wallet+pool combination.
// If poolId is omitted, returns the global (pool_id IS NULL) defaults.
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase()
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })

  const poolId = req.nextUrl.searchParams.get("poolId") ?? null
  const supabase = getAdminClient()

  let query = supabase
    .from("notification_preferences")
    .select(
      "wallet_address, pool_id, event_deposit, event_payout, event_member_joined, event_member_left, event_deadline_warning, event_paused, push_enabled, created_at, updated_at"
    )
    .eq("wallet_address", wallet)

  if (poolId) {
    query = query.eq("pool_id", poolId)
  } else {
    query = query.is("pool_id", null)
  }

  const { data, error } = await query.maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return defaults if no row exists yet
  if (!data) {
    return NextResponse.json(
      {
        wallet_address: wallet,
        pool_id: poolId,
        event_deposit: true,
        event_payout: true,
        event_member_joined: true,
        event_member_left: false,
        event_deadline_warning: true,
        event_paused: true,
        push_enabled: false,
      },
      { headers: { "Cache-Control": "private, no-cache" } }
    )
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-cache" } })
}

// ─── PUT /api/notifications/preferences ──────────────────────────────────────
// Upserts a preference row. Body:
//   { wallet, pool_id?, event_deposit?, event_payout?, event_member_joined?,
//     event_member_left?, event_deadline_warning?, event_paused?, push_enabled? }
export async function PUT(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const wallet = (body.wallet as string | undefined)?.toLowerCase()
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })

  const supabase = getAdminClient()

  const row = {
    wallet_address: wallet,
    pool_id: (body.pool_id as string | null | undefined) ?? null,
    ...(body.event_deposit !== undefined && { event_deposit: Boolean(body.event_deposit) }),
    ...(body.event_payout !== undefined && { event_payout: Boolean(body.event_payout) }),
    ...(body.event_member_joined !== undefined && {
      event_member_joined: Boolean(body.event_member_joined),
    }),
    ...(body.event_member_left !== undefined && {
      event_member_left: Boolean(body.event_member_left),
    }),
    ...(body.event_deadline_warning !== undefined && {
      event_deadline_warning: Boolean(body.event_deadline_warning),
    }),
    ...(body.event_paused !== undefined && { event_paused: Boolean(body.event_paused) }),
    ...(body.push_enabled !== undefined && { push_enabled: Boolean(body.push_enabled) }),
    updated_at: new Date().toISOString(),
  }

  // Supabase upsert with composite key including nullable pool_id.
  // We use onConflict on the unique index columns.
  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert(row, { onConflict: "wallet_address,pool_id" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
