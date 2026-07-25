import { test } from "node:test"
import assert from "node:assert"

// ── Validation & pagination helpers (mirrors route.ts) ───────────────────────

const PAGE_SIZE = 10

function validateWalletParam(wallet: string | null): string | null {
  if (!wallet) return "wallet required"
  return null
}

function parsePageParam(pageParam: string | null): number {
  if (pageParam === null) return -1 // signals non-paginated mode
  const parsed = parseInt(pageParam || "0", 10)
  return Math.max(0, isNaN(parsed) ? 0 : parsed)
}

function computeRange(page: number, pageSize: number): { from: number; to: number } {
  const from = page * pageSize
  const to = from + pageSize - 1
  return { from, to }
}

function validateMarkReadBody(
  body: unknown
): { wallet_address: string } | { error: string; status: number } {
  if (!body || typeof body !== "object") return { error: "wallet_address required", status: 400 }
  const { wallet_address } = body as Record<string, unknown>
  if (!wallet_address || typeof wallet_address !== "string")
    return { error: "wallet_address required", status: 400 }
  return { wallet_address: wallet_address.toLowerCase() }
}

function computeTotalPages(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize)
}

function formatPageRange(
  page: number,
  pageSize: number,
  total: number
): { start: number; end: number } {
  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, total)
  return { start, end }
}

// ── Wallet validation tests ──────────────────────────────────────────────────

test("notifications — returns error when wallet is null", () => {
  const error = validateWalletParam(null)
  assert.strictEqual(error, "wallet required")
})

test("notifications — returns error when wallet is empty string", () => {
  const error = validateWalletParam("")
  assert.strictEqual(error, "wallet required")
})

test("notifications — returns null for valid wallet", () => {
  const error = validateWalletParam("GABC123")
  assert.strictEqual(error, null)
})

// ── Page parameter parsing ───────────────────────────────────────────────────

test("notifications — non-paginated mode returns -1 for null pageParam", () => {
  const page = parsePageParam(null)
  assert.strictEqual(page, -1)
})

test("notifications — page 0 parses correctly", () => {
  const page = parsePageParam("0")
  assert.strictEqual(page, 0)
})

test("notifications — page 3 parses correctly", () => {
  const page = parsePageParam("3")
  assert.strictEqual(page, 3)
})

test("notifications — negative page clamps to 0", () => {
  const page = parsePageParam("-5")
  assert.strictEqual(page, 0)
})

test("notifications — non-numeric page defaults to 0", () => {
  const page = parsePageParam("abc")
  assert.strictEqual(page, 0)
})

test("notifications — undefined string page defaults to 0", () => {
  const page = parsePageParam("")
  assert.strictEqual(page, 0)
})

// ── Range computation ────────────────────────────────────────────────────────

test("notifications — range for page 0 is 0..9", () => {
  const range = computeRange(0, PAGE_SIZE)
  assert.deepStrictEqual(range, { from: 0, to: 9 })
})

test("notifications — range for page 2 is 20..29", () => {
  const range = computeRange(2, PAGE_SIZE)
  assert.deepStrictEqual(range, { from: 20, to: 29 })
})

// ── Mark-read body validation ────────────────────────────────────────────────

test("notifications — mark read rejects missing body", () => {
  const result = validateMarkReadBody(null)
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

test("notifications — mark read rejects empty wallet_address", () => {
  const result = validateMarkReadBody({ wallet_address: "" })
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

test("notifications — mark read normalizes wallet to lowercase", () => {
  const result = validateMarkReadBody({ wallet_address: "GABC123" })
  assert.deepStrictEqual(result, { wallet_address: "gabc123" })
})

test("notifications — mark read accepts non-string wallet_address", () => {
  const result = validateMarkReadBody({ wallet_address: 12345 })
  assert.deepStrictEqual(result, { error: "wallet_address required", status: 400 })
})

// ── Total pages ──────────────────────────────────────────────────────────────

test("notifications — 0 notifications yields 0 total pages", () => {
  assert.strictEqual(computeTotalPages(0, PAGE_SIZE), 0)
})

test("notifications — 1 notification yields 1 page", () => {
  assert.strictEqual(computeTotalPages(1, PAGE_SIZE), 1)
})

test("notifications — 10 notifications yields 1 page", () => {
  assert.strictEqual(computeTotalPages(10, PAGE_SIZE), 1)
})

test("notifications — 11 notifications yields 2 pages", () => {
  assert.strictEqual(computeTotalPages(11, PAGE_SIZE), 2)
})

test("notifications — 100 notifications yields 10 pages", () => {
  assert.strictEqual(computeTotalPages(100, PAGE_SIZE), 10)
})

// ── Page range formatting ────────────────────────────────────────────────────

test("notifications — page range for page 0 of 25 items", () => {
  const range = formatPageRange(0, PAGE_SIZE, 25)
  assert.deepStrictEqual(range, { start: 1, end: 10 })
})

test("notifications — page range for page 2 of 25 items", () => {
  const range = formatPageRange(2, PAGE_SIZE, 25)
  assert.deepStrictEqual(range, { start: 21, end: 25 })
})
