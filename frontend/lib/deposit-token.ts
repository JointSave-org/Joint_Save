/**
 * Pure logic behind end-to-end multi-token (SEP-41) deposits.
 *
 * A pool may accept deposits in more than one settlement token (see the
 * contract's `set_supported_tokens` / `get_supported_tokens`). The deposit
 * flow — UI token picker, balance/trustline checks, and the deposit API route —
 * all share the same amount maths, so it lives here as a dependency-free,
 * unit-testable module (mirroring `deposit-calendar.ts` / `batch-deposit.ts`).
 *
 * The two things every caller needs:
 *  1. the right decimals for the chosen asset (7 for native XLM, or the
 *     SEP-41 contract's decimals otherwise), and
 *  2. converting between the *human* unit shown in the UI and the *base* unit
 *     (stroops / raw integer) the contract and Horizon deal in — always the
 *     reverse of what a naive `amount * 10 ** decimals` would assume.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** A token the pool's deposit flow can accept, with display + maths metadata. */
export interface DepositToken {
  /** "native" for XLM, or a C… SAC/token contract id. */
  contractAddress: string
  /** e.g. "XLM" or "USDC". */
  symbol: string
  /** Stellar asset decimals (7 for native XLM and for SAC-wrapped tokens). */
  decimals: number
}

/** Result of validating that a chosen token is actually acceptable. */
export type TokenSelectionResult = { ok: true; token: DepositToken } | { ok: false; reason: string }

/** Result of validating a user-entered human amount against an on-chain balance. */
export type BalanceCheckResult = { ok: true; baseUnits: bigint } | { ok: false; reason: string }

// ── Constants ────────────────────────────────────────────────────────────────

/** Native XLM uses 7 decimals (stroops) on Stellar. */
export const NATIVE_DECIMALS = 7

/** The contract caps how many SEP-41 trustlines an account can hold. */
export const MAX_TRUSTLINES = 7

/** Maximum digits of precision we allow in a human amount input (>= 0). */
const MAX_AMOUNT_DIGITS = 20

// ── Decimals & unit conversion ───────────────────────────────────────────────

/** Guard a decimals value: must be a safe, non-negative integer (Stellar caps
 * asset decimals at 7, but custom tokens may be lower). Falls back to native. */
export function normalizeDecimals(decimals: number | null | undefined): number {
  if (
    typeof decimals !== "number" ||
    !Number.isFinite(decimals) ||
    decimals < 0 ||
    Math.floor(decimals) !== decimals
  ) {
    return NATIVE_DECIMALS
  }
  return decimals
}

/**
 * Convert a human amount (e.g. "1.5") into base units for a token with the
 * given decimals, i.e. the integer the contract/Horizon expect. Returns
 * `null` when the input is not a finite, non-negative decimal number, so
 * callers can show a validation error instead of minting a bogus value.
 *
 * Safe against floating-point error (e.g. `humanToBaseUnits("0.07", 7)`
 * must be exactly `7000000`, not `6999999`).
 */
export function humanToBaseUnits(amount: number | string, decimals: number): bigint | null {
  const normalized = normalizeDecimals(decimals)
  const raw = typeof amount === "number" ? String(amount) : amount
  const trimmed = raw.trim()
  if (trimmed === "") return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null

  const [intPart, fracPart = ""] = trimmed.split(".")
  if (intPart.length > MAX_AMOUNT_DIGITS) return null
  if (fracPart.length > normalized) return null

  // Left-pad the fractional part to the token's decimals, then join into one
  // integer string. "1.5" @ 7 decimals → "1" + "5000000" → "15000000".
  const paddedFrac = fracPart.padEnd(normalized, "0")
  const joined = `${intPart}${paddedFrac}`
  try {
    return BigInt(joined)
  } catch {
    return null
  }
}

/**
 * Convert base units (stroops) back into a human amount string for a token
 * with the given decimals. Inverse of `humanToBaseUnits`. e.g.
 * `baseUnitsToHuman(7000000n, 7)` → "0.7000000". Trailing zeros beyond the
 * integer part are preserved to match the token's precision so callers can
 * format consistently with the repo's number conventions.
 */
