import { describe, expect, it } from "vitest";
import {
  formatPercent,
  formatTokenAmount,
  formatUsdc,
  fromBaseUnits,
  stroopsToUsdc,
  toBaseUnits,
  usdcToStroops,
} from "./amounts";

describe("toBaseUnits", () => {
  it("converts decimal strings exactly", () => {
    expect(toBaseUnits("12.5", 7)).toBe(125_000_000n);
    expect(toBaseUnits("1", 7)).toBe(10_000_000n);
    expect(toBaseUnits("0.0000001", 7)).toBe(1n);
    expect(toBaseUnits(".5", 7)).toBe(5_000_000n);
    expect(toBaseUnits("-2.5", 7)).toBe(-25_000_000n);
    expect(toBaseUnits("00012.5000", 7)).toBe(125_000_000n);
  });

  it("accepts finite numbers without float drift", () => {
    expect(toBaseUnits(1.5, 7)).toBe(15_000_000n);
    expect(toBaseUnits(1e-7, 7)).toBe(1n);
  });

  it("treats bigint input as already in base units", () => {
    expect(toBaseUnits(5n, 7)).toBe(5n);
  });

  it("preserves precision for large pool amounts", () => {
    const units = 9_999_999_999_999_999n;
    expect(toBaseUnits("999999999.9999999", 7)).toBe(units);
    expect(fromBaseUnits(units, 7)).toBe("999999999.9999999");
  });

  it("rejects over-precision", () => {
    expect(() => toBaseUnits("0.00000001", 7)).toThrow(RangeError);
  });

  it("rejects invalid input", () => {
    for (const value of ["", "abc", "1,000", "1.2.3", "1e", "--1"]) {
      expect(() => toBaseUnits(value, 7)).toThrow(RangeError);
    }
    expect(() => toBaseUnits(Number.NaN, 7)).toThrow(RangeError);
    expect(() => toBaseUnits(Number.POSITIVE_INFINITY, 7)).toThrow(RangeError);
  });
});

describe("fromBaseUnits", () => {
  it("round-trips and trims trailing zeros", () => {
    expect(fromBaseUnits(0n, 7)).toBe("0");
    expect(fromBaseUnits(1n, 7)).toBe("0.0000001");
    expect(fromBaseUnits(125_000_000n, 7)).toBe("12.5");
    expect(fromBaseUnits(-125_000_000n, 7)).toBe("-12.5");
    expect(fromBaseUnits(12_340_000n, 7)).toBe("1.234");
  });
});

describe("formatTokenAmount", () => {
  it("formats normal amounts", () => {
    expect(formatTokenAmount(125_000_000n)).toBe("12.5");
    expect(formatTokenAmount(0n)).toBe("0");
    expect(formatTokenAmount(-125_000_000n)).toBe("-12.5");
  });

  it("uses zero-subscript for very small non-zero values", () => {
    expect(formatTokenAmount(1n)).toBe("0.0\u20861");
    expect(formatTokenAmount(3_420n, { decimals: 9 })).toBe("0.0\u2085342");
    expect(formatTokenAmount(58_350n, { decimals: 9 })).toBe(
      "0.0\u20845835",
    );
  });

  it("does not use zero-subscript for fewer than three leading zeros", () => {
    expect(formatTokenAmount(10_000n, { decimals: 7 })).toBe("0.001");
  });

  it("rounds when maxFractionDigits is set", () => {
    expect(
      formatTokenAmount(12_500_000n, { maxFractionDigits: 1 }),
    ).toBe("1.3");
    expect(
      formatTokenAmount(12_500_000n, { maxFractionDigits: 0 }),
    ).toBe("1");
  });
});

describe("convenience formatters", () => {
  it("formats USDC amounts", () => {
    expect(usdcToStroops("1.5")).toBe(15_000_000n);
    expect(stroopsToUsdc(15_000_000n)).toBe("1.5");
    expect(formatUsdc(15_000_000n)).toBe("1.5");
    expect(formatUsdc("15")).toBe("0.0\u208515");
  });

  it("formats percentages from basis points", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("0.01%");
    expect(formatPercent(50)).toBe("0.5%");
    expect(formatPercent(100)).toBe("1%");
    expect(formatPercent(2_000)).toBe("20%");
    expect(formatPercent(-2_000)).toBe("-20%");
    expect(formatPercent(Number.NaN)).toBe("--");
  });
});
