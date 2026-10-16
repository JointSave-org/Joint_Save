import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BPS_DENOMINATOR,
  DEFAULT_BUFFER_BPS,
  MAX_BUFFER_BPS,
  allocatedSharePct,
  clampBufferBps,
  computeMaxAllocatable,
  formatSharePrice,
  isAllocated,
  isIlliquid,
  liquidBalance,
  sharePrice,
  unrealisedGain,
  validateBufferBps,
} from "./yield-allocation"

test("liquidBalance never goes negative", () => {
  assert.equal(liquidBalance(200n, 50n), 150n)
  assert.equal(liquidBalance(50n, 200n), 0n)
  assert.equal(liquidBalance(0n, 0n), 0n)
})

test("computeMaxAllocatable leaves the configured buffer liquid", () => {
  // 1000 total, 20% buffer (200), nothing allocated -> 800 allocatable.
  assert.equal(computeMaxAllocatable(1000n, 0n, DEFAULT_BUFFER_BPS), 800n)
  // 500 already allocated -> idle 500, buffer still 200 -> 300 allocatable.
  assert.equal(computeMaxAllocatable(1000n, 500n, DEFAULT_BUFFER_BPS), 300n)
  // Fully allocated -> nothing more to push.
  assert.equal(computeMaxAllocatable(1000n, 1000n, DEFAULT_BUFFER_BPS), 0n)
})

test("computeMaxAllocatable rounds in favour of the buffer", () => {
  // 333 * 20% = 66.6 -> floor 66; 333 - 66 = 267.
  assert.equal(computeMaxAllocatable(333n, 0n, DEFAULT_BUFFER_BPS), 267n)
})

test("computeMaxAllocatable handles zero balance and zero buffer", () => {
  assert.equal(computeMaxAllocatable(0n, 0n, DEFAULT_BUFFER_BPS), 0n)
  assert.equal(computeMaxAllocatable(100n, 0n, 0), 100n)
})

test("clampBufferBps bounds into [0, 10000]", () => {
  assert.equal(clampBufferBps(-5), 0)
  assert.equal(clampBufferBps(20000), MAX_BUFFER_BPS)
  assert.equal(clampBufferBps(2000), 2000)
  assert.equal(clampBufferBps(Number.NaN), DEFAULT_BUFFER_BPS)
})

test("validateBufferBps rejects out-of-range and fractional values", () => {
  assert.equal(validateBufferBps(2000), null)
  assert.equal(validateBufferBps(0), null)
  assert.equal(validateBufferBps(BPS_DENOMINATOR), null)
  assert.match(validateBufferBps(-1) ?? "", /negative/)
  assert.match(validateBufferBps(BPS_DENOMINATOR + 1) ?? "", /100%/)
  assert.match(validateBufferBps(2000.5) ?? "", /whole number/)
  assert.match(validateBufferBps(Number.NaN) ?? "", /number/)
})

test("sharePrice and unrealisedGain", () => {
  // 1.1 tokens of value for 1 share -> 1.1 tokens per share (scaled by SHARE_SCALE).
  assert.equal(sharePrice(1_100_000_000n, 1_000_000_000n), 1_100_000_000n)
  assert.equal(sharePrice(0n, 0n), null)
  assert.equal(unrealisedGain(1100n, 1000n), 100n)
  assert.equal(unrealisedGain(900n, 1000n), 0n)
})

test("formatSharePrice renders a fixed-precision value", () => {
  assert.equal(formatSharePrice(1_100_000_000n, 1_000_000_000n), "1.1000")
  // Position worth 1.1x shares -> 1.1 tokens per share.
  assert.equal(formatSharePrice(1_100_000_000n, 1_000_000_000n, 2), "1.10")
  assert.equal(formatSharePrice(0n, 0n), null)
})

test("isAllocated and isIlliquid", () => {
  assert.equal(isAllocated({ vault: "CABC", shares: 1n }), true)
  assert.equal(isAllocated({ vault: null, shares: 1n }), false)
  assert.equal(isAllocated({ vault: "CABC", shares: 0n }), false)
  assert.equal(isIlliquid({ locked: true, shares: 5n }), true)
  assert.equal(isIlliquid({ locked: true, shares: 0n }), false)
  assert.equal(isIlliquid({ locked: false, shares: 5n }), false)
})

test("allocatedSharePct", () => {
  assert.equal(allocatedSharePct(500n, 1000n), 50)
  assert.equal(allocatedSharePct(0n, 0n), 0)
  assert.equal(allocatedSharePct(2000n, 1000n), 100)
})
