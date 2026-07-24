/**
 * Unit tests for POST /api/errors route handler.
 *
 * Uses Node.js built-in test runner (node:test + node:assert) to match
 * existing project test conventions.
 */
import { test, mock, beforeEach, before } from "node:test"
import assert from "node:assert"

// Set env vars so Supabase client initializes without throwing
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-key"

let fetchCalls: Array<{ url: string; init: RequestInit }> = []
let shouldInsertFail = false

let originalFetch: typeof globalThis.fetch
let POST: any

before(async () => {
  originalFetch = globalThis.fetch
  
  // Import the route handler AFTER setting env vars
  const route = await import("./route")
  POST = route.POST
})

beforeEach(() => {
  fetchCalls = []
  shouldInsertFail = false

  globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init! })

    if (shouldInsertFail) {
      return new Response(JSON.stringify({ error: { message: "DB insert failed" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify([{ id: "mock-id" }]), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    })
  }) as typeof globalThis.fetch
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(body: unknown, headers?: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/errors", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


test("POST /api/errors — returns 400 when message is missing", async () => {
  const req = createRequest({ stack: "some stack" })
  // Cast to NextRequest-compatible since the route expects NextRequest
  const res = await POST(req as unknown as Parameters<typeof POST>[0])
  assert.strictEqual(res.status, 400)
  const json = await res.json()
  assert.strictEqual(json.error, "VALIDATION_ERROR")
})

test("POST /api/errors — returns 400 for empty message", async () => {
  const req = createRequest({ message: "" })
  const res = await POST(req as unknown as Parameters<typeof POST>[0])
  assert.strictEqual(res.status, 400)
})

test("POST /api/errors — returns 201 on valid payload", async () => {
  const req = createRequest({
    message: "Test component crashed",
    stack: "Error: Test\n    at Component",
    walletAddress: "GABCDEF123",
    sectionName: "Dashboard",
    url: "http://localhost:3000/dashboard",
  })
  const res = await POST(req as unknown as Parameters<typeof POST>[0])
  assert.strictEqual(res.status, 201)

  const json = await res.json()
  assert.strictEqual(json.ok, true)

  // Verify Supabase insert was called via fetch
  assert.strictEqual(fetchCalls.length, 1)
  const inserted = JSON.parse(fetchCalls[0].init.body as string)
  assert.strictEqual(inserted.job_name, "client_error")
  assert.strictEqual(inserted.status, "failed")
  assert.ok(
    (inserted.error_message as string).includes("Test component crashed"),
    "error_message should contain the original message",
  )
})

test("POST /api/errors — includes section and wallet info in error_message", async () => {
  const req = createRequest({
    message: "RPC call failed",
    walletAddress: "GXYZ789",
    sectionName: "Yield Dashboard",
  })
  const res = await POST(req as unknown as Parameters<typeof POST>[0])
  assert.strictEqual(res.status, 201)

  const inserted = JSON.parse(fetchCalls[0].init.body as string)
  const msg = inserted.error_message as string
  assert.ok(msg.includes("Section: Yield Dashboard"))
  assert.ok(msg.includes("Wallet: GXYZ789"))
})

test("POST /api/errors — returns 500 when Supabase insert fails", async () => {
  shouldInsertFail = true
  const req = createRequest({ message: "Some error" })
  const res = await POST(req as unknown as Parameters<typeof POST>[0])
  assert.strictEqual(res.status, 500)
  const json = await res.json()
  assert.strictEqual(json.error, "DB_ERROR")
})

test("POST /api/errors — rate-limits after 5 requests from same IP", async () => {
  // Send 5 requests (should all succeed)
  for (let i = 0; i < 5; i++) {
    const req = createRequest(
      { message: `Error ${i}` },
      { "x-forwarded-for": "192.168.1.100" },
    )
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    assert.strictEqual(res.status, 201, `Request ${i + 1} should succeed`)
  }

  // 6th request should be rate-limited
  const req = createRequest(
    { message: "Error 6 — should be blocked" },
    { "x-forwarded-for": "192.168.1.100" },
  )
  const res = await POST(req as unknown as Parameters<typeof POST>[0])
  assert.strictEqual(res.status, 429)
  const json = await res.json()
  assert.strictEqual(json.error, "TOO_MANY_REQUESTS")
})
