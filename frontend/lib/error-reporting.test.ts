/**
 * Unit tests for the client-side error reporting utility.
 *
 * Uses Node.js built-in test runner (node:test + node:assert) to match the
 * existing test conventions in this project.
 */
import { test, beforeEach, mock } from "node:test"
import assert from "node:assert"
import { isRateLimited, _resetRateLimiter } from "./error-reporting"

// ---------------------------------------------------------------------------
// Rate limiter tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetRateLimiter()
})

test("isRateLimited — allows up to 5 reports within the window", () => {
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(isRateLimited(), false, `Report ${i + 1} should be allowed`)
  }
})

test("isRateLimited — blocks the 6th report within the window", () => {
  for (let i = 0; i < 5; i++) {
    isRateLimited()
  }
  assert.strictEqual(isRateLimited(), true, "6th report should be rate-limited")
})

test("isRateLimited — resets after _resetRateLimiter is called", () => {
  for (let i = 0; i < 5; i++) {
    isRateLimited()
  }
  assert.strictEqual(isRateLimited(), true)
  _resetRateLimiter()
  assert.strictEqual(isRateLimited(), false, "Should allow reports after reset")
})

// ---------------------------------------------------------------------------
// reportClientError tests (using fetch mock)
// ---------------------------------------------------------------------------

test("reportClientError — sends correct payload to /api/errors", async () => {
  _resetRateLimiter()

  const fetchCalls: { url: string; init: RequestInit }[] = []

  // Mock global fetch
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init! })
    return new Response(JSON.stringify({ ok: true }), { status: 201 })
  }) as typeof globalThis.fetch

  try {
    // Dynamic import to pick up the mocked fetch
    // Since the module is already loaded, we call reportClientError directly
    const { reportClientError } = await import("./error-reporting")
    const result = await reportClientError({
      message: "Test error",
      stack: "Error: Test error\n    at Test",
      walletAddress: "GABCD1234",
      sectionName: "Dashboard",
    })

    assert.strictEqual(result, true, "Should return true on successful report")
    assert.strictEqual(fetchCalls.length, 1)
    assert.strictEqual(fetchCalls[0].url, "/api/errors")

    const body = JSON.parse(fetchCalls[0].init.body as string)
    assert.strictEqual(body.message, "Test error")
    assert.strictEqual(body.stack, "Error: Test error\n    at Test")
    assert.strictEqual(body.walletAddress, "GABCD1234")
    assert.strictEqual(body.sectionName, "Dashboard")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("reportClientError — returns false when rate-limited", async () => {
  _resetRateLimiter()

  const originalFetch = globalThis.fetch
  globalThis.fetch = mock.fn(async () => {
    return new Response(JSON.stringify({ ok: true }), { status: 201 })
  }) as typeof globalThis.fetch

  try {
    const { reportClientError } = await import("./error-reporting")

    // Exhaust the rate limit
    for (let i = 0; i < 5; i++) {
      await reportClientError({ message: `Error ${i}` })
    }

    const result = await reportClientError({ message: "Should be blocked" })
    assert.strictEqual(result, false, "Should return false when rate-limited")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("reportClientError — returns false on network error", async () => {
  _resetRateLimiter()

  const originalFetch = globalThis.fetch
  globalThis.fetch = mock.fn(async () => {
    throw new Error("Network failure")
  }) as typeof globalThis.fetch

  try {
    const { reportClientError } = await import("./error-reporting")
    const result = await reportClientError({ message: "Test error" })
    assert.strictEqual(result, false, "Should return false on network error")
  } finally {
    globalThis.fetch = originalFetch
  }
})
