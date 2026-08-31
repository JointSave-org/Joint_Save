/**
 * Pure logic for multi-token (SEP-41) deposits. No wallet, no network, no
 * React — mirrors `deposit-calendar.ts` / `batch-deposit.ts` so the amount,
 * decimals, balance and fee maths are unit-testable in isolation.
 *
 * Stellar SEP-41 assets carry their own `decimals` (native XLM is 7, USDC SAC
 * is 7, but a custom contract could be e.g. 6 or 18). This module keeps every
 * conversion in exact integer (base-units / stroops) arithmetic so deposits
 * recorded by the API and passed to contracts never lose floating-point
 * precision.
 */

// ── Core conversions ─────────────────────────────────────────────────────────

/**
 * Number of base units per 1 human unit for an asset with `decimals` digits.
 */
export function scaleForDecimals(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`invalid decimals: ${decimals}`)
  }
  return 10n ** BigInt(decimals)
}

/**
 * Convert a human-readable amount (as a string, e.g. "0.07") into exact
 * base-units (stroops) for the given asset precision. Rejects more fractional
 * digits than the asset supports (e.g. 8 decimal places for a 7-decimal
 * asset) to avoid silently truncating user funds.
 */
export function humanToBaseUnits(amount: string | number, decimals: number): bigint {
  const raw = typeof amount === "string" ? amount.trim() : String(amount)
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`invalid amount: ${raw}`)
  }
  const negative = raw.startsWith("-")
  const unsigned = negative ? raw.slice(1) : raw
  const [whole, frac = ""] = unsigned.split(".")
  if (frac.length > decimals) {
    throw new Error(
      `amount ${raw} exceeds ${decimals} decimal places for this asset (got ${frac.length})`
    )
  }
  const padded = frac.padEnd(decimals, "0")
  const units = BigInt(whole === "" ? "0" : whole) * scaleForDecimals(decimals) + BigInt(padded)
  return negative ? -units : units
}

/**
 * Convert exact base-units back to a human-readable string for the given
 * asset precision (e.g. `700000n @ 7` → "0.07"). Exact — no float rounding.
 */
export function baseUnitsToHuman(units: bigint, decimals: number): string {
  const negative = units < 0n
  const abs = negative ? -units : units
  const scale = scaleForDecimals(decimals)
  const whole = abs / scale
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "")
  const sign = negative ? "-" : ""
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`
}

/**
 * Strip trailing zeros (and a trailing decimal point) from a human amount
 * string for display, e.g. "50.0000000" → "50". Never changes the value.
 */
export function trimHumanAmount(amount: string): string {
  if (!amount.includes(".")) return amount
  return amount.replace(/\.?0+$/, "")
}

// ── Token selection ──────────────────────────────────────────────────────────

export interface DepositToken {
  /** "native" for XLM, or a C… SEP-41 contract id. */
  address: string
  symbol: string
  name?: string
  decimals: number
}

/**
 * Validate that `token` is allowed for a pool whose supported set is
 * `supported`. An empty supported set (contract default) means unrestricted.
 * Returns an error message string, or `null` when the token is acceptable.
 */
export function validateTokenSelection(
  token: Pick<DepositToken, "address" | "symbol">,
  supported: string[]
): string | null {
  if (!token.address) return "Please choose a deposit token."
  if (supported.length === 0) return null
  const normalized = supported.map((a) => a.toUpperCase())
  if (normalized.includes(token.address.toUpperCase())) return null
  if (normalized.includes("native") && token.address === "native") return null
  return `${token.symbol} is not an accepted deposit token for this pool (accepted: ${supported.join(", ")}).`
}

// ── Balance checking ─────────────────────────────────────────────────────────

/**
 * Check a wallet's balance (in base units) is sufficient for a human amount
 * in the given decimals. Returns an error message string, or `null` if the
 * balance covers the amount.
 */
export function checkSufficientBalance(
  humanAmount: string,
  decimals: number,
  walletBalanceBaseUnits: bigint
): string | null {
  let wanted: bigint
  try {
    wanted = humanToBaseUnits(humanAmount, decimals)
  } catch {
    return "Enter a valid amount."
  }
  if (wanted <= 0n) return "Amount must be greater than zero."
  if (walletBalanceBaseUnits < wanted) return "Insufficient balance for the selected token."
  return null
}

// ── Fees ─────────────────────────────────────────────────────────────────────

/**
 * Compute the treasury + relayer fee (in basis points) taken from a deposit.
 * Returns the fee as base units (exact integer) and the net credited amount,
 * both in the settlement token's own unit.
 */
export function computeDepositFee(
  grossHuman: string,
  decimals: number,
  treasuryFeeBps: number,
  relayerFeeBps: number
): { fee: bigint; feeHuman: string; net: bigint; netHuman: string } {
  const gross = humanToBaseUnits(grossHuman, decimals)
  const grossFeeBps = treasuryFeeBps + relayerFeeBps
  // fee = round(gross * bps / 10000), exact with factor 10000
  const fee = (gross * BigInt(grossFeeBps) + 5000n) / 10000n
  const net = gross - fee
  return {
    fee,
    feeHuman: baseUnitsToHuman(fee, decimals),
    net,
    netHuman: baseUnitsToHuman(net, decimals),
  }
}

// ── Supported-token helpers ──────────────────────────────────────────────────

/**
 * True when the supported-token list has 2+ distinct entries (i.e. the pool
 * is genuinely multi-token, not just the single settlement token).
 */
export function isMultiToken(supported: string[]): boolean {
  const unique = new Set(supported.map((a) => a.toUpperCase()))
  return unique.size >= 2
}
