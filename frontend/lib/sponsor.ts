/**
 * Gasless transaction sponsorship utilities for first-time depositors.
 *
 * Uses Stellar's built-in FeeBumpTransaction to wrap a user's transaction
 * so the platform sponsor account pays the network fee. This removes the
 * chicken-and-egg barrier where new users need XLM to make their first deposit.
 *
 * Server-side only — never import from client components.
 */

import { Keypair, Transaction, TransactionBuilder, Horizon } from "@stellar/stellar-sdk"

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum sponsored transactions allowed per day (global limit). */
export const MAX_DAILY_SPONSORSHIPS = 100

/** Maximum sponsored transactions per wallet (ever). */
export const MAX_PER_WALLET_SPONSORSHIPS = 1

/** Minimum sponsor account balance in stroops (10 XLM). */
export const MIN_SPONSOR_BALANCE_STROOPS = BigInt(10 * 10_000_000)

/** Rate-limit window: 1 request per wallet per 24 hours. */
export const SPONSOR_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000

// ── In-memory stores ───────────────────────────────────────────────────────────

/** Daily sponsorship counter: key = YYYY-MM-DD, value = count. */
const dailyCount = new Map<string, number>()

/** Per-wallet sponsorship timestamps. */
const walletTimestamps = new Map<string, number[]>()

/** Per-wallet rate-limit timestamps (1 per 24h). */
const walletRateLimits = new Map<string, number[]>()

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().split("T")[0]
}

function pruneTimestamps(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs
  return timestamps.filter((t) => t > cutoff)
}

function createHorizonServer(): Horizon.Server | null {
  const horizonUrl = process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL
  if (!horizonUrl) return null
  return new Horizon.Server(horizonUrl)
}

// ── Eligibility check ──────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean
  reason: string
}

/**
 * Check whether a wallet is eligible for sponsored first deposit.
 *
 * Eligibility criteria:
 * 1. Wallet has never been sponsored before (max 1 per wallet ever).
 * 2. Wallet has no prior soroban/contract interactions on-chain.
 */
export async function checkEligibility(
  walletAddress: string,
  _factoryContractId: string
): Promise<EligibilityResult> {
  // Check 1: Never sponsored before
  const timestamps = walletTimestamps.get(walletAddress.toLowerCase()) ?? []
  if (timestamps.length >= MAX_PER_WALLET_SPONSORSHIPS) {
    return { eligible: false, reason: "This wallet has already used a sponsored deposit." }
  }

  // Check 2: No prior soroban interactions via Horizon
  const server = createHorizonServer()
  if (!server) {
    return { eligible: false, reason: "Sponsorship service unavailable (missing Horizon URL)." }
  }

  try {
    const transactions = await server
      .transactions()
      .forAccount(walletAddress)
      .limit(200)
      .order("desc")
      .call()

    // Soroban transactions have soroban_meta attached. If the account has
    // ever submitted one, conservatively treat it as a returning user.
    const hasSorobanHistory = transactions.records.some(
      (tx: { soroban_meta?: unknown; asset_balance_changes?: unknown[] }) => {
        return tx.soroban_meta != null || tx.asset_balance_changes?.length
      }
    )

    if (hasSorobanHistory) {
      return { eligible: false, reason: "This wallet has prior blockchain activity." }
    }

    return { eligible: true, reason: "First-time user — eligible for sponsored deposit." }
  } catch {
    // If Horizon is unreachable or account doesn't exist yet, allow sponsorship
    // (new accounts with no history are the primary target).
    return { eligible: true, reason: "New wallet — eligible for sponsored deposit." }
  }
}

// ── Transaction sponsorship ────────────────────────────────────────────────────

/**
 * Wrap a user's transaction XDR in a FeeBumpTransaction signed by the
 * sponsor account. The sponsor pays the network fee while the user remains the
 * logical source of the inner transaction.
 *
 * @param innerTxXdr - The user's transaction XDR (assembled, before user signing)
 * @param sponsorSecret - The sponsor account's secret key (server-side only)
 * @param networkPassphrase - Stellar network passphrase
 * @returns The fee-bumped transaction XDR ready for the user to sign the inner tx
 */
