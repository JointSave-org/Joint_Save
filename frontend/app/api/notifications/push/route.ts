import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"

// Configure VAPID — server only; keys must be set in environment variables.
// Generate them once with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ""
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:support@jointsave.app"

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

export type PushEventType =
  | "event_deposit"
  | "event_payout"
  | "event_member_joined"
  | "event_member_left"
  | "event_deadline_warning"
  | "event_paused"

interface PushPayload {
  pool_id: string
  event_type: PushEventType
  title: string
  body: string
  url?: string
}

// ─── POST /api/notifications/push ────────────────────────────────────────────
// Internal endpoint — sends a browser push to all pool members who have
// the relevant event type enabled and have registered a push subscription.
//
// Body: { pool_id, event_type, title, body, url? }
//
// This endpoint should only be called from other server-side routes (deposit
// flow, member join, cron jobs). Protect it with a shared secret in production
// by checking the CRON_SECRET header (same pattern as Vercel Cron).
export async function POST(req: NextRequest) {
  // Protect internal endpoint — require the same secret used by cron routes.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    // Push not configured — fail silently in development.
    console.warn("[push] VAPID keys not configured, skipping push send")
    return NextResponse.json({ ok: true, sent: 0, reason: "vapid_not_configured" })
  }

  let payload: PushPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { pool_id, event_type, title, body, url } = payload
  if (!pool_id || !event_type || !title || !body) {
    return NextResponse.json(
      { error: "pool_id, event_type, title, and body are required" },
      { status: 400 }
    )
  }

  const supabase = getAdminClient()

  // 1. Get all member wallet addresses for this pool.
  const { data: members, error: membersError } = await supabase
    .from("pool_members")
    .select("member_address")
    .eq("pool_id", pool_id)

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 })
  }

  if (!members || members.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  const wallets = members.map((m) => m.member_address.toLowerCase())

  // 2. Find wallets that have push_enabled and the specific event type enabled.
  //    Check pool-specific preferences first; fall back to global (pool_id IS NULL).
  //    We load both global and pool-specific rows in one query.
  const { data: prefsRaw, error: prefsError } = await supabase
    .from("notification_preferences")
    .select(
      "wallet_address, pool_id, push_enabled, event_deposit, event_payout, event_member_joined, event_member_left, event_deadline_warning, event_paused"
    )
    .in("wallet_address", wallets)
    .or(`pool_id.eq.${pool_id},pool_id.is.null`)

  if (prefsError) {
    return NextResponse.json({ error: prefsError.message }, { status: 500 })
  }

  type PrefRow = {
    wallet_address: string
    pool_id: string | null
    push_enabled: boolean
    event_deposit: boolean
    event_payout: boolean
    event_member_joined: boolean
    event_member_left: boolean
    event_deadline_warning: boolean
    event_paused: boolean
  }
  const prefs = (prefsRaw ?? []) as PrefRow[]

  // Build a map: wallet → resolved preference for this event
  const resolvedPushEnabled = new Map<string, boolean>()
  const resolvedEventEnabled = new Map<string, boolean>()

  // First pass: global defaults (pool_id IS NULL)
  for (const pref of prefs) {
    if (pref.pool_id === null) {
      resolvedPushEnabled.set(pref.wallet_address, pref.push_enabled ?? false)
      resolvedEventEnabled.set(
        pref.wallet_address,
        (pref[event_type as keyof PrefRow] as boolean) ?? true
      )
    }
  }
  // Second pass: pool-specific overrides
  for (const pref of prefs) {
    if (pref.pool_id === pool_id) {
      resolvedPushEnabled.set(
        pref.wallet_address,
        pref.push_enabled ?? resolvedPushEnabled.get(pref.wallet_address) ?? false
      )
      resolvedEventEnabled.set(
        pref.wallet_address,
        (pref[event_type as keyof PrefRow] as boolean) ??
          resolvedEventEnabled.get(pref.wallet_address) ??
          true
      )
    }
  }

  // Wallets to notify: push enabled AND this event type enabled
  const eligibleWallets = wallets.filter(
    (w) => (resolvedPushEnabled.get(w) ?? false) && (resolvedEventEnabled.get(w) ?? true)
  )

  if (eligibleWallets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  // 3. Fetch push subscriptions for eligible wallets.
  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, wallet_address")
    .in("wallet_address", eligibleWallets)

  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 })
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  // 4. Send pushes; clean up stale subscriptions (410 Gone).
  const staleEndpoints: string[] = []
  let sent = 0

  const pushData = JSON.stringify({
    title,
    body,
    url: url ?? `/dashboard/group/${pool_id}`,
    pool_id,
    event_type,
  })

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          pushData,
          { TTL: 86400 } // 24h TTL
        )
        sent++
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired or unregistered — queue for cleanup.
          staleEndpoints.push(sub.endpoint)
        } else {
          console.error("[push] sendNotification error:", err)
        }
      }
    })
  )

  // 5. Remove stale subscriptions.
  if (staleEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints)
  }

  return NextResponse.json({ ok: true, sent, staleRemoved: staleEndpoints.length })
}
