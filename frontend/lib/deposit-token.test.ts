// Unit tests for the pure multi-token deposit logic: decimals conversion,
// token selection, balance checks and fee maths.
import { test } from "node:test"
import assert from "node:assert"
import {
  baseUnitsToHuman,
  checkSufficientBalance,
  computeDepositFee,
  humanToBaseUnits,
  normalizeDecimals,
  trimHumanAmount,
  validateTokenSelection,
  type DepositToken,
} from "./deposit-token"

const XLM: DepositToken = { contractAddress: "native", symbol: "XLM", decimals: 7 }
const USDC: DepositToken = {
  contractAddress: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  symbol: "USDC",
  decimals: 7,
}

// ── Decimals & unit conversion ───────────────────────────────────────────────

test("normalizeDecimals - falls back to 7 for invalid values", () => {
  assert.equal(normalizeDecimals(7), 7)
  assert.equal(normalizeDecimals(0), 0)
  assert.equal(normalizeDecimals(undefined), 7)
  assert.equal(normalizeDecimals(null), 7)
  assert.equal(normalizeDecimals(-1), 7)
  assert.equal(normalizeDecimals(3.5), 7)
  assert.equal(normalizeDecimals(Number.NaN), 7)
})

test("humanToBaseUnits - converts human amount to exact base units", () => {
  assert.equal(humanToBaseUnits("1", 7), 10000000n)
  assert.equal(humanToBaseUnits("1.5", 7), 15000000n)
  assert.equal(humanToBaseUnits("0.07", 7), 700000n)
  assert.equal(humanToBaseUnits("100", 0), 100n)
  assert.equal(humanToBaseUnits(1.5, 7), 15000000n)
})

test("humanToBaseUnits - rejects invalid input", () => {
  assert.equal(humanToBaseUnits("", 7), null)
  assert.equal(humanToBaseUnits("abc", 7), null)
  assert.equal(humanToBaseUnits("-1", 7), null)
  assert.equal(humanToBaseUnits("1.2.3", 7), null)
  assert.equal(humanToBaseUnits("0.12345678", 7), null) // too many decimals
  assert.equal(humanToBaseUnits("1e5", 7), null)
})

test("baseUnitsToHuman - is the inverse of humanToBaseUnits", () => {
  assert.equal(baseUnitsToHuman(15000000n, 7), "1.5000000")
  assert.equal(baseUnitsToHuman(700000n, 7), "0.0700000")
  assert.equal(baseUnitsToHuman(100n, 0), "100")
  assert.equal(baseUnitsToHuman(1n, 7), "0.0000001")
  assert.equal(baseUnitsToHuman(0n, 7), "0.0000000")
})

test("trimHumanAmount - trims trailing zeros in display", () => {
  assert.equal(trimHumanAmount("1.5000000"), "1.5")
  assert.equal(trimHumanAmount("1.0000000"), "1")
  assert.equal(trimHumanAmount("0.0700000"), "0.07")
  assert.equal(trimHumanAmount("100"), "100")
})

// ── Token selection ──────────────────────────────────────────────────────────

test("validateTokenSelection - accepts a supported token", () => {
  const r = validateTokenSelection(XLM, [XLM, USDC])
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.token.symbol, "XLM")
})

test("validateTokenSelection - accepts native when supported list has native", () => {
  const r = validateTokenSelection({ ...XLM }, [
    { contractAddress: "native", symbol: "XLM", decimals: 7 },
  ])
  assert.equal(r.ok, true)
})

test("validateTokenSelection - rejects an unsupported token", () => {
  const r = validateTokenSelection(USDC, [XLM])
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /not supported/)
})

test("validateTokenSelection - unrestricted pool accepts any token", () => {
  const r = validateTokenSelection(USDC, [])
  assert.equal(r.ok, true)
})

// ── Balance checks ───────────────────────────────────────────────────────────

test("checkSufficientBalance - ok when amount fits balance", () => {
  const r = checkSufficientBalance("1.5", 20000000n, 7)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.baseUnits, 15000000n)
})

test("checkSufficientBalance - rejects insufficient balance", () => {
  const r = checkSufficientBalance("3", 20000000n, 7)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.reason, /Insufficient/)
})

test("checkSufficientBalance - rejects zero and invalid amounts", () => {
  assert.equal(checkSufficientBalance("0", 20000000n, 7).ok, false)
  assert.equal(checkSufficientBalance("abc", 20000000n, 7).ok, false)
})

// ── Fee maths ────────────────────────────────────────────────────────────────

test("computeDepositFee - computes fee and net in human units", () => {
  // 100 XLM @ 10000 stroops, 2% treasury + 1% relayer = 3% → fee 3, net 97
  const r = computeDepositFee("100", 200, 100, 7)
  assert.equal(r.feeHuman, 3)
  assert.equal(r.netHuman, 97)
})

test("computeDepositFee - zero fees pass through", () => {
  const r = computeDepositFee("50", 0, 0, 7)
  assert.equal(r.feeHuman, 0)
  assert.equal(r.netHuman, 50)
})