export function baseUnitsToHuman(baseUnits: bigint, decimals: number): string {
  const normalized = normalizeDecimals(decimals)
  const negative = baseUnits < 0n
  const abs = negative ? -baseUnits : baseUnits
  const str = abs.toString()
  if (normalized === 0) return negative ? `-${str}` : str

  if (str.length <= normalized) {
    const padded = str.padStart(normalized + 1, "0")
    const int = padded.slice(0, -normalized)
    const frac = padded.slice(-normalized)
    return `${negative ? "-" : ""}${int}.${frac}`
  }
  const int = str.slice(0, -normalized)
  const frac = str.slice(-normalized)
  return `${negative ? "-" : ""}${int}.${frac}`
}

/**
 * Trim trailing zeros from a base-units-derived human string so display
 * reads "1.5" instead of "1.5000000" (keeping at least the integer part).
 */
export function trimHumanAmount(human: string): string {
  if (!human.includes(".")) return human
  const [int, frac] = human.split(".")
  const trimmedFrac = frac.replace(/0+$/, "")
  return trimmedFrac === "" ? int : `${int}.${trimmedFrac}`
}

// ── Token selection ──────────────────────────────────────────────────────────

/**
 * Resolve a chosen token against the pool's allowed set (the contract's
 * `get_supported_tokens`, mapped to `DepositToken`s). A token is acceptable
 * when its contract address matches a supported one (with `"native"` treated
 * as the native XLM SAC). Empty supported list = unrestricted (pool only ever
 * holds its single `initialize()` token).
 */
export function validateTokenSelection(
  candidate: DepositToken,
  supported: DepositToken[]
): TokenSelectionResult {
  const address = candidate.contractAddress
  const isNative = address === "native"
  const exact = supported.find(
    (s) => s.contractAddress === address || (isNative && s.contractAddress === "native")
  )

  if (exact) return { ok: true, token: exact }
  // Unrestricted pools: any single candidate is accepted as-is.
  if (supported.length === 0) return { ok: true, token: candidate }

  return {
    ok: false,
    reason: `Token ${candidate.symbol} is not supported by this pool`,
  }
}

// ── Balance & trustline checks ───────────────────────────────────────────────

/**
 * Validate a human deposit amount against an on-chain base-units balance
 * (from `fetchTokenBalance`). The `balance` is already in base units; we
 * convert the user's human input to base units for a like-for-like comparison
 * so a 7-decimals token compares correctly even at low values.
 */
export function checkSufficientBalance(
  humanAmount: number | string,
  balanceBaseUnits: bigint,
  decimals: number
): BalanceCheckResult {
  const amountBase = humanToBaseUnits(humanAmount, decimals)
  if (amountBase === null) {
    return { ok: false, reason: "Enter a valid amount" }
  }
  if (amountBase <= 0n) {
    return { ok: false, reason: "Amount must be greater than zero" }
  }
  if (amountBase > balanceBaseUnits) {
    return { ok: false, reason: "Insufficient balance for this deposit" }
  }
  return { ok: true, baseUnits: amountBase }
}

// ── Fee maths ────────────────────────────────────────────────────────────────

/**
 * Compute the treasury + relayer fee on a human deposit amount, in the
 * *same* human unit as `humanAmount`. The contract applies these basis points
 * to the settlement token, so we compute on the human number and return the
 * human fee amount (with the token's decimals preserved for display).
 *
 * @param humanAmount deposit amount in human units
 * @param treasuryFeeBps treasury fee in basis points (10000 = 100%)
 * @param relayerFeeBps relayer fee in basis points (10000 = 100%)
 * @param decimals token decimals (for rounding)
 * @returns `{ feeHuman, netHuman }` where netHuman = amount − fee
 */
export function computeDepositFee(
  humanAmount: number | string,
  treasuryFeeBps: number,
  relayerFeeBps: number,
  decimals: number
): { feeHuman: number; netHuman: number } {
  const base = humanToBaseUnits(humanAmount, decimals) ?? 0n
  const totalBps = (treasuryFeeBps || 0) + (relayerFeeBps || 0)
  const feeBase = (base * BigInt(totalBps)) / 10000n
  const netBase = base - feeBase
  return {
    feeHuman: Number(baseUnitsToHuman(feeBase, decimals)),
    netHuman: Number(baseUnitsToHuman(netBase, decimals)),
  }
}
