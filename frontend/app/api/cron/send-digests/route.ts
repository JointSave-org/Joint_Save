import { getAdminClient } from "@/lib/supabase-admin"
import { sendDigestEmail } from "@/lib/email"
import { NextRequest, NextResponse } from "next/server"

const DAILY_STALE_HOURS = 20
const WEEKLY_STALE_DAYS = 6

interface DigestPref {
  wallet_address: string
  email: string
  frequency: "daily" | "weekly"
  last_sent_at: string | null
  unsubscribe_token: string
}

// GET /api/cron/send-digests -- triggered daily at 08:00 UTC by Vercel Cron.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getAdminClient()
  const now = new Date()
  const isMonday = now.getUTCDay() === 1

  const dailyCutoff = new Date(now.getTime() - DAILY_STALE_HOURS * 60 * 60 * 1000)
  const weeklyCutoff = new Date(now.getTime() - WEEKLY_STALE_DAYS * 24 * 60 * 60 * 1000)

  const { data: dailyPrefs, error: dailyError } = await supabase
    .from("email_digests")
    .select("wallet_address, email, frequency, last_sent_at, unsubscribe_token")
    .eq("frequency", "daily")
    .or(`last_sent_at.is.null,last_sent_at.lt.${dailyCutoff.toISOString()}`)
    .returns<DigestPref[]>()

  if (dailyError) return NextResponse.json({ error: dailyError.message }, { status: 500 })

  let weeklyPrefs: DigestPref[] = []
  if (isMonday) {
    const { data, error: weeklyError } = await supabase
      .from("email_digests")
      .select("wallet_address, email, frequency, last_sent_at, unsubscribe_token")
      .eq("frequency", "weekly")
      .or(`last_sent_at.is.null,last_sent_at.lt.${weeklyCutoff.toISOString()}`)
      .returns<DigestPref[]>()

    if (weeklyError) return NextResponse.json({ error: weeklyError.message }, { status: 500 })
    weeklyPrefs = data ?? []
  }

  const allPrefs = [...(dailyPrefs ?? []), ...weeklyPrefs]

  let sent = 0
  const errors: string[] = []

  for (const pref of allPrefs) {
    try {
      const windowStart =
        pref.frequency === "daily"
          ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
          : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

      const { data: notifications, error: notifError } = await supabase
        .from("notifications")
        .select("pool_id, activity_type, message, created_at")
        .eq("wallet_address", pref.wallet_address)
        .gte("created_at", windowStart.toISOString())
        .order("created_at", { ascending: false })

      if (notifError) throw notifError

      await sendDigestEmail(pref.email, {
        frequency: pref.frequency,
        notifications: notifications ?? [],
        unsubscribeToken: pref.unsubscribe_token,
      })

      const { error: updateError } = await supabase
        .from("email_digests")
        .update({ last_sent_at: now.toISOString() })
        .eq("wallet_address", pref.wallet_address)

      if (updateError) throw updateError

      sent++
    } catch (err) {
      errors.push(`${pref.wallet_address}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json(
    { sent, total: allPrefs.length, is_monday: isMonday, errors },
    { headers: { "Cache-Control": "private, no-cache" } }
  )
}
