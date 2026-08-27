// Unit tests for the pure batch-deposit logic: selection totals, batching,
// urgency banding and progress derivation.
import { test } from "node:test"
import assert from "node:assert"
import {
  MAX_TX_PER_BATCH,
  chunk,
  computeProgress,
  depositUrgency,
  describeSplit,
  formatBatchSummary,
  isTerminal,
  sortByUrgency,
  summarizeSelection,
  type BatchDepositItem,
  type BatchDepositPool,
  type BatchItemStatus,
} from "./batch-deposit"

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function pool(overrides: Partial<BatchDepositPool> = {}): BatchDepositPool {
  return {
    id: "pool-1",
    name: "Pool One",
    contractAddress: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
    amount: 50,
    tokenSymbol: "XLM",
    round: 0,
    deadline: NOW + DAY,
    ...overrides,
  }
}

function item(status: BatchItemStatus, id = "pool-1"): BatchDepositItem {
  return { pool: pool({ id }), status }
}

// ── Selection totals ────────────────────────────────────────────────────────

test("summarizeSelection - totals only the selected pools, grouped by token", () => {
  const pools = [
    pool({ id: "a", amount: 50 }),
    pool({ id: "b", amount: 100 }),
    pool({ id: "c", amount: 25, tokenSymbol: "USDC" }),
  ]

  const all = summarizeSelection(pools, ["a", "b", "c"])
  assert.strictEqual(all.count, 3)
  assert.deepStrictEqual(all.totalsBySymbol, { XLM: 150, USDC: 25 })

  const partial = summarizeSelection(pools, ["b"])
  assert.strictEqual(partial.count, 1)
  assert.deepStrictEqual(partial.totalsBySymbol, { XLM: 100 })

  const none = summarizeSelection(pools, [])
  assert.strictEqual(none.count, 0)
  assert.deepStrictEqual(none.totalsBySymbol, {})
})

test("summarizeSelection - ignores selected ids that are not in the pool list", () => {
  const summary = summarizeSelection([pool({ id: "a", amount: 10 })], ["a", "ghost"])
  assert.strictEqual(summary.count, 1)
  assert.deepStrictEqual(summary.totalsBySymbol, { XLM: 10 })
})

test("formatBatchSummary - matches the copy in the issue", () => {
  const pools = [
    pool({ id: "a", amount: 50 }),
    pool({ id: "b", amount: 50 }),
    pool({ id: "c", amount: 50 }),
  ]
  assert.strictEqual(
    formatBatchSummary(summarizeSelection(pools, ["a", "b", "c"])),
    "Depositing to 3 pools: 150 XLM total"
  )
})

test("formatBatchSummary - singular, empty and mixed-token forms", () => {
  assert.strictEqual(
    formatBatchSummary(summarizeSelection([pool({ id: "a", amount: 25 })], ["a"])),
    "Depositing to 1 pool: 25 XLM total"
  )
  assert.strictEqual(formatBatchSummary(summarizeSelection([], [])), "No pools selected")
  assert.strictEqual(
    formatBatchSummary(
      summarizeSelection(
        [pool({ id: "a", amount: 100 }), pool({ id: "b", amount: 50, tokenSymbol: "USDC" })],
        ["a", "b"]
      )
    ),
    "Depositing to 2 pools: 50 USDC + 100 XLM total"
  )
})

test("formatBatchSummary - trims float noise from summed amounts", () => {
  const pools = [pool({ id: "a", amount: 0.1 }), pool({ id: "b", amount: 0.2 })]
  assert.strictEqual(
    formatBatchSummary(summarizeSelection(pools, ["a", "b"])),
    "Depositing to 2 pools: 0.3 XLM total"
  )
})

// ── Batching ────────────────────────────────────────────────────────────────

test("chunk - splits at MAX_TX_PER_BATCH by default", () => {
  assert.strictEqual(MAX_TX_PER_BATCH, 15)

  const fifteen = Array.from({ length: 15 }, (_, i) => i)
  assert.strictEqual(chunk(fifteen).length, 1, "15 fits in one batch")

  const sixteen = Array.from({ length: 16 }, (_, i) => i)
  const batches = chunk(sixteen)
  assert.strictEqual(batches.length, 2, "16 splits into two")
  assert.strictEqual(batches[0].length, 15)
  assert.strictEqual(batches[1].length, 1)

  const thirtyOne = Array.from({ length: 31 }, (_, i) => i)
  assert.deepStrictEqual(
    chunk(thirtyOne).map((b) => b.length),
    [15, 15, 1]
  )
})

test("chunk - empty input yields no batches, and preserves order", () => {
  assert.deepStrictEqual(chunk([]), [])
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})

test("chunk - rejects a nonsensical batch size instead of looping forever", () => {
  assert.throws(() => chunk([1, 2, 3], 0), /at least 1/)
})

test("describeSplit - only announces a split when there is more than one batch", () => {
  assert.strictEqual(describeSplit(0), null)
  assert.strictEqual(describeSplit(1), null)
  assert.strictEqual(describeSplit(2), "Split into 2 batches due to transaction size limits")
})

// ── Urgency ─────────────────────────────────────────────────────────────────

