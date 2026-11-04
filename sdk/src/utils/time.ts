/**
 * Ledger and time helpers.
 *
 * Stellar closes a ledger roughly every 5 seconds. These helpers convert
 * between human time and ledger counts; they are **estimates**, not exact
 * block times, and never query the network.
 */
import { LEDGERS_PER_DAY, SECONDS_PER_LEDGER } from "../constants";

export { LEDGERS_PER_DAY, SECONDS_PER_LEDGER };

/** Reference point used to translate between ledger sequence and wall time. */
export interface LedgerReference {
  /** Known current ledger sequence. */
  currentLedger: number;
  /** Unix milliseconds corresponding to `currentLedger`. Default: epoch (0). */
  nowMs?: number;
}

/** Convert days into an approximate number of ledgers. */
export function daysToLedgers(days: number): number {
  if (!Number.isFinite(days)) {
    throw new RangeError("days must be a finite number");
  }
  return Math.round(days * LEDGERS_PER_DAY);
}

/** Convert a ledger count into an approximate number of days. */
export function ledgersToDays(ledgers: number): number {
  if (!Number.isFinite(ledgers)) {
    throw new RangeError("ledgers must be a finite number");
  }
  return ledgers / LEDGERS_PER_DAY;
}

/**
 * Estimate the Unix timestamp (seconds) of a ledger.
 *
 * Without a reference, ledger 0 is treated as the Unix epoch, so the result is
 * `ledger * 5`. Pass a `LedgerReference` for real-world timestamps.
 */
export function ledgerToTimestamp(
  ledger: number,
  reference?: LedgerReference,
): number {
  if (!Number.isFinite(ledger)) {
    throw new RangeError("ledger must be a finite number");
  }
  const nowMs = reference?.nowMs ?? 0;
  const currentLedger = reference?.currentLedger ?? 0;
  return Math.floor(
    nowMs / 1000 + (ledger - currentLedger) * SECONDS_PER_LEDGER,
  );
}

/**
 * Estimate the ledger sequence at a given time.
 *
 * `date` is a `Date` or Unix milliseconds. Without a reference, ledger 0 is
 * treated as the Unix epoch.
 */
export function estimateLedgerAt(
  date: Date | number,
  reference?: LedgerReference,
): number {
  const targetMs = date instanceof Date ? date.getTime() : date;
  if (!Number.isFinite(targetMs)) {
    throw new RangeError("date must be a valid Date or Unix milliseconds");
  }
  const nowMs = reference?.nowMs ?? 0;
  const currentLedger = reference?.currentLedger ?? 0;
  return Math.round(
    currentLedger + (targetMs - nowMs) / (SECONDS_PER_LEDGER * 1000),
  );
}

/** True when `nowSecs` is at or after `deadlineSecs`. */
export function isPastDeadline(
  deadlineSecs: number,
  nowSecs: number = Math.floor(Date.now() / 1000),
): boolean {
  return nowSecs >= deadlineSecs;
}

/** Resolve after `ms` milliseconds (negative or invalid values resolve immediately). */
export function sleep(ms: number): Promise<void> {
  const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}
