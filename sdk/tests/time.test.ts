import { describe, it, expect } from 'vitest';
import {
  SECONDS_PER_LEDGER,
  SECONDS_PER_DAY,
  LEDGERS_PER_DAY,
  daysToLedgers,
  ledgersToDays,
  ledgerToTimestamp,
  estimateLedgerAt,
  isPastDeadline,
  sleep,
} from '../src/utils/time.js';

describe('Ledger and time utilities (time.ts)', () => {
  it('exports correct standard network constants', () => {
    expect(SECONDS_PER_LEDGER).toBe(5);
    expect(SECONDS_PER_DAY).toBe(86_400);
    expect(LEDGERS_PER_DAY).toBe(17_280);
  });

  it('converts days to ledgers and ledgers to days accurately', () => {
    expect(daysToLedgers(1)).toBe(17_280);
    expect(daysToLedgers(0)).toBe(0);
    expect(daysToLedgers(0.5)).toBe(8_640);
    expect(ledgersToDays(17_280)).toBe(1);
    expect(ledgersToDays(0)).toBe(0);

    // Range checks
    expect(() => daysToLedgers(-1)).toThrow(RangeError);
    expect(() => ledgersToDays(-5)).toThrow(RangeError);
    expect(() => daysToLedgers(NaN)).toThrow(RangeError);
  });

  it('estimates ledger timestamps and reverse calculates ledger numbers', () => {
    const baseTime = 1_700_000_000_000; // ms
    const baseLedger = 1_000;

    // +10 ledgers = +50 seconds = +50,000 ms
    const futureTime = ledgerToTimestamp(1_010, baseLedger, baseTime);
    expect(futureTime).toBe(baseTime + 50_000);

    // Estimate ledger at future date
    const targetDate = new Date(baseTime + 50_000);
    expect(estimateLedgerAt(targetDate, baseLedger, baseTime)).toBe(1_010);

    // Boundary: cannot return negative ledger sequence
    expect(estimateLedgerAt(baseTime - 100_000_000, 10, baseTime)).toBe(0);
  });

  it('verifies deadlines with isPastDeadline', () => {
    const now = 1_700_000_000;
    expect(isPastDeadline(now - 10, now)).toBe(true);
    expect(isPastDeadline(now + 10, now)).toBe(false);
    expect(isPastDeadline(now, now)).toBe(false);
  });

  it('sleep resolves asynchronously', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
