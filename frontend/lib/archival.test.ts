import { test } from "node:test"
import assert from "node:assert"
import {
  ARCHIVE_REASONS,
  COMPLETED_GRACE_DAYS,
  EMERGENCY_WITHDRAWN_GRACE_DAYS,
  INACTIVE_THRESHOLD_DAYS,
  evaluateArchival,
  holdsNoFunds,
  isArchiveReason,
  isArchived,
  latestActivityAt,
  netBalanceFromActivity,
  type ArchivalCandidate,
} from "@/lib/archival"

const NOW = new Date("2026-08-28T02:00:00.000Z").getTime()
const DAY_MS = 24 * 60 * 60 * 1000

const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString()

function candidate(overrides: Partial<ArchivalCandidate> = {}): ArchivalCandidate {
  return {
    id: "pool-1",
    status: "active",
    archived_at: null,
    completed_at: null,
    emergency_withdrawn_at: null,
    last_activity_at: daysAgo(1),
    created_at: daysAgo(120),
    net_balance: 0,
    ...overrides,
  }
}

// ── isArchiveReason ──────────────────────────────────────────────────────────

test("archival — every declared reason passes the guard", () => {
  for (const reason of ARCHIVE_REASONS) {
    assert.strictEqual(isArchiveReason(reason), true)
  }
})

test("archival — unknown reasons are rejected", () => {
  assert.strictEqual(isArchiveReason("deleted"), false)
  assert.strictEqual(isArchiveReason(""), false)
  assert.strictEqual(isArchiveReason(null), false)
  assert.strictEqual(isArchiveReason(7), false)
})

// ── Completed pools ──────────────────────────────────────────────────────────

test("archival — completed pool past the grace period is archived", () => {
  const decision = evaluateArchival(
    candidate({ status: "completed", completed_at: daysAgo(COMPLETED_GRACE_DAYS + 1) }),
    NOW
  )
  assert.strictEqual(decision.archive, true)
  assert.strictEqual(decision.reason, "completed")
})

