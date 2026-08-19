import { NextRequest, NextResponse } from "next/server"
import { writeLimiter } from "@/lib/rate-limit"
import {
  checkEligibility,
  checkSponsorBalance,
  createSponsoredFeeBump,
  isDailyLimitReached,
  checkWalletRateLimit,
  recordWalletSponsorship,
  incrementDailySponsorshipCount,
  MAX_DAILY_SPONSORSHIPS,
} from "@/lib/sponsor"
import { STELLAR_NETWORK_PASSPHRASE } from "@/components/web3-provider"

const FACTORY_ID = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID || ""
const SPONSOR_SECRET = process.env.SPONSOR_SECRET_KEY || ""
const SPONSOR_ADDRESS = process.env.NEXT_PUBLIC_SPONSOR_ADDRESS || ""

/**
 * POST /api/sponsor/fee-bump
 *
 * Accepts: { txXdr: string, userAddress: string }
 * Validates: user eligibility, daily limit, sponsor balance
 * Returns: { sponsoredTxXdr: string, innerTxHash: string }
 */
export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const body = await req.json()
    const { txXdr, userAddress } = body

    // ── Validate input ──────────────────────────────────────────────────────
    if (!txXdr || !userAddress) {
      return NextResponse.json(
        { error: "Missing required fields: txXdr, userAddress" },
        { status: 400 }
      )
    }

    if (!/^[GC][A-Z0-9]{55}$/.test(userAddress)) {
      return NextResponse.json(
        { error: "Invalid Stellar address format" },
        { status: 400 }
      )
    }

    // ── Check sponsor configuration ─────────────────────────────────────────
    if (!SPONSOR_SECRET || !SPONSOR_ADDRESS) {
      return NextResponse.json(
        { error: "Sponsorship is not configured on this server." },
        { status: 503 }
      )
    }

    // ── Daily limit circuit breaker ──────────────────────────────────────────
    if (isDailyLimitReached()) {
      return NextResponse.json(
        {
          error: "Daily sponsorship limit reached. Please try again tomorrow.",
          dailyLimit: MAX_DAILY_SPONSORSHIPS,
        },
        { status: 429 }
      )
    }

    // ── Per-wallet rate limit ────────────────────────────────────────────────
    const rateLimit = checkWalletRateLimit(userAddress)
    if (!rateLimit.ok) {
      return NextResponse.json(
        {
          error: "You have already used a sponsored deposit. Only one per wallet is allowed.",
          retryAfterMs: rateLimit.retryAfterMs,
        },
        { status: 429 }
      )
    }

    // ── Eligibility check ───────────────────────────────────────────────────
    const eligibility = await checkEligibility(userAddress, FACTORY_ID)
    if (!eligibility.eligible) {
      return NextResponse.json(
        { error: eligibility.reason },
        { status: 403 }
      )
    }

    // ── Sponsor balance circuit breaker ──────────────────────────────────────
    const balanceCheck = await checkSponsorBalance(SPONSOR_ADDRESS)
    if (!balanceCheck.ok) {
      return NextResponse.json(
        {
          error: "Sponsor account has insufficient funds. Please try the normal deposit flow.",
          sponsorBalance: balanceCheck.balance,
        },
        { status: 503 }
      )
    }

    // ── Create fee-bump transaction ─────────────────────────────────────────
    const { sponsoredTxXdr, innerTxHash } = createSponsoredFeeBump(
      txXdr,
      SPONSOR_SECRET,
      STELLAR_NETWORK_PASSPHRASE
    )

    // ── Record sponsorship ──────────────────────────────────────────────────
    recordWalletSponsorship(userAddress)
    incrementDailySponsorshipCount()

    return NextResponse.json(
      {
        sponsoredTxXdr,
        innerTxHash,
        sponsorBalance: balanceCheck.balance,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("[sponsor/fee-bump] Error:", error)
    return NextResponse.json(
      { error: "Internal server error while creating sponsored transaction." },
      { status: 500 }
    )
  }
}
