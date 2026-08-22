import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"

const VALID_FREQUENCIES = ["daily", "weekly", "off"] as const
type Frequency = (typeof VALID_FREQUENCIES)[number]

// GET /api/notifications/digest-preferences?wallet=<address>
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase()
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })

  const { data, error } = await getAdminClient()
    .from("email_digests")
    .select("wallet_address, email, frequency, last_sent_at")
    .eq("wallet_address", wallet)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // No row yet just means the wallet hasn't set digest preferences.
  return NextResponse.json(
    data ?? { wallet_address: wallet, email: null, frequency: "off", last_sent_at: null },
    { headers: { "Cache-Control": "private, no-cache" } }
  )
}

// PUT /api/notifications/digest-preferences  { wallet_address, email, frequency }
export async function PUT(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const body = await req.json()
  const { wallet_address, email, frequency } = body

  if (!wallet_address)
    return NextResponse.json({ error: "wallet_address required" }, { status: 400 })
  if (!email || typeof email !== "string" || !email.includes("@"))
    return NextResponse.json({ error: "valid email required" }, { status: 400 })
  if (!VALID_FREQUENCIES.includes(frequency))
    return NextResponse.json(
      { error: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}` },
      { status: 400 }
    )

  const { error } = await getAdminClient()
    .from("email_digests")
    .upsert(
      {
        wallet_address: wallet_address.toLowerCase(),
        email: email.trim(),
        frequency: frequency as Frequency,
      },
      { onConflict: "wallet_address" }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
