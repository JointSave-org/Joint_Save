// Unit tests for the pure iCal (RFC 5545) export logic.
import { test } from "node:test"
import assert from "node:assert"
import { buildIcs, buildIcsEvent, downloadIcs, type IcsEventInput } from "./ical-export"

const START = new Date(Date.UTC(2026, 7, 20, 15, 30, 0))

function baseEvent(overrides: Partial<IcsEventInput> = {}): IcsEventInput {
  return {
    uid: "deposit-pool-1-2",
    summary: "Deposit due: Family Circle",
    description: "Deposit 50 XLM to Family Circle. Pool contract: CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
    start: START,
    url: "https://app.jointsave.io/dashboard/group/pool-1",
    ...overrides,
  }
}

// ── buildIcsEvent ────────────────────────────────────────────────────────────

test("buildIcsEvent - produces a well-formed VEVENT with a 1 hour duration", () => {
  const lines = buildIcsEvent(baseEvent())

  assert.strictEqual(lines[0], "BEGIN:VEVENT")
  assert.strictEqual(lines[lines.length - 1], "END:VEVENT")
  assert.ok(lines.includes("UID:deposit-pool-1-2@jointsave.app"))
  assert.ok(lines.includes("DTSTART:20260820T153000Z"))
  assert.ok(lines.includes("DTEND:20260820T163000Z"))
  assert.ok(lines.includes("SUMMARY:Deposit due: Family Circle"))
  assert.ok(lines.includes("URL:https://app.jointsave.io/dashboard/group/pool-1"))
  assert.ok(lines.some((l) => l.startsWith("DTSTAMP:")))
})

test("buildIcsEvent - honors a custom duration", () => {
  const lines = buildIcsEvent(baseEvent({ durationMinutes: 30 }))
  assert.ok(lines.includes("DTEND:20260820T160000Z"))
})

test("buildIcsEvent - renders an all-day event without a time component", () => {
  const lines = buildIcsEvent(baseEvent({ allDay: true }))
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20260820"))
  assert.ok(lines.includes("DTEND;VALUE=DATE:20260821"))
})

test("buildIcsEvent - escapes commas, semicolons and newlines in text fields", () => {
  const lines = buildIcsEvent(
    baseEvent({ description: "Deposit 50, 100; 150\nXLM to Pool" })
  )
  const description = lines.find((l) => l.startsWith("DESCRIPTION:"))
  assert.strictEqual(description, "DESCRIPTION:Deposit 50\\, 100\\; 150\\nXLM to Pool")
})

test("buildIcsEvent - omits URL when not provided", () => {
  const lines = buildIcsEvent(baseEvent({ url: undefined }))
  assert.strictEqual(
    lines.some((l) => l.startsWith("URL:")),
    false
  )
})

// ── buildIcs ─────────────────────────────────────────────────────────────────

test("buildIcs - wraps events in a VCALENDAR with CRLF line endings", () => {
  const ics = buildIcs([baseEvent()])
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"))
  assert.ok(ics.includes("VERSION:2.0\r\n"))
  assert.ok(ics.trim().endsWith("END:VCALENDAR"))
  assert.ok(ics.includes("BEGIN:VEVENT\r\n"))
})

test("buildIcs - includes one VEVENT per event", () => {
  const ics = buildIcs([baseEvent({ uid: "a" }), baseEvent({ uid: "b" })])
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 2)
})

test("buildIcs - folds content lines longer than 75 octets", () => {
  const longDescription =
    "This is a very long deposit description that will definitely exceed the seventy five octet line folding limit set by RFC 5545."
  const ics = buildIcs([baseEvent({ description: longDescription })])
  const descriptionLine = ics.split("\r\n").find((l) => l.startsWith("DESCRIPTION:"))
  assert.ok(descriptionLine)
  assert.ok((descriptionLine as string).length <= 75)
  // The continuation line must start with a single space per RFC 5545 §3.1.
  const lines = ics.split("\r\n")
  const idx = lines.indexOf(descriptionLine as string)
  assert.ok(lines[idx + 1].startsWith(" "))
})

// ── downloadIcs ──────────────────────────────────────────────────────────────

test("downloadIcs - no-ops outside a browser environment", () => {
  assert.doesNotThrow(() => downloadIcs(buildIcs([baseEvent()]), "deposits.ics"))
})
