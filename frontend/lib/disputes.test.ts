// Unit tests for the dispute resolution helpers (issue #208)
import { test } from "node:test"
import assert from "node:assert"
import {
  canVoteOnDispute,
  formatDisputeTimeRemaining,
  isDisputeExpired,
  isDisputeType,
  validateEvidenceUrls,
  votesNeededToResolve,
} from "./disputes"

test("votesNeededToResolve - half the pool, rounded up", () => {
  assert.strictEqual(votesNeededToResolve(5), 3)
  assert.strictEqual(votesNeededToResolve(4), 2)
  assert.strictEqual(votesNeededToResolve(1), 1)
  assert.strictEqual(votesNeededToResolve(0), 0)
  assert.strictEqual(votesNeededToResolve(NaN), 0)
})

test("isDisputeType - whitelist", () => {
  assert.ok(isDisputeType("missed_deposit"))
  assert.ok(isDisputeType("unfair_penalty"))
  assert.ok(!isDisputeType("spam"))
  assert.ok(!isDisputeType(null))
})

test("formatDisputeTimeRemaining - buckets", () => {
  const now = new Date("2026-08-24T00:00:00Z").getTime()
  const plus = (ms: number) => new Date(now + ms).toISOString()
  assert.strictEqual(formatDisputeTimeRemaining(plus(3 * 86_400_000), now), "3d 00h")
  assert.strictEqual(formatDisputeTimeRemaining(plus(5 * 3_600_000 + 30 * 60_000), now), "5h 30m")
  assert.strictEqual(formatDisputeTimeRemaining(plus(60_000 * 7), now), "7m")
  assert.strictEqual(formatDisputeTimeRemaining(plus(-1), now), "Expired")
})

test("isDisputeExpired - boundary is inclusive", () => {
  const now = new Date("2026-08-24T12:00:00Z").getTime()
  assert.strictEqual(isDisputeExpired(new Date(now).toISOString(), now), true)
  assert.strictEqual(isDisputeExpired(new Date(now + 1).toISOString(), now), false)
})

test("validateEvidenceUrls - caps at 3 and rejects non-http schemes", () => {
  const { valid, invalid } = validateEvidenceUrls([
    "https://a.example/receipt.png",
    "javascript:alert(1)",
    "http://b.example/x",
    "https://c.example/y",
    "https://d.example/z",
  ])
  // Cap of DISPUTE_MAX_EVIDENCE_URLS applies to the raw list before validation.
  assert.deepStrictEqual(valid, ["https://a.example/receipt.png", "http://b.example/x"])
  assert.deepStrictEqual(invalid, ["javascript:alert(1)"])
})

test("validateEvidenceUrls - ignores junk input", () => {
  const { valid } = validateEvidenceUrls(["  ", 42, null, "https://ok.example"])
  assert.deepStrictEqual(valid, ["https://ok.example"])
})

function dispute(filer = "GAAA", target: string | null = "GBBB") {
  return { filer_address: filer, target_address: target }
}

test("canVoteOnDispute - filer and target excluded, others allowed once", () => {
  assert.strictEqual(canVoteOnDispute("GAAA", dispute(), false), false)
  assert.strictEqual(canVoteOnDispute("gbbb", dispute(), false), false)
  assert.strictEqual(canVoteOnDispute("GCCC", dispute(), false), true)
  assert.strictEqual(canVoteOnDispute("GCCC", dispute(), true), false)
})

test("canVoteOnDispute - admin-action disputes (null target) allow all but filer", () => {
  assert.strictEqual(canVoteOnDispute("GCCC", dispute("GAAA", null), false), true)
  assert.strictEqual(canVoteOnDispute("gaaa", dispute("GAAA", null), false), false)
})
