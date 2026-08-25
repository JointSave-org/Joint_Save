import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"

// GET /api/notifications/digest/unsubscribe?token=<unsubscribe_token>
// One-click unsubscribe link from digest emails. No wallet/session needed --
// the token itself (see email_digests.unsubscribe_token) is the credential.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 })
  }

  const { data, error } = await getAdminClient()
    .from("email_digests")
    .update({ frequency: "off" })
    .eq("unsubscribe_token", token)
    .select("wallet_address")
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "invalid or expired token" }, { status: 404 })

  // Redirect to a simple confirmation page rather than returning JSON,
  // since this link is opened directly from an email client.
  return NextResponse.redirect(new URL("/settings/notifications?unsubscribed=1", req.url))
}
