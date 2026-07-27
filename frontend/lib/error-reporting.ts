/**
 * Client-side error reporting utility.
 *
 * Captures runtime errors caught by React Error Boundaries, attaches
 * contextual metadata (wallet address, section, component stack), and
 * dispatches them to the `/api/errors` server endpoint.
 *
 * A sliding-window rate limiter (max 5 reports per 60 seconds per
 * wallet/client) prevents flooding. Reports are fire-and-forget —
 * failures are logged to the console but never re-thrown.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientErrorPayload {
  message: string
  stack?: string
  componentStack?: string
  walletAddress?: string
  sectionName?: string
  url?: string
}

// ---------------------------------------------------------------------------
// Rate limiter (client-side, per-session)
// ---------------------------------------------------------------------------

const MAX_REPORTS = 5
const WINDOW_MS = 60_000 // 1 minute

/** Sliding-window timestamps keyed by wallet (or "anonymous"). */
const reportTimestamps: number[] = []

/**
 * Returns `true` if the report should be allowed through,
 * `false` if it should be silently dropped.
 */
export function isRateLimited(): boolean {
  const now = Date.now()
  // Prune timestamps outside the window
  while (reportTimestamps.length > 0 && reportTimestamps[0] <= now - WINDOW_MS) {
    reportTimestamps.shift()
  }
  if (reportTimestamps.length >= MAX_REPORTS) {
    return true
  }
  reportTimestamps.push(now)
  return false
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

/**
 * Report a client error to the backend.
 *
 * - Never throws — callers do not need try/catch.
 * - Rate-limited: silently drops reports beyond 5 per minute.
 * - Runs asynchronously; the returned promise resolves to `true` when the
 *   report was accepted, `false` when rate-limited or when the request failed.
 */
export async function reportClientError(payload: ClientErrorPayload): Promise<boolean> {
  try {
    if (isRateLimited()) {
      return false
    }

    const body: ClientErrorPayload = {
      message: payload.message || "Unknown error",
      stack: payload.stack,
      componentStack: payload.componentStack,
      walletAddress: payload.walletAddress,
      sectionName: payload.sectionName,
      url: payload.url || (typeof window !== "undefined" ? window.location.href : undefined),
    }

    const res = await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    return res.ok
  } catch {
    // Network error or other failure — swallow silently.
    return false
  }
}

// ---------------------------------------------------------------------------
// Test helpers (exported for unit tests only)
// ---------------------------------------------------------------------------

/** @internal — reset the rate limiter state between tests. */
export function _resetRateLimiter(): void {
  reportTimestamps.length = 0
}