test("archival — completed pool inside the grace period is kept visible", () => {
  const decision = evaluateArchival(
    candidate({ status: "completed", completed_at: daysAgo(COMPLETED_GRACE_DAYS - 1) }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

test("archival — completed pool exactly at the grace boundary is archived", () => {
  const decision = evaluateArchival(
    candidate({ status: "completed", completed_at: daysAgo(COMPLETED_GRACE_DAYS) }),
    NOW
  )
  assert.strictEqual(decision.archive, true)
})

test("archival — completed pool with no completed_at is left alone", () => {
  const decision = evaluateArchival(candidate({ status: "completed", completed_at: null }), NOW)
  assert.strictEqual(decision.archive, false)
})

test("archival — completed pool holding funds is still archived", () => {
  // Completion is an explicit end state; an unclaimed final payout must not
  // keep a finished pool in discovery forever.
  const decision = evaluateArchival(
    candidate({
      status: "completed",
      completed_at: daysAgo(COMPLETED_GRACE_DAYS + 5),
      net_balance: 500,
    }),
    NOW
  )
  assert.strictEqual(decision.archive, true)
  assert.strictEqual(decision.reason, "completed")
})

// ── Emergency-withdrawn pools ────────────────────────────────────────────────

test("archival — emergency-withdrawn pool past 30 days is archived", () => {
  const decision = evaluateArchival(
    candidate({
      status: "emergency_withdrawn",
      emergency_withdrawn_at: daysAgo(EMERGENCY_WITHDRAWN_GRACE_DAYS + 1),
    }),
    NOW
  )
  assert.strictEqual(decision.archive, true)
  assert.strictEqual(decision.reason, "emergency_withdrawn")
})

test("archival — emergency-withdrawn pool inside 30 days is kept visible", () => {
  const decision = evaluateArchival(
    candidate({
      status: "emergency_withdrawn",
      emergency_withdrawn_at: daysAgo(EMERGENCY_WITHDRAWN_GRACE_DAYS - 2),
    }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

// ── Inactive pools ───────────────────────────────────────────────────────────

test("archival — silent and empty pool past 90 days is archived", () => {
  const decision = evaluateArchival(
    candidate({ last_activity_at: daysAgo(INACTIVE_THRESHOLD_DAYS + 5), net_balance: 0 }),
    NOW
  )
  assert.strictEqual(decision.archive, true)
  assert.strictEqual(decision.reason, "inactive_90d")
})

test("archival — silent pool still holding member funds is NOT archived", () => {
  // The false positive that matters: quiet is not the same as dead, and
  // hiding a pool with real money in it would be a trust problem.
  const decision = evaluateArchival(
    candidate({ last_activity_at: daysAgo(INACTIVE_THRESHOLD_DAYS + 200), net_balance: 25 }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

test("archival — empty pool that is still active recently is NOT archived", () => {
  const decision = evaluateArchival(
    candidate({ last_activity_at: daysAgo(INACTIVE_THRESHOLD_DAYS - 1), net_balance: 0 }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

test("archival — never-active pool falls back to created_at for silence", () => {
  const decision = evaluateArchival(
    candidate({ last_activity_at: null, created_at: daysAgo(INACTIVE_THRESHOLD_DAYS + 1) }),
    NOW
  )
  assert.strictEqual(decision.archive, true)
  assert.strictEqual(decision.reason, "inactive_90d")
})

test("archival — freshly created empty pool is NOT archived", () => {
  const decision = evaluateArchival(
    candidate({ last_activity_at: null, created_at: daysAgo(2) }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

test("archival — paused pool is never swept for inactivity", () => {
  // Pausing is a deliberate admin decision; the sweep must not undo it.
  const decision = evaluateArchival(
    candidate({
      status: "paused",
      last_activity_at: daysAgo(INACTIVE_THRESHOLD_DAYS + 100),
      net_balance: 0,
    }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

// ── Idempotency and bad data ─────────────────────────────────────────────────

test("archival — an already-archived pool is never re-archived", () => {
  const decision = evaluateArchival(
    candidate({
      status: "completed",
      completed_at: daysAgo(365),
      archived_at: daysAgo(300),
    }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

test("archival — unparseable timestamps do not trigger archival", () => {
  const decision = evaluateArchival(
    candidate({ status: "completed", completed_at: "not-a-date" }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

test("archival — a future completed_at does not trigger archival", () => {
  const decision = evaluateArchival(
    candidate({ status: "completed", completed_at: daysAgo(-5) }),
    NOW
  )
  assert.strictEqual(decision.archive, false)
})

// ── holdsNoFunds ─────────────────────────────────────────────────────────────

test("archival — zero and dust balances count as empty", () => {
  assert.strictEqual(holdsNoFunds(0), true)
  assert.strictEqual(holdsNoFunds(1e-12), true)
})

test("archival — a negative net balance counts as empty", () => {
  assert.strictEqual(holdsNoFunds(-3), true)
})

test("archival — any real balance is not empty", () => {
  assert.strictEqual(holdsNoFunds(0.5), false)
  assert.strictEqual(holdsNoFunds(1000), false)
})

test("archival — NaN balance is treated as holding funds", () => {
  // Unknown balance must fail closed: keep the pool rather than hide it.
  assert.strictEqual(holdsNoFunds(Number.NaN), false)
})

// ── netBalanceFromActivity ───────────────────────────────────────────────────

test("archival — deposits add and withdrawals/payouts subtract", () => {
  const net = netBalanceFromActivity([
    { activity_type: "deposit", amount: 100 },
    { activity_type: "deposit", amount: 50 },
    { activity_type: "withdraw", amount: 30 },
    { activity_type: "payout", amount: 20 },
  ])
  assert.strictEqual(net, 100)
})

test("archival — activity types are matched case-insensitively", () => {
  const net = netBalanceFromActivity([
    { activity_type: "DEPOSIT", amount: 10 },
    { activity_type: "Withdraw", amount: 4 },
  ])
  assert.strictEqual(net, 6)
})

test("archival — non-balance activity and null amounts are ignored", () => {
  const net = netBalanceFromActivity([
    { activity_type: "pool_created", amount: null },
    { activity_type: "member_added", amount: null },
    { activity_type: "deposit", amount: null },
    { activity_type: null, amount: 99 },
  ])
  assert.strictEqual(net, 0)
})

test("archival — a fully withdrawn pool nets to zero", () => {
  const net = netBalanceFromActivity([
    { activity_type: "deposit", amount: 250 },
    { activity_type: "withdraw", amount: 250 },
  ])
  assert.strictEqual(holdsNoFunds(net), true)
})

// ── latestActivityAt ─────────────────────────────────────────────────────────

test("archival — newest activity timestamp wins regardless of order", () => {
  const newest = latestActivityAt([
    { created_at: "2026-01-05T00:00:00.000Z" },
    { created_at: "2026-06-01T00:00:00.000Z" },
    { created_at: "2026-03-11T00:00:00.000Z" },
  ])
  assert.strictEqual(newest, "2026-06-01T00:00:00.000Z")
})

test("archival — an empty activity list has no latest timestamp", () => {
  assert.strictEqual(latestActivityAt([]), null)
})

test("archival — unparseable activity timestamps are skipped", () => {
  const newest = latestActivityAt([
    { created_at: "garbage" },
    { created_at: "2026-02-02T00:00:00.000Z" },
  ])
  assert.strictEqual(newest, "2026-02-02T00:00:00.000Z")
})

// ── isArchived ───────────────────────────────────────────────────────────────

test("archival — isArchived keys off archived_at", () => {
  assert.strictEqual(isArchived({ archived_at: null, archive_reason: null }), false)
  assert.strictEqual(
    isArchived({ archived_at: daysAgo(1), archive_reason: "completed" }),
    true
  )
})
