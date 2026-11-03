/**
 * Stellar ledger & time utilities.
 *
 * Stellar ledgers close approximately every 5 seconds.
 * These utilities provide deterministic estimates and helpers for deadlines,
 * timeouts, and block sequence conversions.
 */

/** Average duration of a Stellar ledger in seconds (standard network cadence). */
export const SECONDS_PER_LEDGER = 5 as const;

/** Total seconds in a standard calendar day (24 * 3600). */
export const SECONDS_PER_DAY = 86_400 as const;

/** Approximate number of ledgers closed per 24-hour day (~17,280). */
export const LEDGERS_PER_DAY = 17_280;

/**
 * Converts a duration in days to the equivalent number of closed ledgers.
 *
 * @param days - Number of days (integer or float)
 * @returns Approximate ledger count (integer)
 */
export function daysToLedgers(days: number): number {
  if (!Number.isFinite(days) || days < 0) {
    throw new RangeError(`Days must be a non-negative finite number, got: ${days}`);
  }
  return Math.round(days * LEDGERS_PER_DAY);
}

/**
 * Converts a ledger count to the equivalent number of days.
 *
 * @param ledgers - Number of ledgers
 * @returns Equivalent days (float)
 */
export function ledgersToDays(ledgers: number): number {
  if (!Number.isFinite(ledgers) || ledgers < 0) {
    throw new RangeError(`Ledgers must be a non-negative finite number, got: ${ledgers}`);
  }
  return ledgers / LEDGERS_PER_DAY;
}

/**
 * Estimates a Unix timestamp (in milliseconds) for a future or historical ledger,
 * relative to a known reference ledger and reference timestamp.
 *
 * @param targetLedger - Target ledger sequence number
 * @param refLedger - Reference ledger sequence number
 * @param refTimestampMs - Reference timestamp in milliseconds (defaults to Date.now())
 * @returns Estimated timestamp in milliseconds
 */
export function ledgerToTimestamp(
  targetLedger: number,
  refLedger: number = 0,
  refTimestampMs: number = Date.now()
): number {
  const diffLedgers = targetLedger - refLedger;
  const diffSeconds = diffLedgers * SECONDS_PER_LEDGER;
  return refTimestampMs + diffSeconds * 1000;
}

/**
 * Estimates a target ledger sequence number at a given target Date or timestamp,
 * relative to a known reference ledger and reference timestamp.
 *
 * @param targetDate - Target Date or timestamp in milliseconds
 * @param refLedger - Reference ledger sequence number
 * @param refTimestampMs - Reference timestamp in milliseconds (defaults to Date.now())
 * @returns Estimated ledger sequence number
 */
export function estimateLedgerAt(
  targetDate: Date | number,
  refLedger: number = 0,
  refTimestampMs: number = Date.now()
): number {
  const targetMs = typeof targetDate === 'number' ? targetDate : targetDate.getTime();
  const diffMs = targetMs - refTimestampMs;
  const diffSeconds = diffMs / 1000;
  const diffLedgers = Math.round(diffSeconds / SECONDS_PER_LEDGER);
  return Math.max(0, refLedger + diffLedgers);
}

/**
 * Checks whether a given deadline (in epoch seconds) has elapsed.
 *
 * @param deadlineSecs - Target deadline timestamp in seconds
 * @param nowSecs - Optional current timestamp in seconds (defaults to current time)
 * @returns True if current time is strictly greater than deadlineSecs
 */
export function isPastDeadline(deadlineSecs: number, nowSecs?: number): boolean {
  const current = nowSecs ?? Math.floor(Date.now() / 1000);
  return current > deadlineSecs;
}

/**
 * Asynchronously pauses execution for the given duration in milliseconds.
 *
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = (globalThis as unknown as { setTimeout: (fn: () => void, d: number) => unknown }).setTimeout;
    timer(resolve, Math.max(0, ms));
  });
}
