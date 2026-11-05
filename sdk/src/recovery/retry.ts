/**
 * Retry classification and exponential backoff for Soroban RPC operations.
 *
 * Implements requirement #277:
 * - isRetryable(error): classify transient RPC/network errors vs deterministic failures
 * - withRpcRetry(fn, options): exponential backoff with jitter, stops after max retries
 * - mayHaveReachedServer(error): true for timeouts/ambiguous network errors
 */

export interface RpcRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  onRetry?: ((attempt: number, error: unknown, delayMs: number) => void) | undefined;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 5000;

const TRANSIENT_MESSAGE_PATTERNS: RegExp[] = [
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /429/,
  /503/,
  /504/,
  /502/,
  /gateway\s*timeout/i,
  /service\s*unavailable/i,
  /timeout/i,
  /etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /network\s*error/i,
  /fetch\s*failed/i,
  /try_again_later/i,
  /txbadseq/i,
  /bad\s*sequence/i,
  /bad_seq/i,
];

const DETERMINISTIC_MESSAGE_PATTERNS: RegExp[] = [
  /insufficient\s*balance/i,
  /unauthorized/i,
  /invalid\s*argument/i,
  /missing\s*contract/i,
  /contract\s*error/i,
  /txfailed/i,
  /txbadauth/i,
  /txinternalerror/i,
  /txinsufficientfee/i,
];

/**
 * Classifies whether an RPC or network failure is transient and safe to retry.
 */
export function isRetryable(error: unknown): boolean {
  if (!error) return false;

  const msg = error instanceof Error ? error.message : String(error);
  const status = typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : null;

  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  if (status && status >= 400 && status < 500) {
    return false;
  }

  for (const pattern of DETERMINISTIC_MESSAGE_PATTERNS) {
    if (pattern.test(msg)) return false;
  }

  for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
    if (pattern.test(msg)) return true;
  }

  return false;
}

/**
 * Indicates whether a failed RPC call may have reached the server,
 * meaning a non-idempotent operation (like sendTransaction) must NOT be blindly resent.
 */
export function mayHaveReachedServer(error: unknown): boolean {
  if (!error) return false;

  const msg = error instanceof Error ? error.message : String(error);
  const status = typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : null;

  if (status === 504 || status === 502 || status === 503) {
    return true;
  }

  return (
    /timeout/i.test(msg) ||
    /econnreset/i.test(msg) ||
    /network\s*timeout/i.test(msg) ||
    /fetch\s*failed/i.test(msg) ||
    /aborted/i.test(msg)
  );
}

/**
 * Executes an async operation with exponential backoff and optional jitter.
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  options: RpcRetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const useJitter = options.jitter ?? true;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !isRetryable(error)) {
        throw error;
      }

      const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const delayMs = useJitter
        ? Math.floor(exp * (0.5 + Math.random() * 0.5))
        : exp;

      if (options.onRetry) {
        try {
          options.onRetry(attempt, error, delayMs);
        } catch {
          // Callback failure must not halt retry loop
        }
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
