/**
 * BigInt-safe amount conversion and formatting.
 *
 * The conversion core is integer-only: balances never pass through `Number`.
 * `number` inputs are accepted for convenience but are converted via their
 * shortest decimal representation, never through floating-point arithmetic.
 */
import { USDC_DECIMALS } from "../constants";

/** Options for {@link formatTokenAmount}. */
export interface FormatTokenAmountOptions {
  /** Token decimal places. Default: 7. */
  decimals?: number;
  /** Maximum fraction digits to display. Default: `decimals`. */
  maxFractionDigits?: number;
  /** Significant digits used by zero-subscript formatting. Default: 4. */
  significantDigits?: number;
}

const SUBSCRIPT_DIGITS: Record<string, string> = {
  "0": "\u2080",
  "1": "\u2081",
  "2": "\u2082",
  "3": "\u2083",
  "4": "\u2084",
  "5": "\u2085",
  "6": "\u2086",
  "7": "\u2087",
  "8": "\u2088",
  "9": "\u2089",
};

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new RangeError(`decimals must be an integer between 0 and 36`);
  }
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Expand scientific notation (`1.5e-7`) into a plain decimal string. */
function expandExponential(value: string): string {
  if (!/[eE]/.test(value)) return value;
  const match = value.match(
    /^([+-]?)(\d+(?:\.\d*)?|\.\d+)[eE]([+-]?\d+)$/,
  );
  if (!match) return value;
  const sign = match[1] ?? "";
  const mantissa = match[2] ?? "";
  const exponent = Number.parseInt(match[3] ?? "0", 10);
  const [intPart = "0", fracPart = ""] = mantissa.split(".");
  const digits = intPart + fracPart;
  const point = intPart.length + exponent;

  let expanded: string;
  if (point <= 0) {
    expanded = `0.${"0".repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    expanded = `${digits}${"0".repeat(point - digits.length)}`;
  } else {
    expanded = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return `${sign}${expanded}`;
}

function normalizeWhole(whole: string): string {
  const stripped = whole.replace(/^0+(?=\d)/, "");
  return stripped === "" ? "0" : stripped;
}

/**
 * Convert a human-readable amount into token base units.
 *
 * @param amount - Decimal string (e.g. `"12.50"`), finite number, or a
 *   `bigint` that is **already in base units** (returned unchanged).
 * @param decimals - Token decimals. Default: 7.
 * @throws {RangeError} on invalid input or more fractional digits than `decimals`.
 *
 * @example
 * ```ts
 * toBaseUnits("12.5", 7); // 125_000_000n
 * toBaseUnits(5n, 7);     // 5n (treated as base units)
 * ```
 */
export function toBaseUnits(
  amount: string | number | bigint,
  decimals: number = USDC_DECIMALS,
): bigint {
  assertDecimals(decimals);
  if (typeof amount === "bigint") return amount;

  let raw: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      throw new RangeError("Amount must be a finite number");
    }
    raw = expandExponential(amount.toString());
  } else {
    raw = expandExponential(amount.trim());
  }

  const match = raw.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)$/);
  if (!match) {
    throw new RangeError(`Invalid amount: "${String(amount)}"`);
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const unsigned = match[2] ?? "0";
  const [wholePart = "0", fracPart = ""] = unsigned.split(".");
  if (fracPart.length > decimals) {
    throw new RangeError(
      `Amount has more than ${decimals} decimal places: "${String(amount)}"`,
    );
  }

  const whole = normalizeWhole(wholePart);
  const fraction = fracPart.padEnd(decimals, "0");
  const units =
    BigInt(whole) * pow10(decimals) + BigInt(fraction === "" ? "0" : fraction);
  return sign * units;
}

interface SplitUnits {
  negative: boolean;
  whole: string;
  fraction: string;
}

function splitUnits(units: bigint, decimals: number): SplitUnits {
  assertDecimals(decimals);
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const divisor = pow10(decimals);
  const whole = absolute / divisor;
  const fraction =
    decimals === 0
      ? ""
      : (absolute % divisor).toString().padStart(decimals, "0");
  return { negative, whole: whole.toString(), fraction };
}

/** Round a base-unit value to fewer decimals, half-up, using integers. */
function roundUnits(units: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (toDecimals >= fromDecimals) return units;
  const factor = pow10(fromDecimals - toDecimals);
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const quotient = absolute / factor;
  const remainder = absolute % factor;
  const rounded = remainder * 2n >= factor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Convert base units back to a plain decimal string.
 *
 * Trailing zeros are trimmed, no thousands separators, no zero-subscript.
 *
 * @example
 * ```ts
 * fromBaseUnits(125_000_000n, 7); // "12.5"
 * fromBaseUnits(1n, 7);           // "0.0000001"
 * ```
 */
export function fromBaseUnits(
  units: bigint,
  decimals: number = USDC_DECIMALS,
): string {
  const { negative, whole, fraction } = splitUnits(units, decimals);
  const trimmed = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

function countLeadingZeros(fraction: string): number {
  let count = 0;
  for (const char of fraction) {
    if (char !== "0") break;
    count += 1;
  }
  return count;
}

function toSubscript(value: number): string {
  return String(value)
    .split("")
    .map((digit) => SUBSCRIPT_DIGITS[digit] ?? digit)
    .join("");
}

/**
 * Format a base-unit amount for display.
 *
 * Very small non-zero values use zero-subscript notation once there are three
 * or more leading zeros after the decimal point, e.g. `0.0₅342`. Trailing
 * zeros are trimmed. No thousands separators are added (that is a UI concern).
 *
 * @example
 * ```ts
 * formatTokenAmount(125_000_000n);      // "12.5"
 * formatTokenAmount(3_420n, { decimals: 9 }); // "0.0₅342"
 * ```
 */
export function formatTokenAmount(
  units: bigint,
  options: FormatTokenAmountOptions = {},
): string {
  const decimals = options.decimals ?? USDC_DECIMALS;
  const maxFractionDigits = options.maxFractionDigits ?? decimals;
  const significantDigits = Math.max(1, options.significantDigits ?? 4);
  assertDecimals(decimals);
  assertDecimals(maxFractionDigits);

  const rounded = roundUnits(units, decimals, maxFractionDigits);
  const { negative, whole, fraction } = splitUnits(rounded, maxFractionDigits);
  const sign = negative ? "-" : "";

  if (whole === "0" && /[1-9]/.test(fraction)) {
    const leadingZeros = countLeadingZeros(fraction);
    if (leadingZeros >= 3) {
      const significant = fraction
        .slice(leadingZeros, leadingZeros + significantDigits)
        .replace(/0+$/, "");
      return `${sign}0.0${toSubscript(leadingZeros)}${significant}`;
    }
  }

  const trimmed = fraction.replace(/0+$/, "");
  return `${sign}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

/** Format a USDC amount (7 decimals) for display. */
export function formatUsdc(units: bigint | string): string {
  const value = typeof units === "string" ? BigInt(units) : units;
  return formatTokenAmount(value, { decimals: USDC_DECIMALS });
}

/** Format basis points as a percentage, e.g. `2000` → `"20%"`. */
export function formatPercent(bps: number): string {
  if (!Number.isFinite(bps)) return "--";
  const negative = bps < 0;
  const abs = Math.abs(Math.trunc(bps));
  const whole = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}%`;
}

/** Convert a human USDC value to stroops. */
export function usdcToStroops(value: string | number): bigint {
  return toBaseUnits(value, USDC_DECIMALS);
}

/** Convert stroops to a human USDC decimal string. */
export function stroopsToUsdc(stroops: bigint): string {
  return fromBaseUnits(stroops, USDC_DECIMALS);
}
