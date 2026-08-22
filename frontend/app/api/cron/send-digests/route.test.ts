import { test } from "node:test"
import assert from "node:assert"

// -- Logic under test (mirrors route.ts) -------------------------------

const DAILY_STALE_HOURS = 20
const WEEKLY_STALE_DAYS = 6

function isAuthorized(authHeader: string | null, secret: string | undefined): boolean {
  return authHeader === `Bearer ${secret}`
}

function isMonday(date: Date): boolean {
  return date.getUTCDay() === 1
}

function dailyCutoff(now: Date): Date {
  return new Date(now.getTime() - DAILY_STALE_HOURS * 60 * 60 * 1000)
}

function weeklyCutoff(now: Date): Date {
  return new Date(now.getTime() - WEEKLY_STALE_DAYS * 24 * 60 * 60 * 1000)
}

function windowStart(now: Date, frequency: "daily" | "weekly"): Date {
  return frequency === "daily"
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
    : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
}

function isDue(lastSentAt: string | null, cutoff: Date): boolean {
  if (lastSentAt === null) return true
  return new Date(lastSentAt).getTime() < cutoff.getTime()
}

// -- Auth ------------------------------------------------------------------

test("send-digests -- rejects missing authorization header", () => {
  assert.strictEqual(isAuthorized(null, "secret123"), false)
})

test("send-digests -- rejects wrong bearer token", () => {
  assert.strictEqual(isAuthorized("Bearer wrong", "secret123"), false)
})

test("send-digests -- accepts matching bearer token", () => {
  assert.strictEqual(isAuthorized("Bearer secret123", "secret123"), true)
})

// -- Monday gating for weekly digests ---------------------------------------

test("send-digests -- 2026-08-24 (Monday) is detected as Monday", () => {
  assert.strictEqual(isMonday(new Date("2026-08-24T08:00:00Z")), true)
})

test("send-digests -- 2026-08-25 (Tuesday) is not detected as Monday", () => {
  assert.strictEqual(isMonday(new Date("2026-08-25T08:00:00Z")), false)
})

// -- Cutoff math -------------------------------------------------------------

test("send-digests -- daily cutoff is 20 hours before now", () => {
  const now = new Date("2026-08-20T08:00:00Z")
  const cutoff = dailyCutoff(now)
  assert.strictEqual(cutoff.toISOString(), "2026-08-19T12:00:00.000Z")
})

test("send-digests -- weekly cutoff is 6 days before now", () => {
  const now = new Date("2026-08-24T08:00:00Z")
  const cutoff = weeklyCutoff(now)
  assert.strictEqual(cutoff.toISOString(), "2026-08-18T08:00:00.000Z")
})

// -- Idempotency (last_sent_at gating) ---------------------------------------

test("send-digests -- never-sent (null last_sent_at) is always due", () => {
  const now = new Date("2026-08-20T08:00:00Z")
  assert.strictEqual(isDue(null, dailyCutoff(now)), true)
})

test("send-digests -- sent 25 hours ago is due for daily", () => {
  const now = new Date("2026-08-20T08:00:00Z")
  const lastSent = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString()
  assert.strictEqual(isDue(lastSent, dailyCutoff(now)), true)
})

test("send-digests -- sent 5 hours ago is NOT due for daily (no duplicate)", () => {
  const now = new Date("2026-08-20T08:00:00Z")
  const lastSent = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString()
  assert.strictEqual(isDue(lastSent, dailyCutoff(now)), false)
})

test("send-digests -- sent 8 days ago is due for weekly", () => {
  const now = new Date("2026-08-24T08:00:00Z")
  const lastSent = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()
  assert.strictEqual(isDue(lastSent, weeklyCutoff(now)), true)
})

test("send-digests -- sent 2 days ago is NOT due for weekly (no duplicate)", () => {
  const now = new Date("2026-08-24T08:00:00Z")
  const lastSent = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
  assert.strictEqual(isDue(lastSent, weeklyCutoff(now)), false)
})

// -- Notification query window -----------------------------------------------

test("send-digests -- daily digest window is the last 24 hours", () => {
  const now = new Date("2026-08-20T08:00:00Z")
  assert.strictEqual(windowStart(now, "daily").toISOString(), "2026-08-19T08:00:00.000Z")
})

test("send-digests -- weekly digest window is the last 7 days", () => {
  const now = new Date("2026-08-24T08:00:00Z")
  assert.strictEqual(windowStart(now, "weekly").toISOString(), "2026-08-17T08:00:00.000Z")
})