test("depositUrgency - bands a deadline into overdue / urgent / soon / normal", () => {
  assert.strictEqual(depositUrgency(NOW - HOUR, NOW).level, "overdue")
  assert.strictEqual(depositUrgency(NOW, NOW).level, "overdue")
  assert.strictEqual(depositUrgency(NOW + 3 * HOUR, NOW).level, "urgent")
  assert.strictEqual(depositUrgency(NOW + 2 * DAY, NOW).level, "soon")
  assert.strictEqual(depositUrgency(NOW + 10 * DAY, NOW).level, "normal")
})

test("depositUrgency - boundaries fall on the safer side", () => {
  // Exactly 24h away is no longer "urgent"; exactly 72h is no longer "soon".
  assert.strictEqual(depositUrgency(NOW + DAY, NOW).level, "soon")
  assert.strictEqual(depositUrgency(NOW + 3 * DAY, NOW).level, "normal")
})

test("depositUrgency - missing or nonsensical deadlines degrade to unknown", () => {
  assert.strictEqual(depositUrgency(null, NOW).level, "unknown")
  assert.strictEqual(depositUrgency(0, NOW).level, "unknown")
  assert.strictEqual(depositUrgency(Number.NaN, NOW).level, "unknown")
  assert.strictEqual(depositUrgency(null, NOW).label, "No deadline")
})

test("depositUrgency - labels count down in the right unit", () => {
  assert.strictEqual(depositUrgency(NOW - 1, NOW).label, "Overdue")
  assert.strictEqual(depositUrgency(NOW + 3 * HOUR, NOW).label, "Due in 3h")
  assert.strictEqual(depositUrgency(NOW + 2 * DAY, NOW).label, "Due in 2d")
})

test("sortByUrgency - most urgent first, unknown deadlines last", () => {
  const pools = [
    pool({ id: "normal", name: "Normal", deadline: NOW + 10 * DAY }),
    pool({ id: "unknown", name: "Unknown", deadline: null }),
    pool({ id: "overdue", name: "Overdue", deadline: NOW - DAY }),
    pool({ id: "urgent", name: "Urgent", deadline: NOW + 2 * HOUR }),
  ]
  assert.deepStrictEqual(
    sortByUrgency(pools, NOW).map((p) => p.id),
    ["overdue", "urgent", "normal", "unknown"]
  )
})

test("sortByUrgency - does not mutate the input", () => {
  const pools = [
    pool({ id: "b", deadline: NOW + 10 * DAY }),
    pool({ id: "a", deadline: NOW - DAY }),
  ]
  sortByUrgency(pools, NOW)
  assert.deepStrictEqual(
    pools.map((p) => p.id),
    ["b", "a"]
  )
})

// ── Progress ────────────────────────────────────────────────────────────────

test("isTerminal - confirmed, failed and cancelled are final; in-flight states are not", () => {
  assert.strictEqual(isTerminal("confirmed"), true)
  assert.strictEqual(isTerminal("failed"), true)
  assert.strictEqual(isTerminal("cancelled"), true)
  assert.strictEqual(isTerminal("pending"), false)
  assert.strictEqual(isTerminal("signing"), false)
  assert.strictEqual(isTerminal("submitted"), false)
})

test("computeProgress - reports the pool currently in flight", () => {
  const progress = computeProgress([
    item("confirmed", "a"),
    item("signing", "b"),
    item("pending", "c"),
    item("pending", "d"),
    item("pending", "e"),
  ])
  assert.strictEqual(progress.currentIndex, 2)
  assert.strictEqual(progress.label, "Depositing to pool 2 of 5…")
  assert.strictEqual(progress.done, 1)
  assert.strictEqual(progress.percent, 20)
})

test("computeProgress - a submitted deposit still counts as in flight", () => {
  const progress = computeProgress([item("confirmed", "a"), item("submitted", "b")])
  assert.strictEqual(progress.currentIndex, 2)
  assert.strictEqual(progress.label, "Depositing to pool 2 of 2…")
})

test("computeProgress - a clean finish reads as fully deposited", () => {
  const progress = computeProgress([item("confirmed", "a"), item("confirmed", "b")])
  assert.strictEqual(progress.percent, 100)
  assert.strictEqual(progress.currentIndex, null)
  assert.strictEqual(progress.failed, 0)
  assert.strictEqual(progress.label, "Deposited to 2 pools")
})

test("computeProgress - a partial failure names how many failed", () => {
  const progress = computeProgress([
    item("confirmed", "a"),
    item("failed", "b"),
    item("confirmed", "c"),
  ])
  assert.strictEqual(progress.confirmed, 2)
  assert.strictEqual(progress.failed, 1)
  assert.strictEqual(progress.percent, 100)
  assert.strictEqual(progress.label, "2 of 3 deposits confirmed, 1 failed")
})

test("computeProgress - cancelled deposits close out the run without counting as failures", () => {
  const progress = computeProgress([item("confirmed", "a"), item("cancelled", "b")])
  assert.strictEqual(progress.done, 2)
  assert.strictEqual(progress.failed, 0)
  assert.strictEqual(progress.currentIndex, null)
})

test("computeProgress - empty and not-yet-started runs", () => {
  assert.deepStrictEqual(computeProgress([]).label, "Nothing to deposit")
  assert.strictEqual(computeProgress([]).percent, 0)
  assert.strictEqual(computeProgress([item("pending", "a")]).label, "Preparing 1 deposit…")
  assert.strictEqual(
    computeProgress([item("pending", "a"), item("pending", "b")]).label,
    "Preparing 2 deposits…"
  )
})
