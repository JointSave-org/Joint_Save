import { JointSaveError } from "../errors";
import { sleep } from "../utils/time";

export interface RpcRetryOptions {
  /** Extra attempts after the first failure. Default: `3`. */
  retries?: number;
  /** Base backoff in milliseconds. Default: `200`. */
  baseDelayMs?: number;
  /** Backoff cap in milliseconds. Default: `5000`. */
  maxDelayMs?: number;
  /** Add bounded jitter to each delay. Default: `true`. */
  jitter?: boolean;
  /** Called before each retry with the 1-based retry number and delay. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DETERMINISTIC_PATTERNS = [
  /txTooLate/i,
  /txBadAuth/i,
  /txMalformed/i,
  /txNoAccount/i,
  /txMissingOperation/i,
  /txBadSponsorship/i,
  /insufficient (balance|funds)/i,
  /would fail/i,
  /user (rejected|denied|cancel)/i,
  /unauthori[sz]ed/i,
  /not authorized/i,
  /invalid/i,
  /not found/i,
  /rejected/i,
  /contract error/i,
  /Error\(Contract/i,
  /host error/i,
  /panicked/i,
  /assert/i,
  /simulation failed/i,
];

const TRANSIENT_PATTERNS = [
  /txBadSeq/i,
  /txInsufficientFee/i,
  /txInternalError/i,
  /TRY_AGAIN_LATER/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /fetch failed/i,
  /network (error|request|failure)/i,
  /timeout|timed out/i,
  /rate limit|too many requests/i,
  /\b429\b/,
  /\b50[234]\b/,
  /service unavailable/i,
  /temporarily unavailable/i,
  /connection (reset|closed|refused)/i,
  /no response/i,
];

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
  }
  return undefined;
}

function matches(patterns: RegExp[], text: string | undefined): boolean {
  return text !== undefined && patterns.some((pattern) => pattern.test(text));
}

function isTransientText(text: string | undefined): boolean {
  if (matches(DETERMINISTIC_PATTERNS, text)) return false;
  return matches(TRANSIENT_PATTERNS, text);
}

/**
 * True when retrying the same operation could succeed.
 *
 * Deterministic failures (validation, authorization, insufficient funds,
 * contract assertion failures) return `false`. Only network, rate-limit, and
 * explicitly retryable Stellar result codes return `true`.
 *
 * This helper does **not** decide whether a transaction is safe to resubmit.
 * Pair it with {@link mayHaveReachedServer} before retrying a send.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof JointSaveError) {
    switch (error.code) {
      case "INVALID_ARGUMENT":
      case "UNSUPPORTED":
      case "MISSING_CONTRACT":
      case "SIGN_FAILED":
      case "DECODE_FAILED":
        return false;
      case "ACCOUNT_ERROR":
        return (
          isTransientText(error.message) || isTransientText(messageOf(error.cause))
        );
      case "TIMEOUT":
        return true;
      case "SIMULATION_FAILED":
        return (
          isTransientText(error.message) || isTransientText(messageOf(error.cause))
        );
      case "RPC_ERROR":
      case "SUBMIT_FAILED": {
        const causeText = messageOf(error.cause);
        if (isTransientText(error.message) || isTransientText(causeText)) return true;
        if (
          matches(DETERMINISTIC_PATTERNS, error.message) ||
          matches(DETERMINISTIC_PATTERNS, causeText)
        ) {
          return false;
        }
        return true;
      }
    }
  }
  return isTransientText(messageOf(error));
}

/**
 * True when a failed send may already have reached the RPC or ledger.
 *
 * When this is true, do not blindly resubmit: call
 * {@link lookupTransaction} (or `client.lookupTransaction`) first.
 */
export function mayHaveReachedServer(error: unknown): boolean {
  if (error instanceof JointSaveError && error.code === "TIMEOUT") return true;

  const text = `${messageOf(error) ?? ""} ${messageOf((error as { cause?: unknown })?.cause) ?? ""}`.trim();
  if (!text) return false;

  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|dns/i.test(text)) return false;
  if (/txTooLate|txBadAuth|txBadSeq|txInsufficientFee|txMalformed|txNoAccount/i.test(text)) {
    return false;
  }
  if (/user (rejected|denied|cancel)|sign(ing)? (failed|rejected)/i.test(text)) return false;
  if (/TRY_AGAIN_LATER/i.test(text)) return false;

  return /timeout|timed out|ECONNRESET|EPIPE|socket hang up|fetch failed|network|connection (reset|closed)|no response/i.test(
    text
  );
}

function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  if (!jitter) return exponential;
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

/**
 * Retry an idempotent RPC operation with exponential backoff and jitter.
 *
 * Only errors for which {@link isRetryable} is true are retried; the original
 * error is rethrown once attempts are exhausted.
 *
 * Do not wrap a non-idempotent send without checking
 * {@link mayHaveReachedServer} and looking the transaction up first.
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  options: RpcRetryOptions = {}
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 200);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 5_000);
  const jitter = options.jitter ?? true;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) break;

      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
