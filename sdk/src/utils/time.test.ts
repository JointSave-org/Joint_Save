import { describe, expect, it } from "vitest";
import {
  LEDGERS_PER_DAY,
  SECONDS_PER_LEDGER,
  daysToLedgers,
  estimateLedgerAt,
  isPastDeadline,
  ledgerToTimestamp,
  ledgersToDays,
  sleep,
} from "./time";

describe("ledger conversions", () => {
  it("exposes the protocol timing constants", () => {
    expect(SECONDS_PER_LEDGER).toBe(5);
    expect(LEDGERS_PER_DAY).toBe(17_280);
  });

  it("converts days and ledgers", () => {
    expect(daysToLedgers(1)).toBe(LEDGERS_PER_DAY);
    expect(daysToLedgers(0.5)).toBe(LEDGERS_PER_DAY / 2);
    expect(daysToLedgers(0)).toBe(0);
    expect(ledgersToDays(LEDGERS_PER_DAY)).toBe(1);
    expect(ledgersToDays(0)).toBe(0);
  });

  it("rejects non-finite values", () => {
    expect(() => daysToLedgers(Number.NaN)).toThrow(RangeError);
    expect(() => daysToLedgers(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => ledgersToDays(Number.NaN)).toThrow(RangeError);
  });
});

describe("timestamp estimates", () => {
  it("treats ledger 0 as the Unix epoch without a reference", () => {
    expect(ledgerToTimestamp(0)).toBe(0);
    expect(ledgerToTimestamp(100)).toBe(500);
    expect(ledgerToTimestamp(-1)).toBe(-5);
  });

  it("uses a reference clock when provided", () => {
    const ref = { currentLedger: 100, nowMs: 1_000_000 };
    expect(ledgerToTimestamp(100, ref)).toBe(1_000);
    expect(ledgerToTimestamp(101, ref)).toBe(1_005);
  });

  it("estimates the ledger at a time", () => {
    expect(estimateLedgerAt(0)).toBe(0);
    expect(estimateLedgerAt(5_000)).toBe(1);
    const ref = { currentLedger: 1_000, nowMs: 1_000_000 };
    expect(estimateLedgerAt(1_000_000, ref)).toBe(1_000);
    expect(estimateLedgerAt(1_005_000, ref)).toBe(1_001);
    expect(estimateLedgerAt(new Date(1_000_000), ref)).toBe(1_000);
  });

  it("rejects invalid input", () => {
    expect(() => ledgerToTimestamp(Number.NaN)).toThrow(RangeError);
    expect(() => estimateLedgerAt(Number.NaN)).toThrow(RangeError);
    expect(() => estimateLedgerAt(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("deadlines and sleep", () => {
  it("detects past deadlines", () => {
    expect(isPastDeadline(100, 100)).toBe(true);
    expect(isPastDeadline(100, 101)).toBe(true);
    expect(isPastDeadline(100, 99)).toBe(false);
    expect(isPastDeadline(0, 0)).toBe(true);
    expect(isPastDeadline(-1, 0)).toBe(true);
  });

  it("resolves sleep even for invalid durations", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-10)).resolves.toBeUndefined();
    await expect(sleep(Number.NaN)).resolves.toBeUndefined();
  });
});
