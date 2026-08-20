import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { writeLimiter } from "@/lib/rate-limit"

// ─── POST /api/notifications/subscribe ───────────────────────────────────────
// Stores a Web Push subscription for a wallet address.
// Body: { wallet: string, subscription: PushSubscription JSON }
//   subscription shape: { endpoint, keys: { p256dh, auth } }
export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: { wallet?: string; subscription?: { endpoint: string; keys: { p256dh: string; auth: string } } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const wallet = body.wallet?.toLowerCase()
  const sub = body.subscription

  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json(
      { error: "subscription.endpoint, subscription.keys.p256dh and subscription.keys.auth are required" },
      { status: 400 }
    )
  }

  const supabase = getAdminClient()

  // Upsert on endpoint — same browser endpoint should only have one row.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      wallet_address: wallet,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: "endpoint" }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Also flip push_enabled on the global preference row so the toggle stays in sync.
  await supabase
    .from("notification_preferences")
    .upsert(
      { wallet_address: wallet, pool_id: null, push_enabled: true, updated_at: new Date().toISOString() },
      { onConflict: "wallet_address,pool_id" }
    )

  return NextResponse.json({ ok: true }, { status: 201 })
}

// ─── DELETE /api/notifications/subscribe ─────────────────────────────────────
// Removes a push subscription (unsubscribe).
// Body: { wallet: string, endpoint: string }
export async function DELETE(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: { wallet?: string; endpoint?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const wallet = body.wallet?.toLowerCase()
  const endpoint = body.endpoint

  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 })

  const supabase = getAdminClient()

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("wallet_address", wallet)
    .eq("endpoint", endpoint)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Check if this wallet has any remaining subscriptions; if not, clear push_enabled.
  const { count } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("wallet_address", wallet)

  if (count === 0) {
    await supabase
      .from("notification_preferences")
      .update({ push_enabled: false, updated_at: new Date().toISOString() })
      .eq("wallet_address", wallet)
      .is("pool_id", null)
  }

  return NextResponse.json({ ok: true })
}
