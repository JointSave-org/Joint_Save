// Pure yield-allocation domain helpers shared by hooks, components and tests.
// Kept framework-free so it can be unit-tested with the node test runner.
//
// Mirrors the on-chain invariants in `contracts/flexible`:
//   * a configurable liquidity buffer (bps of total balance) must always stay
//     liquid so withdrawals never depend on the vault,
//   * only idle (unallocated) pot capital may be pushed into the vault,
//   * a position's gain is `position - costBasis`, distributed pro-rata.

export const SHARE_SCALE = 1_000_000_000
export const BPS_DENOMINATOR = 10_000
export const DEFAULT_BUFFER_BPS = 2000
export const MAX_BUFFER_BPS = BPS_DENOMINATOR

export interface YieldAllocationState {
  vault: string | null
  shares: bigint
  costBasis: bigint
  bufferBps: number
  locked: boolean
  position: bigint
  unrealised: bigint
  maxAllocatable: bigint
}

/** Whether the pool has any capital allocated to a vault. */
export function isAllocated(state: Pick<YieldAllocationState, "shares" | "vault">): boolean {
  return Boolean(state.vault) && state.shares > 0n
}

/**
 * Liquid (unallocated) pot capital given the total pot balance and the
 * currently allocated cost basis.
 */
export function liquidBalance(totalBalance: bigint, allocated: bigint): bigint {
  const liquid = totalBalance - allocated
  return liquid > 0n ? liquid : 0n
}

/**
 * Largest amount that may be pushed into the vault: idle capital minus the
 * buffer that must remain liquid. Mirrors the contract's floor in favour of
 * the buffer (never over-allocate).
 */
export function computeMaxAllocatable(
  totalBalance: bigint,
  allocated: bigint,
  bufferBps: number
): bigint {
  if (totalBalance <= 0n) return 0n
  const bps = clampBufferBps(bufferBps)
  const buffered = (totalBalance * BigInt(bps)) / BigInt(BPS_DENOMINATOR)
  const liquid = liquidBalance(totalBalance, allocated)
  const headroom = liquid - buffered
  return headroom > 0n ? headroom : 0n
}

/** Clamp a buffer percentage (bps) into the accepted [0, 10000] range. */
export function clampBufferBps(bps: number): number {
  if (!Number.isFinite(bps)) return DEFAULT_BUFFER_BPS
  const rounded = Math.trunc(bps)
  if (rounded < 0) return 0
  if (rounded > MAX_BUFFER_BPS) return MAX_BUFFER_BPS
  return rounded
}

/** Validate a buffer percentage (bps) and return an error string when invalid. */
export function validateBufferBps(bps: number): string | null {
  if (!Number.isFinite(bps)) return "Buffer must be a number"
  if (!Number.isInteger(bps)) return "Buffer must be a whole number of basis points"
  if (bps < 0) return "Buffer cannot be negative"
  if (bps > MAX_BUFFER_BPS) return "Buffer cannot exceed 100%"
  return null
}

/**
 * The vault's share price in scaled units (tokens per SHARE_SCALE shares).
 * Returns `null` when there are no shares to price.
 */
export function sharePrice(position: bigint, shares: bigint): bigint | null {
  if (shares <= 0n) return null
  return (position * BigInt(SHARE_SCALE)) / shares
}

/**
 * Unrealised gain still sitting in the vault (position value minus cost basis).
 * Never negative — a loss leaves the pot with its principal basis intact.
 */
export function unrealisedGain(position: bigint, costBasis: bigint): bigint {
  const gain = position - costBasis
  return gain > 0n ? gain : 0n
}

/** True when the pool holds an allocated position that cannot be withdrawn now. */
export function isIlliquid(state: Pick<YieldAllocationState, "locked" | "shares">): boolean {
  return state.locked && state.shares > 0n
}

/** Percentage of a member's principal that is currently earning yield (0-100). */
export function allocatedSharePct(allocated: bigint, totalBalance: bigint): number {
  if (totalBalance <= 0n) return 0
  const pct = (Number(allocated) / Number(totalBalance)) * 100
  if (!Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

/** Format a share price (tokens per share) as a fixed-precision string. */
export function formatSharePrice(
  position: bigint,
  shares: bigint,
  precision = 4
): string | null {
  if (shares <= 0n) return null
  const price = sharePrice(position, shares)
  if (price === null) return null
  const whole = price / BigInt(SHARE_SCALE)
  const frac = price % BigInt(SHARE_SCALE)
  const value = Number(whole) + Number(frac) / SHARE_SCALE
  return value.toFixed(precision)
}
