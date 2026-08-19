// Unit tests for the pool activity query helpers (issue #210)
import { test } from "node:test"
import assert from "node:assert"
import {
  ACTIVITY_CSV_HEADERS,
  activityToCsvRow,
  buildSearchOrClause,
  exportFilename,
  isActivityQueryError,
  parseActivityQuery,
  sanitizeSearchTerm,
  type ActivityQuery,
} from "./activity-query"
import { ACTIVITY_PAGE_SIZE } from "./constants"

function parseOk(params: Parameters<typeof parseActivityQuery>[0]): ActivityQuery {
  const q = parseActivityQuery(params)
  assert.ok(!isActivityQueryError(q), `expected valid query, got error: ${JSON.stringify(q)}`)
  return q
}

test("parseActivityQuery - defaults with no params", () => {
  const q = parseOk({})
  assert.strictEqual(q.search, null)
  assert.strictEqual(q.dateFromIso, null)
  assert.strictEqual(q.dateToExclusiveIso, null)
  assert.strictEqual(q.activityType, null)
  assert.strictEqual(q.ascending, false) // newest first
  assert.strictEqual(q.page, 1)
  assert.strictEqual(q.rangeFrom, 0)
  assert.strictEqual(q.rangeTo, ACTIVITY_PAGE_SIZE - 1)
})

test("parseActivityQuery - page maps to 50-row ranges", () => {
  const q = parseOk({ page: "3" })
  assert.strictEqual(q.rangeFrom, 2 * ACTIVITY_PAGE_SIZE)
  assert.strictEqual(q.rangeTo, 3 * ACTIVITY_PAGE_SIZE - 1)
})

test("parseActivityQuery - rejects bad page values", () => {
  for (const page of ["0", "-1", "1.5", "abc"]) {
    const q = parseActivityQuery({ page })
    assert.ok(isActivityQueryError(q), `page=${page} should be rejected`)
  }
})

test("parseActivityQuery - sort oldest flips ascending, bad sort rejected", () => {
  assert.strictEqual(parseOk({ sort: "oldest" }).ascending, true)
  assert.strictEqual(parseOk({ sort: "newest" }).ascending, false)
  assert.ok(isActivityQueryError(parseActivityQuery({ sort: "sideways" })))
})

test("parseActivityQuery - activity_type whitelist", () => {
  assert.strictEqual(parseOk({ activity_type: "deposit" }).activityType, "deposit")
  assert.ok(isActivityQueryError(parseActivityQuery({ activity_type: "hack" })))
})

test("parseActivityQuery - date_to is inclusive of the whole day", () => {
  const q = parseOk({ date_from: "2026-08-01", date_to: "2026-08-15" })
  assert.strictEqual(q.dateFromIso, "2026-08-01T00:00:00.000Z")
  // Exclusive upper bound at the following midnight
  assert.strictEqual(q.dateToExclusiveIso, "2026-08-16T00:00:00.000Z")
})

test("parseActivityQuery - rejects malformed and inverted dates", () => {
  assert.ok(isActivityQueryError(parseActivityQuery({ date_from: "01-08-2026" })))
  assert.ok(isActivityQueryError(parseActivityQuery({ date_to: "2026-13-40" })))
  assert.ok(
    isActivityQueryError(parseActivityQuery({ date_from: "2026-08-20", date_to: "2026-08-01" }))
  )
})

test("parseActivityQuery - caps search length", () => {
  assert.ok(isActivityQueryError(parseActivityQuery({ search: "x".repeat(101) })))
  assert.strictEqual(parseOk({ search: "x".repeat(100) })?.search, "x".repeat(100))
})

test("sanitizeSearchTerm - strips PostgREST metacharacters", () => {
  assert.strictEqual(sanitizeSearchTerm("x),description.ilike.(y"), "x description.ilike. y")
  assert.strictEqual(sanitizeSearchTerm("50%_off\\*"), "50 off")
  assert.strictEqual(sanitizeSearchTerm("deposit"), "deposit")
  assert.strictEqual(sanitizeSearchTerm(",,(())"), "")
})

test("buildSearchOrClause - covers searchable columns, null when term is all metachars", () => {
  const clause = buildSearchOrClause("deposit")
  assert.ok(clause?.includes("activity_type.ilike.%deposit%"))
  assert.ok(clause?.includes("description.ilike.%deposit%"))
  assert.ok(clause?.includes("user_address.ilike.%deposit%"))
  assert.ok(clause?.includes("tx_hash.ilike.%deposit%"))
  assert.strictEqual(buildSearchOrClause("(),%"), null)
})

test("buildSearchOrClause - injection attempt cannot introduce extra clauses", () => {
  const clause = buildSearchOrClause("a,id.eq.1")
  // Commas were stripped, so the malicious fragment is part of the pattern,
  // not a new filter condition.
  assert.strictEqual(clause?.split(",").length, 4)
})

test("activityToCsvRow - maps all columns and blanks nulls", () => {
  const row = activityToCsvRow({
    id: "act-1",
    activity_type: "deposit",
    user_address: null,
    amount: 12.5,
    token_amount: null,
    description: "deposit transaction",
    tx_hash: "abc123",
    block_number: 55_000,
    fee_charged: 100,
    on_chain_timestamp: "2026-08-18T10:00:00Z",
    created_at: "2026-08-18T09:59:58Z",
  })
  assert.strictEqual(row.length, ACTIVITY_CSV_HEADERS.length)
  assert.deepStrictEqual(row, [
    "act-1",
    "deposit",
    "",
    12.5,
    "",
    "deposit transaction",
    "abc123",
    55_000,
    100,
    "2026-08-18T10:00:00Z",
    "2026-08-18T09:59:58Z",
  ])
})

test("exportFilename - short id, date stamp, extension", () => {
  const name = exportFilename(
    "123e4567-e89b-12d3-a456-426614174000",
    "csv",
    new Date("2026-08-18T12:00:00Z")
  )
  assert.strictEqual(name, "pool-activity-123e4567-2026-08-18.csv")
  assert.ok(exportFilename("", "json", new Date("2026-08-18T12:00:00Z")).endsWith(".json"))
})
