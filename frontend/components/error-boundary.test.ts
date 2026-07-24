/**
 * Unit tests for the ErrorBoundary class component.
 *
 * Tests class-level logic directly — lifecycle methods, state transitions, and
 * error-reporter integration — without a DOM renderer. Follows the project's
 * existing test conventions: node:test + node:assert, run via `tsx --test`.
 *
 * Strategy
 * --------
 * We mock globalThis.fetch (the same technique used in route.test.ts and
 * error-reporting.test.ts) to intercept the reportClientError call that
 * ErrorBoundary fires inside componentDidCatch. We then dynamically import
 * the component inside `before()` so the mock is in place before any module
 * code runs.
 *
 * To make setState testable without a mounted React tree we override it on
 * each instance to be synchronous, allowing immediate state inspection.
 */

import { test, describe, before, beforeEach, mock } from "node:test"
import assert from "node:assert"

// ---------------------------------------------------------------------------
// Types (declared before before() so tests can reference them)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ErrorBoundary: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SectionErrorBoundary: any

let fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = []

// ---------------------------------------------------------------------------
// Setup — runs once before all tests
// ---------------------------------------------------------------------------

before(async () => {
  // Intercept outbound fetch so reportClientError never hits the network.
  // This mirrors the technique in lib/error-reporting.test.ts.
  globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    fetchCalls.push({ url: String(url), body })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof globalThis.fetch

  // Reset the client-side rate limiter before each test so prior fetch mocks
  // (from error-reporting.test.ts running in the same tsx process) don't bleed in.
  const { _resetRateLimiter } = await import("../lib/error-reporting")
  _resetRateLimiter()

  // Dynamic import ensures our fetch mock is already in place when the module
  // (and its transitive imports) first execute.
  const mod = await import("./error-boundary")
  ErrorBoundary = mod.ErrorBoundary
  SectionErrorBoundary = mod.SectionErrorBoundary
})

beforeEach(() => {
  fetchCalls = []
  // Reset the rate limiter so each test starts with a clean slate.
  // We re-import synchronously because the module is already cached.
  import("../lib/error-reporting").then(({ _resetRateLimiter }) => _resetRateLimiter())
})

// ---------------------------------------------------------------------------
// Helper — create an ErrorBoundary instance with a synchronous setState
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeInstance(props: Record<string, unknown> = {}): any {
  const instance = new ErrorBoundary({ children: null, ...props })
  // React.Component.setState is async when mounted; here the component is
  // never mounted, so we replace it with a synchronous version for testing.
  instance.setState = function (
    update: ((prev: Record<string, unknown>) => Record<string, unknown>) | Record<string, unknown>
  ) {
    if (typeof update === "function") {
      this.state = { ...this.state, ...update(this.state) }
    } else {
      this.state = { ...this.state, ...update }
    }
  }
  return instance
}

// ---------------------------------------------------------------------------
// Tests: ErrorBoundary
// ---------------------------------------------------------------------------

describe("ErrorBoundary", () => {
  // ── Static lifecycle ───────────────────────────────────────────────────────

  test("getDerivedStateFromError — sets hasError: true and stores the error", () => {
    const error = new Error("render boom")
    const state = ErrorBoundary.getDerivedStateFromError(error)
    assert.strictEqual(state.hasError, true)
    assert.strictEqual(state.error, error)
  })

  // ── Constructor / initial state ────────────────────────────────────────────

  test("constructor — initialises with hasError: false, error: null, showDetails: false", () => {
    const instance = makeInstance()
    assert.strictEqual(instance.state.hasError, false)
    assert.strictEqual(instance.state.error, null)
    assert.strictEqual(instance.state.showDetails, false)
  })

  // ── componentDidCatch ──────────────────────────────────────────────────────

  test("componentDidCatch — forwards error details to reportClientError", async () => {
    const instance = makeInstance({ sectionName: "Dashboard", walletAddress: "GABC123" })
    const error = new Error("test crash")
    error.stack = "Error: test crash\n    at Dashboard"

    instance.componentDidCatch(error, { componentStack: "\n    at Dashboard" })

    // reportClientError is fire-and-forget; drain the microtask queue.
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.strictEqual(fetchCalls.length, 1, "fetch should be called once")
    const { url, body } = fetchCalls[0]
    assert.strictEqual(url, "/api/errors")
    assert.strictEqual(body.message, "test crash")
    assert.strictEqual(body.stack, error.stack)
    assert.strictEqual(body.componentStack, "\n    at Dashboard")
    assert.strictEqual(body.walletAddress, "GABC123")
    assert.strictEqual(body.sectionName, "Dashboard")
  })

  test("componentDidCatch — works when optional props are omitted", async () => {
    const instance = makeInstance() // no sectionName, no walletAddress
    const error = new Error("anonymous error")

    instance.componentDidCatch(error, { componentStack: null })

    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.strictEqual(fetchCalls.length, 1)
    const { body } = fetchCalls[0]
    assert.strictEqual(body.message, "anonymous error")
    // componentStack: null → coerced to undefined inside the component
    assert.strictEqual(body.componentStack, undefined)
    assert.strictEqual(body.walletAddress, undefined)
    assert.strictEqual(body.sectionName, undefined)
  })

  // ── handleReset ────────────────────────────────────────────────────────────

  test("handleReset — resets state to initial values", () => {
    const instance = makeInstance()
    instance.state = { hasError: true, error: new Error("x"), showDetails: true }

    instance.handleReset()

    assert.strictEqual(instance.state.hasError, false)
    assert.strictEqual(instance.state.error, null)
    assert.strictEqual(instance.state.showDetails, false)
  })

  test("handleReset — invokes the onReset callback when provided", () => {
    const onReset = mock.fn()
    const instance = makeInstance({ onReset })
    instance.state = { hasError: true, error: new Error("x"), showDetails: false }

    instance.handleReset()

    assert.strictEqual(onReset.mock.calls.length, 1)
  })

  test("handleReset — does not throw when onReset is not provided", () => {
    const instance = makeInstance()
    assert.doesNotThrow(() => instance.handleReset())
  })

  // ── toggleDetails ──────────────────────────────────────────────────────────

  test("toggleDetails — flips showDetails false → true → false", () => {
    const instance = makeInstance()
    assert.strictEqual(instance.state.showDetails, false)

    instance.toggleDetails()
    assert.strictEqual(instance.state.showDetails, true)

    instance.toggleDetails()
    assert.strictEqual(instance.state.showDetails, false)
  })
})

// ---------------------------------------------------------------------------
// Tests: SectionErrorBoundary
// ---------------------------------------------------------------------------

describe("SectionErrorBoundary", () => {
  test("is exported as a function (functional component wrapper)", () => {
    assert.strictEqual(typeof SectionErrorBoundary, "function")
  })
})
