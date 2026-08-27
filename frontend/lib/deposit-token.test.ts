// Unit tests for the pure multi-token deposit logic: human ↔ base-units
// conversion, token selection, balance checks and fee maths.
import { test } from "node:test"
import assert from "node:assert"
import {
  baseUnitsToHuman,
  checkSufficientBalance,
  computeDepositFee,
  humanToBaseUnits,
  isMultiToken,
  scaleForDecimals,
  trimHumanAmount,
  validateTokenSelection,
  type DepositToken,
} from "./deposit-token"

const USDC: DepositToken = { address: "CBUSDC1234", symbol: "USDC", decimals: 7 }
const XLM: DepositToken = { address: "native", symbol: "XLM", decimals: 7 }

// ── scaleForDecimals ─────────────────────────────────────────────────────────

test("scaleForDecimals - 10^decimals", () => {
  assert.strictEqual(scaleForDecimals(0), 1n)
  assert.strictEqual(scaleForDecimals(6), 1_000_000n)
  assert.strictEqual(scaleForDecimals(7), 10_000_000n)
})

test("scaleForDecimals - rejects invalid precision", () => {
  assert.throws(() => scaleForDecimals(-1))
  assert.throws(() => scaleForDecimals(19))
  assert.throws(() => scaleForDecimals(1.5))
})

// ── humanToBaseUnits ─────────────────────────────────────────────────────────

test("humanToBaseUnits - whole + fractional at 7 decimals", () => {
  assert.strictEqual(humanToBaseUnits("0.07", 7), 700000n)
  assert.strictEqual(humanToBaseUnits("50", 7), 500_000_000n)
  assert.strictEqual(humanToBaseUnits("1.2345678", 7), 12_345_678n)
})

test("humanToBaseUnits - exact, no float noise", () => {
  // Would be 700000.000000005 with naive float math.
  assert.strictEqual(humanToBaseUnits("0.07", 7), 700000n)
  assert.strictEqual(humanToBaseUnits("0.1", 7), 1_000_000n)
})

test("humanToBaseUnits - accepts a trailing zero and whitespace", () => {
  assert.strictEqual(humanToBaseUnits("  10.5 ", 7), 105_000_000n)
  assert.strictEqual(humanToBaseUnits("7.0000000", 7), 70_000_000n)
})

test("humanToBaseUnits - custom decimals", () => {
  assert.strictEqual(humanToBaseUnits("1.25", 6), 1_250_000n)
  assert.strictEqual(humanToBaseUnits("1", 18), 10n ** 18n)
})

test("humanToBaseUnits - rejects more fractional digits than the asset", () => {
  assert.throws(() => humanToBaseUnits("0.12345678", 7), /exceeds 7 decimal places/)
  assert.throws(() => humanToBaseUnits("1.00000001", 7), /exceeds 7 decimal places/)
})

test("humanToBaseUnits - rejects malformed input", () => {
  assert.throws(() => humanToBaseUnits("", 7))
  assert.throws(() => humanToBaseUnits("abc", 7))
  assert.throws(() => humanToBaseUnits("1.2.3", 7))
  assert.throws(() => humanToBaseUnits("1e3", 7))
})

// ── baseUnitsToHuman ─────────────────────────────────────────────────────────

test("baseUnitsToHuman - round trip for 7-decimal asset", () => {
  assert.strictEqual(baseUnitsToHuman(700000n, 7), "0.07")
  assert.strictEqual(baseUnitsToHuman(500_000_000n, 7), "50")
  assert.strictEqual(baseUnitsToHuman(12_345_678n, 7), "1.2345678")
})

test("baseUnitsToHuman - negligible trailing zeros dropped", () => {
  assert.strictEqual(baseUnitsToHuman(50_000_000n, 7), "5")
  assert.strictEqual(baseUnitsToHuman(105_000_000n, 7), "10.5")
})

// ── trimHumanAmount ──────────────────────────────────────────────────────────

test("trimHumanAmount - strips trailing zeros", () => {
  assert.strictEqual(trimHumanAmount("50.0000000"), "50")
  assert.strictEqual(trimHumanAmount("10.50"), "10.5")
  assert.strictEqual(trimHumanAmount("1.00"), "1")
})

test("trimHumanAmount - leaves no-decimal strings alone", () => {
  assert.strictEqual(trimHumanAmount("50"), "50")
})

// ── validateTokenSelection ───────────────────────────────────────────────────

test("validateTokenSelection - unrestricted when supported list empty", () => {
  assert.strictEqual(validateTokenSelection(USDC, []), null)
  assert.strictEqual(validateTokenSelection(XLM, []), null)
})

test("validateTokenSelection - accepts a token in the supported set", () => {
  assert.strictEqual(validateTokenSelection(USDC, [USDC.address]), null)
  assert.strictEqual(validateTokenSelection(XLM, ["native"]), null)
})

test("validateTokenSelection - rejects a token outside the supported set", () => {
  const err = validateTokenSelection(USDC, ["native"])
  assert.ok(err && err.includes("not an accepted deposit token"))
  assert.ok(err && err.includes("USDC"))
})

test("validateTokenSelection - rejects when no address chosen", () => {
  assert.ok(validateTokenSelection({ address: "", symbol: "" }, []))
})

// ── checkSufficientBalance ───────────────────────────────────────────────────

test("checkSufficientBalance - passes with enough balance", () => {
  assert.strictEqual(checkSufficientBalance("0.07", 7, 700000n), null)
  assert.strictEqual(checkSufficientBalance("1", 7, 10_000_000n), null)
})

test("checkSufficientBalance - fails with insufficient balance", () => {
  const err = checkSufficientBalance("1", 7, 999n)
  assert.ok(err && err.includes("Insufficient balance"))
})

test("checkSufficientBalance - rejects zero and invalid amounts", () => {
  assert.ok(checkSufficientBalance("0", 7, 10n))
  assert.ok(checkSufficientBalance("abc", 7, 10n))
})

// ── computeDepositFee ────────────────────────────────────────────────────────

test("computeDepositFee - treasury+relayer bps in the settlement unit", () => {
  // 100 XLM @ 7 decimals, 50 bps (0.5%) → 0.5 fee, 99.5 net.
  const r = computeDepositFee("100", 7, 50, 0)
  assert.strictEqual(r.fee, 5_000_000n)
  assert.strictEqual(r.feeHuman, "0.5")
  assert.strictEqual(r.net, 995_000_000n)
  assert.strictEqual(r.netHuman, "99.5")
})

test("computeDepositFee - zero bps means no fee", () => {
  const r = computeDepositFee("50", 6, 0, 0)
  assert.strictEqual(r.fee, 0n)
  assert.strictEqual(r.net, 50_000_000n)
})

test("computeDepositFee - divides bps between treasury and relayer", () => {
  const r = computeDepositFee("1000", 7, 10, 20) // 30 bps = 0.3%
  assert.strictEqual(r.fee, 30_000_000n)
  assert.strictEqual(r.feeHuman, "3")
  assert.strictEqual(r.netHuman, "997")
})

// ── isMultiToken ─────────────────────────────────────────────────────────────

test("isMultiToken - 2+ distinct addresses", () => {
  assert.strictEqual(isMultiToken([XLM.address, USDC.address]), true)
  assert.strictEqual(isMultiToken(["native", USDC.address]), true)
})

test("isMultiToken - single or empty list is not multi-token", () => {
  assert.strictEqual(isMultiToken([XLM.address]), false)
  assert.strictEqual(isMultiToken([]), false)
})
