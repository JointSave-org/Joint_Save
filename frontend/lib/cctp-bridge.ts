/**
 * Pure logic for the cross-chain USDC deposit bridge (Circle CCTP). No
 * wallet, no network, no React — mirrors `deposit-calendar.ts` / `batch-deposit.ts`
 * so the attestation state machine and amount/rounding/balance maths are
 * unit-testable in isolation.
 *
 * The actual chain operations (burning USDC via `depositForBurn`, reading
 * `MessageSent` events, polling Circle's Attestation Service, submitting
 * `receiveMessage` on Stellar) live behind a thin seam — `CctpDriver` — so
 * tests can exercise every branch without touching a network.
 */

// ── Chain / token metadata ───────────────────────────────────────────────────

export interface CctpChain {
  /** Short identifier, stable in storage. */
  id: string
  name: string
  /** CCTP domain id used in `depositForBurn`. */
  domain: number
  /** EVM chain id. */
  chainId: number
  /** Explorer base URL (used for the block-explorer refund link). */
  explorerUrl: string
  /** Number of USDC decimals on this chain (all CCTP EVM minters use 6). */
  decimals: number
  /** Miner/token contract txn explorer shape, e.g. "/tx/{hash}". */
  txPath: string
}

/** Source chains offered on the bridge panel. */
export const CCTP_CHAINS: CctpChain[] = [
  {
    id: "ethereum",
    name: "Ethereum",
    domain: 0,
    chainId: 1,
    decimals: 6,
    explorerUrl: "https://etherscan.io",
    txPath: "tx",
  },
  {
    id: "optimism",
    name: "Optimism",
    domain: 2,
    chainId: 10,
    decimals: 6,
    explorerUrl: "https://optimistic.etherscan.io",
    txPath: "tx",
  },
  {
    id: "arbitrum",
    name: "Arbitrum",
    domain: 3,
    chainId: 42161,
    decimals: 6,
    explorerUrl: "https://arbiscan.io",
    txPath: "tx",
  },
  {
    id: "base",
    name: "Base",
    domain: 6,
    chainId: 8453,
    decimals: 6,
    explorerUrl: "https://basescan.org",
    txPath: "tx",
  },
  {
    id: "polygon",
    name: "Polygon",
    domain: 7,
    chainId: 137,
    decimals: 6,
    explorerUrl: "https://polygonscan.com",
    txPath: "tx",
  },
]

export function getCctpChainById(id: string | null | undefined): CctpChain | undefined {
  if (!id) return undefined
  return CCTP_CHAINS.find((c) => c.id === id)
}

export interface CctpDestination {
  id: "stellar"
  name: "Stellar"
  /** CCTP destination domain used in `depositForBurn` for the Stellar mint. */
  domain: number
  /** USDC decimals once minted on Stellar (SAC). */
  decimals: number
}

export const CCTP_DESTINATION: CctpDestination = {
  id: "stellar",
  name: "Stellar",
  domain: 4,
  decimals: 7,
}

// ── Amount / rounding / balance ─────────────────────────────────────────────

/**
 * Number of base units (atomic units) per 1 human USDC on a source chain.
 */
export function usdcScale(decimals: number): bigint {
  return 10n ** BigInt(decimals)
}

/**
 * Convert a human USDC amount string (EVM native, 6 decimals) into base units.
 * Throws when the amount has more fractional digits than the chain's USDC
 * precision or isn't a valid number.
 */
export function usdcHumanToBase(amount: string | number, decimals = 6): bigint {
  const raw = typeof amount === "string" ? amount.trim() : String(amount)
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`invalid USDC amount: ${raw}`)
  }
  const negative = raw.startsWith("-")
  const unsigned = negative ? raw.slice(1) : raw
  const [whole, frac = ""] = unsigned.split(".")
  if (frac.length > decimals) {
    throw new Error(
      `amount ${raw} exceeds ${decimals} decimal places for USDC (got ${frac.length})`
    )
  }
  const scale = usdcScale(decimals)
  const units = BigInt(whole === "" ? "0" : whole) * scale + BigInt(frac.padEnd(decimals, "0"))
  return negative ? -units : units
}

/**
 * Convert base units back to a human USDC string (e.g. `125000000n @ 6` →
 * "125"). Trims trailing zeros.
 */
