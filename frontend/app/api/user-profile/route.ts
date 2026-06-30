import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited
  const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase()
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })

  const { data, error } = await getAdminClient()
    .from("user_profiles")
    .select("wallet_address, email, notification_preferences, muted_pools")
    .eq("wallet_address", wallet)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited
  const body = await req.json()
  const { wallet_address, ...updates } = body
  if (!wallet_address)
    return NextResponse.json({ error: "wallet_address required" }, { status: 400 })

  const { error } = await getAdminClient()
    .from("user_profiles")
    .upsert(
      {
        wallet_address: wallet_address.toLowerCase(),
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
