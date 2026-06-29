/**
 * Lightweight in-memory sliding-window rate limiter for Next.js API routes.
 *
 * No Redis or external dependency — uses a Map with per-key request timestamps.
 * Suitable for a single-instance Next.js deployment.
 *
 * Usage:
 *   import { readLimiter, writeLimiter } from '@/lib/rate-limit'
 *
 *   const limited = readLimiter(req)
 *   if (limited) return limited   // NextResponse 429
 */

import { NextRequest, NextResponse } from "next/server"

interface WindowEntry {
  timestamps: number[]
}

// One shared store per process lifetime (survives across requests in the same instance)
const store = new Map<string, WindowEntry>()

// Prune entries older than the window to prevent unbounded memory growth.
// Called on every request — cheap because we only iterate the key's own timestamps.
function prune(entry: WindowEntry, windowMs: number, now: number): void {
  const cutoff = now - windowMs
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
}

/**
 * Resolve the rate-limit key from a request.
 * Prefers the wallet address supplied in query params or request body headers,
 * falls back to a best-effort IP derived from standard proxy headers.
 *
 * NOTE: X-Forwarded-For is trusted here only as a diagnostic fallback.
 * A proper deployment should configure `trustProxy` at the infrastructure
 * level; for a single-instance Next.js app behind Vercel/Render this is fine.
 */
function resolveKey(req: NextRequest, prefix: string): string {
  // Wallet address is the preferred key — unforgeable at the application layer
  // because it is validated on-chain before any write action succeeds.
  const wallet = req.nextUrl.searchParams.get("wallet") || req.headers.get("x-wallet-address")
  if (wallet) return `${prefix}:wallet:${wallet.toLowerCase()}`

  // IP fallback
  const forwarded = req.headers.get("x-forwarded-for")
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown"
  return `${prefix}:ip:${ip}`
}

function applyLimit(
  req: NextRequest,
  prefix: string,
  max: number,
  windowMs: number
): NextResponse | null {
  const now = Date.now()
  const key = resolveKey(req, prefix)

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  prune(entry, windowMs, now)

  if (entry.timestamps.length >= max) {
    const oldest = entry.timestamps[0]
    const retryAfterMs = windowMs - (now - oldest)
    const retryAfterSec = Math.ceil(retryAfterMs / 1000)

    return NextResponse.json(
      {
        error: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded. Please slow down.",
        retryAfterSec,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil((oldest + windowMs) / 1000)),
        },
      }
    )
  }

  entry.timestamps.push(now)
  return null
}

const WINDOW_MS = 60_000 // 1 minute

/**
 * Read limiter — 30 requests per minute per key.
 * For GET endpoints: /api/pools, /api/analytics, /api/notifications, /api/user-profile.
 *
 * Reasoning: a user navigating the dashboard might refresh several pages,
 * open pool details, check analytics — 30/min comfortably covers normal
 * browsing (roughly one request every 2 seconds) while blocking scrapers.
 */
export function readLimiter(req: NextRequest): NextResponse | null {
  return applyLimit(req, "read", 30, WINDOW_MS)
}

/**
 * Write limiter — 10 requests per minute per key.
 * For POST/PATCH/PUT/DELETE endpoints: pool creation, profile updates, join requests.
 *
 * Reasoning: legitimate writes are rare (a user creates a pool once, submits a
 * join request once). 10/min is generous for normal usage and blocks replay
 * attacks or accidental double-submits from a buggy client.
 */
export function writeLimiter(req: NextRequest): NextResponse | null {
  return applyLimit(req, "write", 10, WINDOW_MS)
}