export function usdcBaseToHuman(units: bigint, decimals = 6): string {
  const negative = units < 0n
  const abs = negative ? -units : units
  const scale = usdcScale(decimals)
  const whole = abs / scale
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "")
  const sign = negative ? "-" : ""
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`
}

/**
 * Validate a bridge amount against the source chain's USDC precision and the
 * wallet's on-chain balance (in base units). Returns an error message or null.
 */
export function validateBridgeAmount(
  humanAmount: string,
  decimals: number,
  walletBalanceBase?: bigint
): string | null {
  let wanted: bigint
  try {
    wanted = usdcHumanToBase(humanAmount, decimals)
  } catch {
    return "Enter a valid USDC amount."
  }
  if (wanted <= 0n) return "Amount must be greater than zero."
  if (walletBalanceBase != null && walletBalanceBase < wanted) {
    return "Insufficient USDC balance on the selected chain."
  }
  return null
}

// ── Bridge transaction status ────────────────────────────────────────────────

/**
 * Lifecycle of a cross-chain bridge transaction. `deposited` is reached only
 * after the minted USDC is credited to the user's pool via the existing
 * deposit route.
 */
export type BridgeStatus = "pending" | "attested" | "received" | "deposited" | "failed"

export const BRIDGE_STATUS_ORDER: BridgeStatus[] = [
  "pending",
  "attested",
  "received",
  "deposited",
  "failed",
]

/** Human labels for the status progress trail, keyed for i18n. */
export const BRIDGE_STATUS_LABEL_KEY: Record<BridgeStatus, string> = {
  pending: "statusPending",
  attested: "statusAttested",
  received: "statusReceived",
  deposited: "statusDeposited",
  failed: "statusFailed",
}

// ── Attestation state machine ────────────────────────────────────────────────

/**
 * Raw statuses returned by Circle's Attestation Service. A "failure" or
 * "expired" attestation can never complete — the burn cannot be received on
 * the destination and the user must use Circle's refund flow on the source
 * chain.
 */
export type AttestationRawStatus =
  "pending_confirmations" | "pending_attestation" | "complete" | "failure" | "expired"

export type AttestationPhase = "pending" | "complete" | "failure"

/** Recommended next-step copy for failed attestations, keyed for i18n. */
export const ATTESTATION_COMMENT_KEY: Record<string, string> = {
  failure: "refundHint",
  expired: "expiredHint",
}

/**
 * Reduce a raw CCTP attestation status to the simplified phase the bridge
 * progress UI cares about: `pending` → keep polling, `complete` → can call
 * `receiveMessage`, anything else → surfaced as a terminal `failure`.
 */
export function resolveAttestationPhase(status: AttestationRawStatus): AttestationPhase {
  if (status === "complete") return "complete"
  if (status === "pending_confirmations" || status === "pending_attestation") return "pending"
  return "failure"
}

/**
 * State machine driver: given the current bridge status and the latest
 * attestation phase, return the next bridge status. Terminal states
 * (`deposited`, `failed`) are never regressed.
 */
export function advanceBridgeStatus(
  current: BridgeStatus,
  attestation: AttestationPhase
): BridgeStatus {
  if (current === "deposited" || current === "failed") return current
  if (attestation === "failure") return "failed"
  if (current === "pending" && attestation === "complete") return "attested"
  return current
}

// ── Thin seam for network operations ─────────────────────────────────────────

/**
 * What the bridge UI needs from the network layer. Implementations handle
 * the actual EVM/Attestation/Stellar calls; the page only consumes the
 * returned data, keeping wallet/network code testable behind this seam.
 */
export interface CctpDriverResult {
  /** Message hash the transaction produced in the `MessageSent` event. */
  messageHash: string
  /** Source-chain transaction hash (for explorer refund links). */
  sourceTxHash: string
}

export interface CctpDriver {
  /** Burn USDC on the source chain and capture the `MessageSent` event. */
  depositForBurn(input: {
    sourceChain: CctpChain
    amountBaseUnits: bigint
    destination: CctpDestination
    recipient: string
  }): Promise<CctpDriverResult>
  /** Poll Circle's Attestation Service for a message hash. */
  fetchAttestation(messageHash: string): Promise<{ status: AttestationRawStatus }>
}

/** Default Circle Attestation Service endpoint (Testnet/sandbox). */
export const ATTESTATION_SERVICE_URL =
  process.env.NEXT_PUBLIC_CCTP_ATTESTATION_URL ||
  "https://iris-api-sandbox.circle.com/v1/attestations"

/** Build the attestation URL for a message hash. */
export function attestationUrl(messageHash: string): string {
  return `${ATTESTATION_SERVICE_URL}/${messageHash}`
}

/** Build a source-chain explorer URL for a tx hash (refund flow link). */
export function explorerTxUrl(chain: CctpChain, txHash: string): string {
  return `${chain.explorerUrl}/${chain.txPath}/${txHash}`
}
