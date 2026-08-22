import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"

const CRON_SECRET = process.env.CRON_SECRET ?? ""
const PUSH_API_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/notifications/push`
  : null

// ─── GET /api/cron/deadline-warnings ─────────────────────────────────────────
// Vercel Cron job (runs hourly via vercel.json crons config).
//
// Finds active rotational pools where next_payout is within the next 24 hours,
// then for each such pool finds members who haven't deposited in the current
// round and sends them an event_deadline_warning push notification.
export async function GET(req: NextRequest) {
  // Validate Vercel Cron / manual auth header.
  const authHeader = req.headers.get("authorization")
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getAdminClient()
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Find rotational pools with a payout deadline in the next 24 hours.
  const { data: pools, error: poolsError } = await supabase
    .from("pools")
    .select("id, name, next_payout")
    .eq("type", "rotational")
    .eq("status", "active")
    .gte("next_payout", now.toISOString())
    .lte("next_payout", in24h.toISOString())

  if (poolsError) {
    return NextResponse.json({ error: poolsError.message }, { status: 500 })
  }

  if (!pools || pools.length === 0) {
    return NextResponse.json({ ok: true, notified: 0, pools: 0 })
  }

  let totalNotified = 0
  const results: { pool_id: string; sent: number; error?: string }[] = []

  for (const pool of pools) {
    // Find members who haven't deposited in the current round.
    // "Not deposited" = status is 'pending' in pool_members.
    const { data: pendingMembers, error: membersError } = await supabase
      .from("pool_members")
      .select("member_address")
      .eq("pool_id", pool.id)
      .eq("status", "pending")

    if (membersError) {
      results.push({ pool_id: pool.id, sent: 0, error: membersError.message })
      continue
    }

    if (!pendingMembers || pendingMembers.length === 0) {
      results.push({ pool_id: pool.id, sent: 0 })
      continue
    }

    if (!PUSH_API_URL) {
      // Can't dispatch push without knowing the app URL — skip but log.
      console.warn("[deadline-warnings] NEXT_PUBLIC_APP_URL not set, cannot dispatch push")
      results.push({ pool_id: pool.id, sent: 0, error: "app_url_not_configured" })
      continue
    }

    const hoursLeft = Math.round(
      (new Date(pool.next_payout!).getTime() - now.getTime()) / (60 * 60 * 1000)
    )

    try {
      const res = await fetch(PUSH_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {}),
        },
        body: JSON.stringify({
          pool_id: pool.id,
          event_type: "event_deadline_warning",
          title: "⏰ Deposit deadline approaching",
          body: `Your deposit for "${pool.name}" is due in ~${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}. Deposit now to stay on track.`,
          url: `/dashboard/group/${pool.id}?highlight=deposit`,
        }),
      })

      const json = (await res.json()) as { sent?: number }
      const sent = json.sent ?? 0
      totalNotified += sent
      results.push({ pool_id: pool.id, sent })
    } catch (err) {
      results.push({ pool_id: pool.id, sent: 0, error: String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    pools: pools.length,
    notified: totalNotified,
    results,
  })
}
