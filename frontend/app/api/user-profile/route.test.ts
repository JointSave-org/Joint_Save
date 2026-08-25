import { test } from "node:test"
import assert from "node:assert"

// ── Validation & merge logic (mirrors route.ts) ──────────────────────────────

function validateWalletParam(wallet: string | null): string | null {
  if (!wallet) return "wallet required"
  return null
}

function validatePostBody(
  body: unknown
):
  { wallet_address: string; updates: Record<string, unknown> } | { error: string; status: number } {
  if (!body || typeof body !== "object") return { error: "wallet_address required", status: 400 }
  const { wallet_address, ...updates } = body as Record<string, unknown>
  if (!wallet_address || typeof wallet_address !== "string")
    return { error: "wallet_address required", status: 400 }
  return { wallet_address: wallet_address.toLowerCase(), updates }
}

function buildUpsertPayload(
  walletAddress: string,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    wallet_address: walletAddress,
    ...updates,
    updated_at: now,
  }
}

function mergeNotificationPreferences(
  existing: Record<string, boolean> | null,
  incoming: Record<string, boolean> | null
): Record<string, boolean> {
  const defaults: Record<string, boolean> = {
    email_on_payout: true,
    email_on_deposit: true,
    email_on_round: true,
    email_on_target: true,
  }
  return { ...defaults, ...(existing ?? {}), ...(incoming ?? {}) }
}

// ── Wallet validation tests ──────────────────────────────────────────────────

test("user-profile — returns error when wallet is null", () => {
  const error = validateWalletParam(null)
  assert.strictEqual(error, "wallet required")
})

test("user-profile — returns error when wallet is empty string", () => {
  const error = validateWalletParam("")
  assert.strictEqual(error, "wallet required")
})

test("user-profile — returns null for valid wallet", () => {
  const error = validateWalletParam("GABC123")
  assert.strictEqual(error, null)
})

// ── POST body validation ─────────────────────────────────────────────────────

test("user-profile — POST rejects missing body", () => {
  const result = validatePostBody(null)
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

test("user-profile — POST rejects empty wallet_address", () => {
  const result = validatePostBody({ wallet_address: "" })
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

test("user-profile — POST rejects non-string wallet_address", () => {
  const result = validatePostBody({ wallet_address: 12345 })
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

test("user-profile — POST normalizes wallet to lowercase and preserves updates", () => {
  const result = validatePostBody({
    wallet_address: "GABC123",
    email: "test@example.com",
    notification_preferences: { email_on_payout: false },
  })
  if ("error" in result) throw new Error("Expected valid result")
  assert.strictEqual(result.wallet_address, "gabc123")
  assert.strictEqual(result.updates.email, "test@example.com")
  assert.deepStrictEqual(result.updates.notification_preferences, { email_on_payout: false })
})

test("user-profile — POST extracts updates without wallet_address", () => {
  const result = validatePostBody({ wallet_address: "GABC", muted_pools: ["pool1"] })
  if ("error" in result) throw new Error("Expected valid result")
  assert.deepStrictEqual(result.updates, { muted_pools: ["pool1"] })
})

// ── Upsert payload construction ──────────────────────────────────────────────

test("user-profile — upsert payload includes wallet_address, updates, and updated_at", () => {
  const payload = buildUpsertPayload("gabc", { email: "a@b.com" })
  assert.strictEqual(payload.wallet_address, "gabc")
  assert.strictEqual(payload.email, "a@b.com")
  assert.ok(typeof payload.updated_at === "string")
  assert.ok(new Date(payload.updated_at as string).getTime() > 0)
})

test("user-profile — upsert payload preserves notification_preferences in updates", () => {
  const prefs = { email_on_payout: false, email_on_deposit: true }
  const payload = buildUpsertPayload("gabc", { notification_preferences: prefs })
  assert.deepStrictEqual(payload.notification_preferences, prefs)
})

// ── Notification preference merging ──────────────────────────────────────────

test("user-profile — merge prefs with no existing returns defaults", () => {
  const merged = mergeNotificationPreferences(null, null)
  assert.deepStrictEqual(merged, {
    email_on_payout: true,
    email_on_deposit: true,
    email_on_round: true,
    email_on_target: true,
  })
})

test("user-profile — merge prefs overlays incoming on top of defaults", () => {
  const incoming = { email_on_payout: false }
  const merged = mergeNotificationPreferences(null, incoming)
  assert.strictEqual(merged.email_on_payout, false)
  assert.strictEqual(merged.email_on_deposit, true)
  assert.strictEqual(merged.email_on_round, true)
  assert.strictEqual(merged.email_on_target, true)
})

test("user-profile — merge prefs overlays incoming on top of existing", () => {
  const existing = { email_on_payout: true, email_on_deposit: false }
  const incoming = { email_on_deposit: true, email_on_round: false }
  const merged = mergeNotificationPreferences(existing, incoming)
  assert.strictEqual(merged.email_on_payout, true)
  assert.strictEqual(merged.email_on_deposit, true)
  assert.strictEqual(merged.email_on_round, false)
  assert.strictEqual(merged.email_on_target, true)
})

test("user-profile — merge prefs full override", () => {
  const existing = { email_on_payout: true, email_on_deposit: true, email_on_round: true }
  const incoming = {
    email_on_payout: false,
    email_on_deposit: false,
    email_on_round: false,
    email_on_target: false,
  }
  const merged = mergeNotificationPreferences(existing, incoming)
  assert.deepStrictEqual(merged, {
    email_on_payout: false,
    email_on_deposit: false,
    email_on_round: false,
    email_on_target: false,
  })
})
