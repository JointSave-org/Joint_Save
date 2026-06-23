// Supabase Edge Function: notify-pool-event
//
// Triggered by a Supabase database webhook on pool_activity INSERT.
// Reads event type, fetches affected members, checks notification preferences,
// sends email via Resend, and writes in-app notification rows.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — auto-injected by Supabase
//   RESEND_API_KEY                            — set in Supabase dashboard > Edge Functions > Secrets
//   RESEND_FROM_EMAIL                         — e.g. "JointSave <noreply@jointsave.app>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") ?? "JointSave <noreply@jointsave.app>"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Types ────────────────────────────────────────────────────────────────────

interface ActivityRecord {
  id: string
  pool_id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  description: string | null
  created_at: string
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE"
  table: string
  record: ActivityRecord
}

interface NotificationPreferences {
  email_on_payout: boolean
  email_on_deposit: boolean
  email_on_round: boolean
  email_on_target: boolean
  email_on_reminder: boolean
}

interface UserProfile {
  wallet_address: string
  email: string | null
  notification_preferences: NotificationPreferences
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function xlmFromStroops(stroops: number | null): string {
  if (stroops == null) return "?"
  return (stroops / 10_000_000).toFixed(2)
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY || !to) return
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  })
  if (!res.ok) {
    console.error("Resend error:", await res.text())
  }
}

function emailHtml(bodyContent: string): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#6d28d9;margin-bottom:8px">JointSave</h2>
      ${bodyContent}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="font-size:12px;color:#9ca3af">
        You're receiving this because you're a member of a JointSave pool.
        Manage preferences in your profile settings.
      </p>
    </div>`
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json()
    if (payload.type !== "INSERT") return new Response("ok", { status: 200 })

    const act = payload.record
    const { activity_type, pool_id, user_address, amount } = act

    const HANDLED = ["payout", "deposit", "round_advance", "target_reached", "deposit_reminder"]
    if (!HANDLED.includes(activity_type)) {
      return new Response("ok", { status: 200 })
    }

    // Fetch pool info
    const { data: pool } = await sb
      .from("pools")
      .select("id, name")
      .eq("id", pool_id)
      .single()
    if (!pool) return new Response("pool not found", { status: 200 })

    // Fetch all pool members
    const { data: members } = await sb
      .from("pool_members")
      .select("member_address")
      .eq("pool_id", pool_id)
    const allMembers: string[] = (members ?? []).map((m: { member_address: string }) => m.member_address)

    // Fetch user profiles for email + preferences lookup
    const { data: profiles } = await sb
      .from("user_profiles")
      .select("wallet_address, email, notification_preferences")
      .in("wallet_address", allMembers)
    const profileMap = new Map<string, UserProfile>(
      (profiles ?? []).map((p: UserProfile) => [p.wallet_address, p])
    )

    const poolName = pool.name
    const xlm = xlmFromStroops(amount)
    const senderShort = user_address ? shortAddress(user_address) : "A member"

    // Determine recipients, preference key, message content
    let recipients: string[] = []
    let prefKey: keyof NotificationPreferences = "email_on_deposit"
    let subject = ""
    let inAppMsg = ""
    let bodyHtml = ""

    if (activity_type === "payout") {
      recipients = user_address ? [user_address] : []
      prefKey = "email_on_payout"
      subject = `You received ${xlm} XLM from ${poolName}`
      inAppMsg = subject
      bodyHtml = emailHtml(
        `<p>Great news! You received <strong>${xlm} XLM</strong> from your savings pool <strong>${poolName}</strong>.</p>
         <p>Log in to view your updated balance.</p>`
      )
    } else if (activity_type === "deposit") {
      recipients = allMembers.filter((a) => a !== user_address)
      prefKey = "email_on_deposit"
      subject = `${senderShort} deposited to ${poolName}`
      inAppMsg = subject
      bodyHtml = emailHtml(
        `<p><strong>${senderShort}</strong> made a deposit of <strong>${xlm} XLM</strong> to <strong>${poolName}</strong>.</p>`
      )
    } else if (activity_type === "round_advance") {
      recipients = allMembers
      prefKey = "email_on_round"
      const nextMember = act.description ?? "the next member"
      subject = `Round complete in ${poolName} — ${nextMember} is next`
      inAppMsg = subject
      bodyHtml = emailHtml(
        `<p>A round is complete in <strong>${poolName}</strong>.</p>
         <p>The next beneficiary is <strong>${nextMember}</strong>.</p>`
      )
    } else if (activity_type === "target_reached") {
      recipients = allMembers
      prefKey = "email_on_target"
      subject = `${poolName} reached its target! You can now withdraw.`
      inAppMsg = subject
      bodyHtml = emailHtml(
        `<p>Your savings pool <strong>${poolName}</strong> has reached its savings target!</p>
         <p>You are now eligible to withdraw your funds. Log in to proceed.</p>`
      )
    } else if (activity_type === "deposit_reminder") {
      recipients = allMembers.filter((a) => a !== user_address)
      prefKey = "email_on_reminder"
      subject = `Reminder: deposit due soon in ${poolName}`
      inAppMsg = subject
      bodyHtml = emailHtml(
        `<p>The next payout deadline for <strong>${poolName}</strong> is approaching.</p>
         <p>Please make sure your deposit is in before the round closes.</p>`
      )
    }

    // Write in-app notifications for all recipients
    if (recipients.length > 0) {
      await sb.from("notifications").insert(
        recipients.map((addr) => ({
          wallet_address: addr,
          pool_id,
          activity_type,
          message: inAppMsg,
        }))
      )
    }

    // Send emails, respecting per-user opt-out preferences
    await Promise.all(
      recipients.map(async (addr) => {
        const profile = profileMap.get(addr)
        if (!profile?.email) return
        const prefs: NotificationPreferences = {
          email_on_payout: true,
          email_on_deposit: true,
          email_on_round: true,
          email_on_target: true,
          email_on_reminder: true,
          ...(profile.notification_preferences ?? {}),
        }
        if (!prefs[prefKey]) return
        await sendEmail(profile.email, subject, bodyHtml)
      })
    )

    return new Response(
      JSON.stringify({ ok: true, notified: recipients.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("notify-pool-event error:", err)
    return new Response("internal error", { status: 500 })
  }
})
