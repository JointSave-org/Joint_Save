/**
 * Token registry for JointSave's supported deposit currencies (native XLM and
 * USDC on Stellar). Used by the pool creation form, deposit flow, and the
 * bridge tutorial page to look up display metadata without hardcoding
 * contract ids in components.
 *
 * This is distinct from the free-form "custom token" path in
 * `components/create-group/token-select.tsx`, which lets an admin point a
 * pool at *any* SEP-41 contract. This registry covers the two first-class,
 * pre-vetted currencies the rest of the UI (bridge page, balance widgets)
 * knows how to talk about by name.
 */

import { fetchTokenBalance, formatTokenAmount } from "@/hooks/useJointSaveContracts"

export interface TokenInfo {
  name: string
  symbol: string
  /** "native" for XLM, or a C… SAC/token contract id. */
  contractAddress: string
  decimals: number
  /** Emoji/icon shown next to the symbol in token pickers and balances. */
  icon: string
}

// Circle's official USDC issuance on Stellar testnet, wrapped as a Stellar
// Asset Contract (SAC). Overridable via env for other networks/deployments.
// See: https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
const DEFAULT_USDC_TESTNET_SAC_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"

const USDC_CONTRACT_ID =
  process.env.NEXT_PUBLIC_USDC_CONTRACT_ID?.trim() || DEFAULT_USDC_TESTNET_SAC_ID

/** The two first-class deposit currencies JointSave supports. */
export const SUPPORTED_TOKENS: TokenInfo[] = [
  {
    name: "Stellar Lumens",
    symbol: "XLM",
    contractAddress: "native",
    decimals: 7,
    icon: "🪙",
  },
  {
    name: "USD Coin",
    symbol: "USDC",
    contractAddress: USDC_CONTRACT_ID,
    decimals: 7,
    icon: "💵",
  },
]

/** Look up a registered token by its symbol (case-insensitive). */
export function getTokenBySymbol(symbol: string | null | undefined): TokenInfo | undefined {
  if (!symbol) return undefined
  const upper = symbol.toUpperCase()
  return SUPPORTED_TOKENS.find((t) => t.symbol === upper)
}

/** Look up a registered token by its contract address ("native" or C…). */
export function getTokenByAddress(address: string | null | undefined): TokenInfo | undefined {
  if (!address) return undefined
  if (address === "native") return SUPPORTED_TOKENS[0]
  return SUPPORTED_TOKENS.find((t) => t.contractAddress === address)
}

/**
 * Format a base-units amount (bigint, as read from a contract) into a
 * display string for the given token, e.g. `formatTokenAmount(1250000000n,
 * getTokenBySymbol("XLM"))` → "125.00 XLM".
 */
export function formatTokenDisplayAmount(amount: bigint, token: TokenInfo): string {
  const human = formatTokenAmount(amount, token.decimals)
  return `${human.toFixed(2)} ${token.symbol}`
}

/**
 * Fetch a wallet's balance for the given token, returned as a human-readable
 * number (already divided by the token's decimals). Returns 0 if the RPC
 * call fails (e.g. the account has no trustline / no funds) so callers can
 * render "0" instead of crashing the deposit form.
 */
export async function getTokenBalance(walletAddress: string, token: TokenInfo): Promise<number> {
  try {
    const base = await fetchTokenBalance(token.contractAddress, walletAddress)
    return formatTokenAmount(base, token.decimals)
  } catch {
    return 0
  }
}

// Approximate XLM/USD rate used when no live quote is available. This is a
// static placeholder — swap `getUsdApproxValue` for a Stellar DEX order-book
// lookup or a Supabase-cached price table once one exists. USDC is a
// stablecoin, so it's treated as ~1:1 with no lookup needed.
const XLM_USD_FALLBACK_RATE = 0.12

/**
 * Approximate USD value of a human-readable token amount, for display next
 * to deposit/withdraw amounts (e.g. "100 XLM ≈ $12.00"). Never throws —
 * falls back to a static rate for XLM so the UI always has something to show.
 */
export function getUsdApproxValue(amount: number, token: TokenInfo): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (token.symbol === "USDC") return amount
  return amount * XLM_USD_FALLBACK_RATE
}

/** Format a USD approx value for display, e.g. "≈ $12.00". */
export function formatUsdApprox(amount: number, token: TokenInfo): string {
  return `≈ $${getUsdApproxValue(amount, token).toFixed(2)}`
}
