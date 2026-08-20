import { test } from "node:test"
import assert from "node:assert"

// -- Validation logic (mirrors route.ts) -------------------------------

const VALID_FREQUENCIES = ["daily", "weekly", "off"] as const

function validateWalletParam(wallet: string | null): string | null {
  if (!wallet) return "wallet required"
  return null
}

function validatePutBody(
  body: unknown
):
  | { wallet_address: string; email: string; frequency: string }
  | { error: string; status: number } {
  if (!body || typeof body !== "object") return { error: "wallet_address required", status: 400 }
  const { wallet_address, email, frequency } = body as Record<string, unknown>

  if (!wallet_address) return { error: "wallet_address required", status: 400 }
  if (!email || typeof email !== "string" || !email.includes("@"))
    return { error: "valid email required", status: 400 }
  if (!VALID_FREQUENCIES.includes(frequency as (typeof VALID_FREQUENCIES)[number]))
    return {
      error: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}`,
      status: 400,
    }

  return {
    wallet_address: (wallet_address as string).toLowerCase(),
    email: (email as string).trim(),
    frequency: frequency as string,
  }
}

function defaultPreferences(wallet: string) {
  return { wallet_address: wallet, email: null, frequency: "off", last_sent_at: null }
}

// -- GET wallet validation ----------------------------------------------

test("digest-preferences -- returns error when wallet is null", () => {
  assert.strictEqual(validateWalletParam(null), "wallet required")
})

test("digest-preferences -- returns error when wallet is empty string", () => {
  assert.strictEqual(validateWalletParam(""), "wallet required")
})

test("digest-preferences -- returns null for valid wallet", () => {
  assert.strictEqual(validateWalletParam("GABC123"), null)
})

test("digest-preferences -- default preferences shape when no row exists", () => {
  const defaults = defaultPreferences("gabc123")
  assert.deepStrictEqual(defaults, {
    wallet_address: "gabc123",
    email: null,
    frequency: "off",
    last_sent_at: null,
  })
})

// -- PUT body validation --------------------------------------------------

test("digest-preferences -- PUT rejects missing body", () => {
  const result = validatePutBody(null)
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

test("digest-preferences -- PUT rejects missing wallet_address", () => {
  const result = validatePutBody({ email: "a@b.com", frequency: "daily" })
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

test("digest-preferences -- PUT rejects missing email", () => {
  const result = validatePutBody({ wallet_address: "GABC", frequency: "daily" })
  assert.deepStrictEqual(result, { error: "valid email required", status: 400 })
})

test("digest-preferences -- PUT rejects malformed email", () => {
  const result = validatePutBody({
    wallet_address: "GABC",
    email: "not-an-email",
    frequency: "daily",
  })
  assert.deepStrictEqual(result, { error: "valid email required", status: 400 })
})

test("digest-preferences -- PUT rejects invalid frequency", () => {
  const result = validatePutBody({
    wallet_address: "GABC",
    email: "a@b.com",
    frequency: "hourly",
  })
  if (!("error" in result)) throw new Error("Expected error result")
  assert.strictEqual(result.status, 400)
  assert.match(result.error, /frequency must be one of/)
})

test("digest-preferences -- PUT accepts each valid frequency", () => {
  for (const frequency of VALID_FREQUENCIES) {
    const result = validatePutBody({ wallet_address: "GABC", email: "a@b.com", frequency })
    if ("error" in result) throw new Error(`Expected valid result for frequency=${frequency}`)
    assert.strictEqual(result.frequency, frequency)
  }
})

test("digest-preferences -- PUT normalizes wallet to lowercase and trims email", () => {
  const result = validatePutBody({
    wallet_address: "GABC123",
    email: "  test@example.com  ",
    frequency: "weekly",
  })
  if ("error" in result) throw new Error("Expected valid result")
  assert.strictEqual(result.wallet_address, "gabc123")
  assert.strictEqual(result.email, "test@example.com")
})
