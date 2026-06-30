import { test } from "node:test"
import assert from "node:assert"

// ── Authorization logic (mirrors the server-side check in the route) ─────────

function isAuthorized(callerAddress: string, creatorAddress: string): boolean {
  return callerAddress.toLowerCase() === creatorAddress.toLowerCase()
}

function getAuthErrorCode(
  poolId: string | null,
  callerAddress: string | null,
  pool: { creator_address: string } | null
): number | null {
  if (!poolId) return 400
  if (!callerAddress) return 400
  if (!pool) return 404
  if (!isAuthorized(callerAddress, pool.creator_address)) return 403
  return null // authorized
}

// ── Consistency-check logic (mirrors the API route calculation) ──────────────

function computeConsistency(
  activities: { activity_type: string; amount: number | null }[],
  recorded: number
): { inconsistent: boolean; activityNet: number } {
  const activityNet = activities.reduce((sum, r) => {
    const amt = r.amount ?? 0
    const t = r.activity_type.toLowerCase()
    if (t === "deposit") return sum + amt
    if (t === "withdraw" || t === "payout") return sum - amt
    return sum
  }, 0)
  return { inconsistent: Math.abs(activityNet - recorded) > 0.01, activityNet }
}

// ── Authorization tests ─────────────────────────────────────────────────────

test("authorization — returns 400 when poolId is missing", () => {
  const code = getAuthErrorCode(null, "GABC", { creator_address: "GCREATOR" })
  assert.strictEqual(code, 400)
})

test("authorization — returns 400 when callerAddress is missing", () => {
  const code = getAuthErrorCode("p1", null, { creator_address: "GCREATOR" })
  assert.strictEqual(code, 400)
})

test("authorization — returns 404 when pool is not found", () => {
  const code = getAuthErrorCode("p1", "GABC", null)
  assert.strictEqual(code, 404)
})

test("authorization — returns 403 when caller is not the pool creator", () => {
  const code = getAuthErrorCode("p1", "GINTRUDER", { creator_address: "GCREATOR" })
  assert.strictEqual(code, 403)
})

test("authorization — returns null (authorized) when caller matches creator", () => {
  const code = getAuthErrorCode("p1", "GCREATOR", { creator_address: "GCREATOR" })
  assert.strictEqual(code, null)
})

test("authorization — case-insensitive address comparison", () => {
  assert.strictEqual(isAuthorized("gcreator", "GCREATOR"), true)
  assert.strictEqual(isAuthorized("GCREATOR", "gcreator"), true)
  assert.strictEqual(isAuthorized("gcreator123", "GCREATOR456"), false)
})

// ── Consistency-check tests ──────────────────────────────────────────────────

test("consistency check — consistent when net matches recorded", () => {
  const acts = [
    { activity_type: "deposit", amount: 100 },
    { activity_type: "payout", amount: 40 },
  ]
  const { inconsistent, activityNet } = computeConsistency(acts, 60)
  assert.strictEqual(inconsistent, false)
  assert.strictEqual(activityNet, 60)
})

test("consistency check — inconsistent when net diverges from recorded", () => {
  const acts = [{ activity_type: "deposit", amount: 100 }]
  const { inconsistent } = computeConsistency(acts, 90)
  assert.strictEqual(inconsistent, true)
})

test("consistency check — tolerates floating-point differences <= 0.01", () => {
  const acts = [{ activity_type: "deposit", amount: 100.001 }]
  const { inconsistent } = computeConsistency(acts, 100)
  assert.strictEqual(inconsistent, false)
})

test("consistency check — non-financial activity types are ignored", () => {
  const acts = [
    { activity_type: "deposit", amount: 50 },
    { activity_type: "member_joined", amount: null },
  ]
  const { inconsistent, activityNet } = computeConsistency(acts, 50)
  assert.strictEqual(inconsistent, false)
  assert.strictEqual(activityNet, 50)
})

test("consistency check — withdraw reduces the net", () => {
  const acts = [
    { activity_type: "deposit", amount: 200 },
    { activity_type: "withdraw", amount: 80 },
  ]
  const { activityNet } = computeConsistency(acts, 120)
  assert.strictEqual(activityNet, 120)
})
