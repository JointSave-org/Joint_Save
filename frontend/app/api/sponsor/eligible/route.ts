import { NextRequest, NextResponse } from "next/server"
import { readLimiter } from "@/lib/rate-limit"
import { checkEligibility } from "@/lib/sponsor"

const FACTORY_ID = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID || ""

/**
 * GET /api/sponsor/eligible?wallet=<stellar-address>
 *
 * Checks whether a wallet is eligible for sponsored first deposit.
 * Returns { eligible: boolean, reason: string }.
 */
export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited

    const wallet = req.nextUrl.searchParams.get("wallet")
    if (!wallet) {
      return NextResponse.json({ error: "Missing required query param: wallet" }, { status: 400 })
    }

    // Basic Stellar address validation (starts with G or C, 56 chars)
    if (!/^[GC][A-Z0-9]{55}$/.test(wallet)) {
      return NextResponse.json({ error: "Invalid Stellar address format" }, { status: 400 })
    }

    const result = await checkEligibility(wallet, FACTORY_ID)

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("[sponsor/eligible] Error:", error)
    return NextResponse.json({ eligible: false, reason: "Internal server error" }, { status: 500 })
  }
}
