import { describe, it, expect } from 'vitest';
import {
  toBaseUnits,
  fromBaseUnits,
  usdcToStroops,
  stroopsToUsdc,
  formatTokenAmount,
  formatUsdc,
  formatPercent,
} from '../src/utils/amounts.js';

describe('BigInt-safe amount conversions (amounts.ts)', () => {
  it('converts basic human strings and numbers to base units with 7 decimals', () => {
    expect(toBaseUnits('1', 7)).toBe(10_000_000n);
    expect(toBaseUnits('1.5', 7)).toBe(15_000_000n);
    expect(toBaseUnits('0.0000001', 7)).toBe(1n);
    expect(toBaseUnits('100.1234567', 7)).toBe(1_001_234_567n);
    expect(toBaseUnits(10, 7)).toBe(100_000_000n);
    expect(toBaseUnits(50n, 7)).toBe(500_000_000n);
  });

  it('usdcToStroops and stroopsToUsdc work as 7-decimal wrappers', () => {
    expect(usdcToStroops('100')).toBe(1_000_000_000n);
    expect(stroopsToUsdc(1_000_000_000n)).toBe('100');
    expect(stroopsToUsdc(12_345_678n)).toBe('1.2345678');
  });

  it('rejects over-precision with clear RangeError', () => {
    expect(() => toBaseUnits('1.12345678', 7)).toThrow(RangeError);
    expect(() => toBaseUnits('0.00000001', 7)).toThrow(RangeError);
  });

  it('rejects invalid, non-numeric and NaN values with TypeError', () => {
    expect(() => toBaseUnits('abc', 7)).toThrow(TypeError);
    expect(() => toBaseUnits('', 7)).toThrow(TypeError);
    expect(() => toBaseUnits('1.2.3', 7)).toThrow(TypeError);
    expect(() => toBaseUnits(NaN, 7)).toThrow(TypeError);
    expect(() => toBaseUnits(Infinity, 7)).toThrow(TypeError);
  });

  it('round-trips correctly for 0, 1, fractions, and large pool amounts without drift', () => {
    const testCases = [
      { decimal: '0', units: 0n },
      { decimal: '1', units: 10_000_000n },
      { decimal: '0.0000001', units: 1n },
      { decimal: '1234567.8901234', units: 12_345_678_901_234n },
      { decimal: '1000000000', units: 10_000_000_000_000_000n },
    ];

    for (const tc of testCases) {
      expect(toBaseUnits(tc.decimal, 7)).toBe(tc.units);
      expect(fromBaseUnits(tc.units, 7)).toBe(tc.decimal);
    }
  });

  it('supports negative amounts correctly', () => {
    expect(toBaseUnits('-5.5', 7)).toBe(-55_000_000n);
    expect(fromBaseUnits(-55_000_000n, 7)).toBe('-5.5');
  });

  it('formats token amounts with zero-subscript notation for tiny values', () => {
    // 0.00000342 (5 zeros after decimal point with decimals: 8)
    expect(formatTokenAmount(342n, { decimals: 8 })).toBe('0.0₅342');
    // 0.0000342 (4 zeros after decimal point with decimals: 7)
    expect(formatTokenAmount(342n, { decimals: 7 })).toBe('0.0₄342');
    // 0.0000001 (6 zeros after decimal point)
    expect(formatTokenAmount(1n, { decimals: 7 })).toBe('0.0₆1');
    // 0.001 (only 2 zeros -> no subscript)
    expect(formatTokenAmount(10_000n, { decimals: 7 })).toBe('0.001');
  });

  it('formats maxFractionDigits and USDC amounts', () => {
    expect(formatTokenAmount(12_345_678n, { decimals: 7, maxFractionDigits: 2 })).toBe('1.23');
    expect(formatTokenAmount(12_345_678n, { decimals: 7, maxFractionDigits: 0 })).toBe('1');
    expect(formatUsdc(10_000_000n)).toBe('1');
    expect(formatUsdc('50000000')).toBe('5');
  });

  it('formats percent from basis points', () => {
    expect(formatPercent(100)).toBe('1%');
    expect(formatPercent(50)).toBe('0.5%');
    expect(formatPercent(125)).toBe('1.25%');
    expect(formatPercent(0)).toBe('0%');
    expect(() => formatPercent(NaN)).toThrow(TypeError);
  });
});
