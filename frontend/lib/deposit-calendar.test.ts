// Unit tests for the pure deposit-calendar logic: urgency banding, time
// remaining formatting, and grouping/sorting.
import { test } from "node:test"
import assert from "node:assert"
import {
  calendarUrgency,
  dayKey,
  formatTimeRemaining,
  groupEventsByDay,
  upcomingSorted,
  type DepositCalendarEvent,
} from "./deposit-calendar"

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function event(overrides: Partial<DepositCalendarEvent> = {}): DepositCalendarEvent {
  return {
    poolId: "pool-1",
    poolName: "Pool One",
    contractAddress: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
    amount: 50,
    tokenSymbol: "XLM",
    round: 0,
    deadlineMs: NOW + DAY,
    hasDeposited: false,
    ...overrides,
  }
}

// ── calendarUrgency ──────────────────────────────────────────────────────────

test("calendarUrgency - unknown for a missing deadline", () => {
  assert.strictEqual(calendarUrgency(null, NOW).level, "unknown")
})

test("calendarUrgency - green when more than 7 days away", () => {
  assert.strictEqual(calendarUrgency(NOW + 7 * DAY + 1, NOW).level, "green")
  assert.strictEqual(calendarUrgency(NOW + 30 * DAY, NOW).level, "green")
})

test("calendarUrgency - yellow band is inclusive of the 2 and 7 day boundaries", () => {
  assert.strictEqual(calendarUrgency(NOW + 7 * DAY, NOW).level, "yellow")
  assert.strictEqual(calendarUrgency(NOW + 2 * DAY, NOW).level, "yellow")
  assert.strictEqual(calendarUrgency(NOW + 5 * DAY, NOW).level, "yellow")
})

test("calendarUrgency - red under 2 days away, and overdue", () => {
  assert.strictEqual(calendarUrgency(NOW + 2 * DAY - 1, NOW).level, "red")
  assert.strictEqual(calendarUrgency(NOW + HOUR, NOW).level, "red")
  assert.strictEqual(calendarUrgency(NOW - HOUR, NOW).level, "red")
  assert.strictEqual(calendarUrgency(NOW - HOUR, NOW).label, "Overdue")
})

// ── formatTimeRemaining ──────────────────────────────────────────────────────

test("formatTimeRemaining - no deadline", () => {
  assert.strictEqual(formatTimeRemaining(null, NOW), "No deadline")
})

test("formatTimeRemaining - days and sub-day remaining", () => {
  assert.strictEqual(formatTimeRemaining(NOW + 3 * DAY, NOW), "Due in 3d")
  assert.strictEqual(formatTimeRemaining(NOW + 30 * 60 * 1000, NOW), "Due in 1h")
})

test("formatTimeRemaining - overdue", () => {
  assert.strictEqual(formatTimeRemaining(NOW - 30 * 60 * 1000, NOW), "Overdue")
  assert.strictEqual(formatTimeRemaining(NOW - 5 * HOUR, NOW), "Overdue by 5h")
  assert.strictEqual(formatTimeRemaining(NOW - 2 * DAY, NOW), "Overdue by 2d")
})

// ── grouping ─────────────────────────────────────────────────────────────────

test("dayKey - formats a timestamp as yyyy-MM-dd (UTC)", () => {
  assert.strictEqual(dayKey(NOW), "2026-08-18")
})

test("groupEventsByDay - groups same-day events and drops unknown deadlines", () => {
  const events = [
    event({ poolId: "a", deadlineMs: NOW }),
    event({ poolId: "b", deadlineMs: NOW + HOUR }),
    event({ poolId: "c", deadlineMs: NOW + DAY }),
    event({ poolId: "d", deadlineMs: null }),
  ]

  const grouped = groupEventsByDay(events)
  const key = dayKey(NOW)
  assert.strictEqual(grouped.get(key)?.length, 2)
  assert.deepStrictEqual(
    grouped.get(key)?.map((e) => e.poolId),
    ["a", "b"]
  )
  assert.strictEqual(
    Array.from(grouped.values())
      .flat()
      .some((e) => e.poolId === "d"),
    false
  )
})

// ── sorting ──────────────────────────────────────────────────────────────────

test("upcomingSorted - soonest deadline first, unknown last, ties alphabetical", () => {
  const events = [
    event({ poolId: "later", poolName: "Later Pool", deadlineMs: NOW + 2 * DAY }),
    event({ poolId: "unknown", poolName: "Unknown Pool", deadlineMs: null }),
    event({ poolId: "soonest", poolName: "Soonest Pool", deadlineMs: NOW }),
    event({ poolId: "tie-b", poolName: "B Pool", deadlineMs: NOW + DAY }),
    event({ poolId: "tie-a", poolName: "A Pool", deadlineMs: NOW + DAY }),
  ]

  const sorted = upcomingSorted(events).map((e) => e.poolId)
  assert.deepStrictEqual(sorted, ["soonest", "tie-a", "tie-b", "later", "unknown"])
})
