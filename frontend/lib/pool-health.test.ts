// Unit tests for the per-pool health calculation.
import { test } from "node:test"
import assert from "node:assert"
import {
  computePoolHealth,
  hasTrackRecord,
  MIN_HISTORY,
  type MemberReputation,
} from "./pool-health"

// Build a member reputation; on-time rate given in PERCENT for readability.
function member(onTimePercent: number, extra: Partial<MemberReputation> = {}): MemberReputation {
  return {
    onTimeRate: onTimePercent * 100, // percent → basis points
    totalDeposits: 1n,
    missedRounds: 0,
    poolsCompleted: 0,
    ...extra,
  }
}

test("computePoolHealth - averages member on-time rates into a percent score", () => {
  const reps = [member(100), member(80), member(60)] // avg = 80%
  const result = computePoolHealth(reps, 3)
  assert.strictEqual(result.state, "scored")
  assert.strictEqual(result.score, 80)
  assert.strictEqual(result.band, "fair")
  assert.strictEqual(result.memberCount, 3)
})

test("computePoolHealth - bands: healthy / fair / at-risk", () => {
  assert.strictEqual(computePoolHealth([member(90), member(95)], 2).band, "healthy") // 92.5 -> 93
  assert.strictEqual(computePoolHealth([member(85), member(85)], 2).band, "healthy") // exactly 85
  assert.strictEqual(computePoolHealth([member(70), member(70)], 2).band, "fair")
  assert.strictEqual(computePoolHealth([member(60), member(60)], 2).band, "fair") // exactly 60
  assert.strictEqual(computePoolHealth([member(40), member(50)], 2).band, "at-risk") // 45
})

test("computePoolHealth - rounding matches basis-point average", () => {
  // 100% and 75% -> avg 87.5% -> rounds to 88
  const result = computePoolHealth([member(100), member(75)], 2)
  assert.strictEqual(result.score, 88)
})

test("computePoolHealth - new pool with no history is neutral, not inflated", () => {
  // Members default to a perfect 100% on-time rate, but zero rounds observed.
  const reps = [member(100), member(100)]
  const result = computePoolHealth(reps, 0)
  assert.strictEqual(result.state, "new")
  assert.strictEqual(result.score, null)
  assert.strictEqual(result.band, null)
  assert.strictEqual(result.label, "New pool")
})

test("computePoolHealth - no members is neutral", () => {
  const result = computePoolHealth([], 5)
  assert.strictEqual(result.state, "new")
  assert.strictEqual(result.score, null)
})

test("computePoolHealth - exactly MIN_HISTORY rounds is enough to score", () => {
  const result = computePoolHealth([member(90)], MIN_HISTORY)
  assert.strictEqual(result.state, "scored")
  assert.strictEqual(result.score, 90)
})

test("hasTrackRecord - distinguishes real activity from the default record", () => {
  // Default record handed to unseen addresses: 100% on-time, no activity.
  const fresh: MemberReputation = {
    onTimeRate: 10000,
    totalDeposits: 0n,
    missedRounds: 0,
    poolsCompleted: 0,
  }
  assert.strictEqual(hasTrackRecord(fresh), false)

  assert.strictEqual(hasTrackRecord({ ...fresh, totalDeposits: 5n }), true)
  assert.strictEqual(hasTrackRecord({ ...fresh, missedRounds: 1 }), true)
  assert.strictEqual(hasTrackRecord({ ...fresh, poolsCompleted: 1 }), true)
})
