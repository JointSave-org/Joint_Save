// Pure retry/backoff and SCVal helpers for cron/auto-trigger-payouts.
//
// Kept side-effect free (no Supabase client, no network) so the cron job's
// gating rules can be unit tested in isolation. index.ts wires these into the
// HTTP handler.

export const RETRY_BACKOFF_MINUTES = [1, 5, 15];

export function computeMaxRetries(backoffMinutes: number[]): number {
  return backoffMinutes.length;
}

// deno-lint-ignore no-explicit-any
export function scValToBigInt(val: any): bigint {
  const name = val.switch().name;
  if (name === "scvU64") return BigInt(val.u64().toString());
  if (name === "scvI64") return BigInt(val.i64().toString());
  return 0n;
}

export interface RetryDecision {
  /** True when the pool has been retried too many times to try again. */
  exhausted: boolean;
  /** Backoff window in minutes for the next attempt (only when not exhausted). */
  backoffMinutes: number | null;
  /** ISO timestamp for `next_retry_at` (only when not exhausted). */
  nextRetryAt: string | null;
}

/**
 * Given the zero-based attempt count already logged (0 for a fresh pool),
 * decide whether another attempt is allowed and when. Mirrors the retry++
 * semantics of the original inline logic: an attempt increments first, then a
 * fresh pool (attemptNumber 0) gets backoffMinutes[0]; after the last retry is
 * spent the pool flips to exhausted.
 */
export function makeRetryDecision(
  attemptNumber: number,
  backoffMinutes: number[],
  now: Date,
): RetryDecision {
  const nextAttempt = attemptNumber + 1;
  if (nextAttempt > backoffMinutes.length) {
    return { exhausted: true, backoffMinutes: null, nextRetryAt: null };
  }
  const backoffMin = backoffMinutes[nextAttempt - 1];
  const nextRetryAt = new Date(now.getTime() + backoffMin * 60_000);
  return {
    exhausted: false,
    backoffMinutes: backoffMin,
    nextRetryAt: nextRetryAt.toISOString(),
  };
}

/** True when the pool is currently cooling down until next_retry_at. */
export function isInBackoff(
  nextRetryAt: string | null | undefined,
  now: Date,
): boolean {
  return Boolean(nextRetryAt && new Date(nextRetryAt) > now);
}
