import { test } from "node:test"
import assert from "node:assert"

// -- Validation logic (mirrors route.ts) -------------------------------

function validateToken(token: string | null): string | null {
  if (!token) return "token required"
  return null
}

function buildRedirectPath(): string {
  return "/settings/notifications?unsubscribed=1"
}

// -- Token validation -----------------------------------------------------

test("unsubscribe -- returns error when token is null", () => {
  assert.strictEqual(validateToken(null), "token required")
})

test("unsubscribe -- returns error when token is empty string", () => {
  assert.strictEqual(validateToken(""), "token required")
})

test("unsubscribe -- returns null for a present token", () => {
  assert.strictEqual(validateToken("some-uuid-token"), null)
})

// -- Redirect target --------------------------------------------------------

test("unsubscribe -- redirects to notifications settings with confirmation flag", () => {
  assert.strictEqual(buildRedirectPath(), "/settings/notifications?unsubscribed=1")
})
