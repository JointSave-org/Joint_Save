// Unit tests for the csv-export utility
import { test } from "node:test"
import assert from "node:assert"
import { buildCsv } from "./csv-export"

test("buildCsv - basic output with header and rows", () => {
  const csv = buildCsv(
    ["A", "B"],
    [
      ["x", "y"],
      ["1", "2"],
    ]
  )
  assert.strictEqual(csv, "A,B\nx,y\n1,2")
})

test("buildCsv - wraps cells containing commas in double quotes", () => {
  const csv = buildCsv(["Col"], [["hello, world"]])
  assert.strictEqual(csv, 'Col\n"hello, world"')
})

test("buildCsv - escapes embedded double-quotes (RFC 4180)", () => {
  const csv = buildCsv(["Col"], [['say "hi"']])
  assert.strictEqual(csv, 'Col\n"say ""hi"""')
})

test("buildCsv - handles null / undefined values as empty strings", () => {
  const csv = buildCsv(["A", "B"], [[null, undefined]])
  assert.strictEqual(csv, "A,B\n,")
})

test("buildCsv - empty rows returns header only", () => {
  const csv = buildCsv(["X", "Y"], [])
  assert.strictEqual(csv, "X,Y")
})

test("buildCsv - wraps cells containing newlines in double quotes", () => {
  const csv = buildCsv(["Note"], [["line1\nline2"]])
  assert.strictEqual(csv, 'Note\n"line1\nline2"')
})

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

test("consistency check - consistent when net matches recorded", () => {
  const acts = [
    { activity_type: "deposit", amount: 100 },
    { activity_type: "payout", amount: 40 },
  ]
  const { inconsistent, activityNet } = computeConsistency(acts, 60)
  assert.strictEqual(inconsistent, false)
  assert.strictEqual(activityNet, 60)
})

test("consistency check - inconsistent when net diverges from recorded", () => {
  const acts = [{ activity_type: "deposit", amount: 100 }]
  const { inconsistent } = computeConsistency(acts, 90)
  assert.strictEqual(inconsistent, true)
})

test("consistency check - tolerates floating-point differences ≤ 0.01", () => {
  const acts = [{ activity_type: "deposit", amount: 100.001 }]
  const { inconsistent } = computeConsistency(acts, 100)
  assert.strictEqual(inconsistent, false)
})

test("consistency check - non-financial activity types are ignored", () => {
  const acts = [
    { activity_type: "deposit", amount: 50 },
    { activity_type: "member_joined", amount: null },
  ]
  const { inconsistent, activityNet } = computeConsistency(acts, 50)
  assert.strictEqual(inconsistent, false)
  assert.strictEqual(activityNet, 50)
})

test("consistency check - withdraw reduces the net", () => {
  const acts = [
    { activity_type: "deposit", amount: 200 },
    { activity_type: "withdraw", amount: 80 },
  ]
  const { activityNet } = computeConsistency(acts, 120)
  assert.strictEqual(activityNet, 120)
})
