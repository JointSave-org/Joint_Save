import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"
import { validateEmail } from "@/lib/form-validation"

const VALID_FREQUENCIES = ["daily", "weekly", "off"] as const
type Frequency = (typeof VALID_FREQUENCIES)[number]

// Wallet ownership guard -- matches the pattern in
// app/api/notifications/preferences/route.ts (PR #242 security fix).
// The app has no server-side session (wallet-based auth), so callers must
// echo their wallet in the x-wallet-address header, verified against the
// wallet in the request. Prevents one wallet from reading/writing another's
// digest preferences (and the email address bound to it).
function verifyWalletOwnership(req: NextRequest, walletFromPayload: string): NextResponse | null {
  const headerWallet = req.headers.get("x-wallet-address")?.toLowerCase()
  if (!headerWallet) {
    return NextResponse.json({ error: "x-wallet-address header is required" }, { status: 401 })
  }
  if (headerWallet !== walletFromPayload.toLowerCase()) {
    return NextResponse.json({ error: "Wallet address mismatch" }, { status: 403 })
  }
  return null
}

// GET /api/notifications/digest-preferences?wallet=<address>
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase()
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })

  const authError = verifyWalletOwnership(req, wallet)
  if (authError) return authError

  const { data, error } = await getAdminClient()
    .from("email_digests")
    .select("wallet_address, email, frequency, last_sent_at")
    .eq("wallet_address", wallet)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  const authError = verifyWalletOwnership(req, wallet_address)
  if (authError) return authError

  const emailCheck = validateEmail(typeof email === "string" ? email : "")
  if (!emailCheck.valid) return NextResponse.json({ error: emailCheck.message }, { status: 400 })

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
