import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"

// ---------------------------------------------------------------------------
// Server-side rate limiter (sliding window, in-memory)
// ---------------------------------------------------------------------------

const MAX_REPORTS_PER_MINUTE = 5
const WINDOW_MS = 60_000

const rateLimitStore = new Map<string, number[]>()

function isServerRateLimited(key: string): boolean {
  const now = Date.now()
  let timestamps = rateLimitStore.get(key)
  if (!timestamps) {
    timestamps = []
    rateLimitStore.set(key, timestamps)
  }
  // Prune old entries
  while (timestamps.length > 0 && timestamps[0] <= now - WINDOW_MS) {
    timestamps.shift()
  }
  if (timestamps.length >= MAX_REPORTS_PER_MINUTE) {
    return true
  }
  timestamps.push(now)
  return false
}

function resolveRateLimitKey(req: NextRequest, walletAddress?: string): string {
  if (walletAddress) return `err:wallet:${walletAddress.toLowerCase()}`
  const forwarded = req.headers.get("x-forwarded-for")
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown"
  return `err:ip:${ip}`
}

// ---------------------------------------------------------------------------
// POST /api/errors
// ---------------------------------------------------------------------------

/**
 * Receives client-side error reports from React Error Boundaries and logs
 * them to the `cron_job_logs` Supabase table with `job_name: 'client_error'`.
 *
 * Rate-limited to 5 reports per minute per wallet/IP.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, stack, componentStack, walletAddress, sectionName, url } = body as {
      message?: string
      stack?: string
      componentStack?: string
      walletAddress?: string
      sectionName?: string
      url?: string
    }

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Missing or invalid 'message' field." },
        { status: 400 },
      )
    }

    // Rate limit
    const key = resolveRateLimitKey(req, walletAddress)
    if (isServerRateLimited(key)) {
      return NextResponse.json(
        { error: "TOO_MANY_REQUESTS", message: "Error reporting rate limit exceeded." },
        { status: 429 },
      )
    }

    // Build the error_message payload stored in cron_job_logs
    const errorDetail = [
      `[client_error] ${message}`,
      sectionName ? `Section: ${sectionName}` : null,
      walletAddress ? `Wallet: ${walletAddress}` : null,
      url ? `URL: ${url}` : null,
      stack ? `\nStack:\n${stack}` : null,
      componentStack ? `\nComponent Stack:\n${componentStack}` : null,
    ]
      .filter(Boolean)
      .join("\n")

    // Insert into cron_job_logs using the admin (service-role) client so
    // RLS doesn't block the write.
    const supabase = getAdminClient()
    const { error: dbError } = await supabase.from("cron_job_logs").insert({
      job_name: "client_error",
      status: "failed",
      error_message: errorDetail.slice(0, 4096), // cap to prevent oversized payloads
    } as any)

    if (dbError) {
      console.error("[POST /api/errors] Supabase insert failed:", dbError)
      return NextResponse.json(
        { error: "DB_ERROR", message: "Failed to log error." },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected server error." },
      { status: 500 },
    )
  }
}