export function createSponsoredFeeBump(
  innerTxXdr: string,
  sponsorSecret: string,
  networkPassphrase: string
): { sponsoredTxXdr: string; innerTxHash: string } {
  const sponsorKeypair = Keypair.fromSecret(sponsorSecret)
  const innerTx = new Transaction(innerTxXdr, networkPassphrase)

  // Build the fee-bump: fee source is the sponsor, base fee is 10x the inner fee
  // or 200k stroops minimum (whichever is higher) to ensure the sponsor covers it.
  const baseFee = String(Math.max(Number(innerTx.fee) * 10, 200_000))
  const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
    sponsorKeypair,
    baseFee,
    innerTx,
    networkPassphrase
  )

  feeBumpTx.sign(sponsorKeypair)

  return {
    sponsoredTxXdr: feeBumpTx.toXDR(),
    innerTxHash: innerTx.hash().toString("hex"),
  }
}

// ── Balance check ──────────────────────────────────────────────────────────────

/**
 * Check the sponsor account balance. Returns true if balance >= 10 XLM.
 */
export async function checkSponsorBalance(sponsorAddress: string): Promise<{
  ok: boolean
  balance: string
}> {
  const server = createHorizonServer()
  if (!server) return { ok: false, balance: "0" }

  try {
    const account = await server.accounts().accountId(sponsorAddress).call()
    const balance = account.balances.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native"
    )
    const balanceStroops = balance
      ? BigInt(Math.round(parseFloat(balance.balance) * 10_000_000))
      : 0n

    return {
      ok: balanceStroops >= MIN_SPONSOR_BALANCE_STROOPS,
      balance: (Number(balanceStroops) / 10_000_000).toFixed(7),
    }
  } catch {
    return { ok: false, balance: "0" }
  }
}

// ── Daily limit ────────────────────────────────────────────────────────────────

export function getDailySponsorshipCount(): number {
  return dailyCount.get(todayKey()) ?? 0
}

export function incrementDailySponsorshipCount(): number {
  const key = todayKey()
  const current = dailyCount.get(key) ?? 0
  dailyCount.set(key, current + 1)
  return current + 1
}

export function isDailyLimitReached(): boolean {
  return getDailySponsorshipCount() >= MAX_DAILY_SPONSORSHIPS
}

// ── Per-wallet rate limit ──────────────────────────────────────────────────────

export function checkWalletRateLimit(walletAddress: string): { ok: boolean; retryAfterMs: number } {
  const now = Date.now()
  const timestamps = walletRateLimits.get(walletAddress.toLowerCase()) ?? []
  const pruned = pruneTimestamps(timestamps, SPONSOR_RATE_LIMIT_WINDOW_MS, now)
  walletRateLimits.set(walletAddress.toLowerCase(), pruned)

  if (pruned.length >= MAX_PER_WALLET_SPONSORSHIPS) {
    const oldest = pruned[0]
    const retryAfterMs = SPONSOR_RATE_LIMIT_WINDOW_MS - (now - oldest)
    return { ok: false, retryAfterMs }
  }

  return { ok: true, retryAfterMs: 0 }
}

export function recordWalletSponsorship(walletAddress: string): void {
  const key = walletAddress.toLowerCase()
  const timestamps = walletTimestamps.get(key) ?? []
  timestamps.push(Date.now())
  walletTimestamps.set(key, timestamps)

  const rateTimestamps = walletRateLimits.get(key) ?? []
  rateTimestamps.push(Date.now())
  walletRateLimits.set(key, rateTimestamps)
}

// ── Sponsor dashboard stats ────────────────────────────────────────────────────

export interface SponsorStats {
  dailyCount: number
  dailyLimit: number
  sponsorBalance: string
  sponsorBalanceOk: boolean
  sponsorAddress: string
}

export async function getSponsorStats(): Promise<SponsorStats> {
  const sponsorAddress = process.env.NEXT_PUBLIC_SPONSOR_ADDRESS || ""
  const balanceResult = sponsorAddress
    ? await checkSponsorBalance(sponsorAddress)
    : { ok: false, balance: "0" }

  return {
    dailyCount: getDailySponsorshipCount(),
    dailyLimit: MAX_DAILY_SPONSORSHIPS,
    sponsorBalance: balanceResult.balance,
    sponsorBalanceOk: balanceResult.ok,
    sponsorAddress,
  }
}
