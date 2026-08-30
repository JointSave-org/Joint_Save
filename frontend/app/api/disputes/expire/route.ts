/**
 * /api/disputes/expire — Cron job: expire stale disputes (issue #208)
 *
 * POST (Bearer CRON_SECRET) — flips open/voting disputes whose 72h window
 * has elapsed to "expired". Scheduled like the other Vercel cron endpoints.
 */

import { getAdminClient } from "@/lib/supabase-admin"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
  }
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await getAdminClient()
    .from("disputes")
    .update({ status: "expired" })
    .in("status", ["open", "voting"])
    .lt("expires_at", new Date().toISOString())
    .select("id")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ expired: data?.length ?? 0 })
}
