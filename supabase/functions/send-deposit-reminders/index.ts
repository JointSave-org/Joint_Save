// Supabase Edge Function: send-deposit-reminders
//
// Intended for a scheduled Supabase cron trigger every few hours.
// Finds active rotational pools approaching their next payout deadline and
// reminds members who have not deposited during the current round.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - auto-injected by Supabase
//   RESEND_API_KEY                          - set in Supabase dashboard > Edge Functions > Secrets
//   RESEND_FROM_EMAIL                       - e.g. "JointSave <noreply@jointsave.app>"
// Optional env vars:
//   DEPOSIT_REMINDER_LEAD_HOURS             - defaults to 24

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") ?? "JointSave <noreply@jointsave.app>"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const LEAD_HOURS = Number(Deno.env.get("DEPOSIT_REMINDER_LEAD_HOURS") ?? "24")
const REMINDER_TYPE = "deposit_reminder"

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface RotationalPool {
  id: string
  name: string
  next_payout: string | null
  round_duration: number | null
}

interface PoolMember {
  member_address: string
}

interface DepositActivity {
  user_address: string | null
}

interface NotificationPreferences {
  email_on_payout?: boolean
  email_on_deposit?: boolean
  email_on_round?: boolean
  email_on_target?: boolean
  email_on_deposit_reminder?: boolean
}

interface UserProfile {
  wallet_address: string
  email: string | null
  notification_preferences: NotificationPreferences | null
}

interface ReminderRow {
  pool_id: string
  wallet_address: string
  round_deadline: string
}

function normalizeAddress(address: string): string {
  return address.toLowerCase()
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

function subtractSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() - seconds * 1000)
}

function emailAllowed(profile: UserProfile | undefined): boolean {
  if (!profile?.email) return false

  const prefs: NotificationPreferences = {
    email_on_deposit: true,
    email_on_deposit_reminder: true,
    ...(profile.notification_preferences ?? {}),
  }

  return prefs.email_on_deposit !== false && prefs.email_on_deposit_reminder !== false
}

function reminderMessage(poolName: string, deadline: Date): string {
  return `Deposit reminder: ${poolName} round deadline is ${deadline.toISOString()}`
}

function emailHtml(poolName: string, deadline: Date): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#6d28d9;margin-bottom:8px">JointSave</h2>
      <p>This is a reminder to make your deposit for <strong>${poolName}</strong>.</p>
      <p>The current rotational round deadline is <strong>${deadline.toISOString()}</strong>.</p>
      <p>Log in to JointSave to complete your deposit before the round closes.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="font-size:12px;color:#9ca3af">
        You're receiving this because you're a member of a JointSave rotational pool.
        Manage preferences in your profile settings.
      </p>
    </div>`
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

async function getCurrentRoundDepositors(poolId: string, roundStart: Date): Promise<Set<string>> {
  const { data, error } = await sb
    .from("pool_activity")
    .select("user_address")
    .eq("pool_id", poolId)
    .eq("activity_type", "deposit")
    .gte("created_at", roundStart.toISOString())

  if (error) throw error

  return new Set(
    ((data ?? []) as DepositActivity[])
      .map((activity) => activity.user_address)
      .filter((address): address is string => Boolean(address))
      .map(normalizeAddress)
  )
}

async function handlePool(pool: RotationalPool): Promise<number> {
  if (!pool.next_payout || !pool.round_duration || pool.round_duration <= 0) return 0

  const deadline = new Date(pool.next_payout)
  if (Number.isNaN(deadline.getTime())) return 0

  const roundStart = subtractSeconds(deadline, pool.round_duration)

  const { data: members, error: membersError } = await sb
    .from("pool_members")
    .select("member_address")
    .eq("pool_id", pool.id)

  if (membersError) throw membersError

  const allMembers = ((members ?? []) as PoolMember[])
    .map((member) => normalizeAddress(member.member_address))
    .filter(Boolean)

  if (allMembers.length === 0) return 0

  const depositors = await getCurrentRoundDepositors(pool.id, roundStart)
  const missingMembers = allMembers.filter((member) => !depositors.has(member))

  if (missingMembers.length === 0) return 0

  const reminderRows: ReminderRow[] = missingMembers.map((member) => ({
    pool_id: pool.id,
    wallet_address: member,
    round_deadline: deadline.toISOString(),
  }))

  const { data: insertedReminders, error: reminderError } = await sb
    .from("deposit_reminders")
    .upsert(reminderRows, {
      onConflict: "pool_id,wallet_address,round_deadline",
      ignoreDuplicates: true,
    })
    .select("pool_id, wallet_address, round_deadline")

  if (reminderError) throw reminderError

  const recipients = ((insertedReminders ?? []) as ReminderRow[]).map((row) =>
    normalizeAddress(row.wallet_address)
  )

  if (recipients.length === 0) return 0

  const message = reminderMessage(pool.name, deadline)

  const { error: notificationError } = await sb.from("notifications").insert(
    recipients.map((walletAddress) => ({
      wallet_address: walletAddress,
      pool_id: pool.id,
      activity_type: REMINDER_TYPE,
      message,
    }))
  )

  if (notificationError) throw notificationError

  const { data: profiles, error: profilesError } = await sb
    .from("user_profiles")
    .select("wallet_address, email, notification_preferences")
    .in("wallet_address", recipients)

  if (profilesError) throw profilesError

  const profileMap = new Map<string, UserProfile>(
    ((profiles ?? []) as UserProfile[]).map((profile) => [
      normalizeAddress(profile.wallet_address),
      profile,
    ])
  )

  await Promise.all(
    recipients.map(async (walletAddress) => {
      const profile = profileMap.get(walletAddress)
      if (!emailAllowed(profile)) return
      const email = profile?.email
      if (!email) return

      await sendEmail(
        email,
        `Deposit reminder for ${pool.name}`,
        emailHtml(pool.name, deadline)
      )
    })
  )

  return recipients.length
}

serve(async () => {
  try {
    const now = new Date()
    const reminderWindowEnd = addHours(now, LEAD_HOURS)

    const { data: pools, error } = await sb
      .from("pools")
      .select("id, name, next_payout, round_duration")
      .eq("type", "rotational")
      .eq("status", "active")
      .not("next_payout", "is", null)
      .gt("next_payout", now.toISOString())
      .lte("next_payout", reminderWindowEnd.toISOString())

    if (error) throw error

    let reminded = 0

    for (const pool of ((pools ?? []) as RotationalPool[])) {
      reminded += await handlePool(pool)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        checked_pools: (pools ?? []).length,
        reminded,
        lead_hours: LEAD_HOURS,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    console.error("send-deposit-reminders error:", err)
    return new Response("internal error", { status: 500 })
  }
})
