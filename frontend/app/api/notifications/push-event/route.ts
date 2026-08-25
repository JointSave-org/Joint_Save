import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { writeLimiter } from "@/lib/rate-limit"

// ─── POST /api/notifications/push-event ──────────────────────────────────────
// Client-callable proxy: pool actions (deposit, payout, member changes) call
// this endpoint rather than /api/notifications/push directly, so the
// CRON_SECRET never needs to be in the client bundle.
//
// This route:
//   1. Rate-limits the caller
//   2. Verifies the pool_id exists in the DB (prevents arbitrary push spam)
//   3. Forwards to /api/notifications/push with the server-side CRON_SECRET
//
// Body: { pool_id, event_type, title, body, url? }
export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: {
    pool_id?: string
    event_type?: string
    title?: string
    body?: string
    url?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { pool_id, event_type, title, body: msgBody, url } = body
  if (!pool_id || !event_type || !title || !msgBody) {
    return NextResponse.json(
      { error: "pool_id, event_type, title, and body are required" },
      { status: 400 }
    )
  }

  // Verify pool exists to prevent push spam targeting arbitrary pool IDs.
  const supabase = getAdminClient()
  const { data: pool, error: poolErr } = await supabase
    .from("pools")
    .select("id")
    .eq("id", pool_id)
    .maybeSingle()

  if (poolErr || !pool) {
    return NextResponse.json({ error: "Pool not found" }, { status: 404 })
  }

  // Forward to the internal push dispatch endpoint with the server-side secret.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
  const pushUrl = appUrl ? `${appUrl}/api/notifications/push` : null

  if (!pushUrl) {
    // In development without APP_URL set — skip silently.
    return NextResponse.json({ ok: true, sent: 0, reason: "app_url_not_configured" })
  }

  const cronSecret = process.env.CRON_SECRET ?? ""

  try {
    const res = await fetch(pushUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify({ pool_id, event_type, title, body: msgBody, url }),
    })
    const json = await res.json()
    return NextResponse.json(json)
  } catch (err) {
    // Push failure is non-critical — return ok so the caller's flow isn't broken.
    console.error("[push-event] dispatch error:", err)
    return NextResponse.json({ ok: true, sent: 0, reason: "dispatch_error" })
  }
}
