import { test } from "node:test"
import assert from "node:assert"

// ── Per-token net-saved calculation (mirrors the route's computation) ────────

interface Activity {
  pool_id: string
  activity_type: string
  amount: number | null
}

function computeTotalSavedByToken(
  activities: Activity[],
  tokenSymbolByPool: Map<string, string>
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const a of activities) {
    const symbol = tokenSymbolByPool.get(a.pool_id) || "XLM"
    const signed =
      a.activity_type === "deposit"
        ? a.amount || 0
        : a.activity_type === "withdraw" || a.activity_type === "payout"
          ? -(a.amount || 0)
          : 0
    if (signed === 0) continue
    totals[symbol] = (totals[symbol] || 0) + signed
  }
  for (const symbol of Object.keys(totals)) {
    totals[symbol] = Math.max(0, totals[symbol])
  }
  return totals
}

test("computeTotalSavedByToken — splits deposits by the pool's token symbol", () => {
  const pools = new Map([
    ["pool-xlm", "XLM"],
    ["pool-usdc", "USDC"],
  ])
  const activities: Activity[] = [
    { pool_id: "pool-xlm", activity_type: "deposit", amount: 100 },
    { pool_id: "pool-usdc", activity_type: "deposit", amount: 250 },
  ]
  const totals = computeTotalSavedByToken(activities, pools)
  assert.deepStrictEqual(totals, { XLM: 100, USDC: 250 })
})

test("computeTotalSavedByToken — nets withdrawals and payouts against deposits", () => {
  const pools = new Map([["pool-usdc", "USDC"]])
  const activities: Activity[] = [
    { pool_id: "pool-usdc", activity_type: "deposit", amount: 500 },
    { pool_id: "pool-usdc", activity_type: "withdraw", amount: 200 },
  ]
  const totals = computeTotalSavedByToken(activities, pools)
  assert.deepStrictEqual(totals, { USDC: 300 })
})

test("computeTotalSavedByToken — clamps a token's total at 0, never negative", () => {
  const pools = new Map([["pool-usdc", "USDC"]])
  const activities: Activity[] = [
    { pool_id: "pool-usdc", activity_type: "deposit", amount: 50 },
    { pool_id: "pool-usdc", activity_type: "payout", amount: 200 },
  ]
  const totals = computeTotalSavedByToken(activities, pools)
  assert.deepStrictEqual(totals, { USDC: 0 })
})

test("computeTotalSavedByToken — defaults to XLM when a pool has no token symbol on record", () => {
  const pools = new Map<string, string>()
  const activities: Activity[] = [{ pool_id: "legacy-pool", activity_type: "deposit", amount: 40 }]
  const totals = computeTotalSavedByToken(activities, pools)
  assert.deepStrictEqual(totals, { XLM: 40 })
})

test("computeTotalSavedByToken — ignores non-financial activity types", () => {
  const pools = new Map([["pool-usdc", "USDC"]])
  const activities: Activity[] = [
    { pool_id: "pool-usdc", activity_type: "member_added", amount: null },
    { pool_id: "pool-usdc", activity_type: "deposit", amount: 10 },
  ]
  const totals = computeTotalSavedByToken(activities, pools)
  assert.deepStrictEqual(totals, { USDC: 10 })
})
