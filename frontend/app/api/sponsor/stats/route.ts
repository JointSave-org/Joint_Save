import { NextRequest, NextResponse } from "next/server"
import { readLimiter } from "@/lib/rate-limit"
import { getSponsorStats } from "@/lib/sponsor"

/**
 * GET /api/sponsor/stats
 *
 * Admin-only endpoint returning sponsorship usage and sponsor account balance.
 * Returns: { dailyCount, dailyLimit, sponsorBalance, sponsorBalanceOk, sponsorAddress }
 */
export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited

    const stats = await getSponsorStats()

    return NextResponse.json(stats, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    console.error("[sponsor/stats] Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
