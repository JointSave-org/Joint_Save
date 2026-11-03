/**
 * BigInt-safe amount conversion and formatting utilities for Stellar & Soroban tokens.
 *
 * Designed to prevent floating-point drift, precision loss, and silent truncation.
 * Conversion cores operate strictly on BigInt representations of base units (stroops).
 */

const SUBSCRIPT_DIGITS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

function toSubscript(num: number): string {
  return String(num)
    .split('')
    .map((ch) => SUBSCRIPT_DIGITS[ch] ?? ch)
    .join('');
}

/**
 * Converts a human-readable token amount (string, number, or bigint) into base units (BigInt).
 *
 * @param amount - The human-readable decimal amount (e.g. "12.3456789", 100, 50n)
 * @param decimals - Token decimal places (defaults to 7 for Stellar XLM / USDC)
 * @returns BigInt representing integer base units (e.g. 123456789n)
 * @throws RangeError if amount has more fractional digits than allowed by `decimals`
 * @throws TypeError if amount is invalid, NaN, or non-numeric
 */
export function toBaseUnits(amount: string | number | bigint, decimals: number = 7): bigint {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`Decimals must be a non-negative integer, got: ${decimals}`);
  }

  if (typeof amount === 'bigint') {
    return amount * 10n ** BigInt(decimals);
  }

  let str: string;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      throw new TypeError(`Amount must be a finite number, got: ${amount}`);
    }
    // Prevent scientific notation artifacts for realistic numbers
    str = amount.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
  } else if (typeof amount === 'string') {
    str = amount.trim();
  } else {
    throw new TypeError(`Expected amount to be string | number | bigint, got: ${typeof amount}`);
  }

  if (!str || !/^-?\d+(\.\d+)?$/.test(str)) {
    throw new TypeError(`Invalid numeric amount string: "${str}"`);
  }

  const isNegative = str.startsWith('-');
  if (isNegative) {
    str = str.slice(1);
  }

  const parts = str.split('.');
  const intPart = parts[0] || '0';
  const fracPart = parts[1] || '';

  if (fracPart.length > decimals) {
    throw new RangeError(
      `Fractional component "${fracPart}" (${fracPart.length} digits) exceeds maximum decimals of ${decimals}`
    );
  }

  const paddedFrac = fracPart.padEnd(decimals, '0');
  const baseUnits = BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(paddedFrac);

  return isNegative ? -baseUnits : baseUnits;
}

/**
 * Converts integer base units (BigInt) to a canonical human-readable decimal string.
 *
 * @param units - Integer base units
 * @param decimals - Token decimal places (defaults to 7)
 * @returns Formatted decimal string with trailing zeros trimmed (e.g. "12.345")
 */
export function fromBaseUnits(units: bigint, decimals: number = 7): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`Decimals must be a non-negative integer, got: ${decimals}`);
  }

  const isNegative = units < 0n;
  const absUnits = isNegative ? -units : units;

  const divisor = 10n ** BigInt(decimals);
  const intPart = absUnits / divisor;
  const remPart = absUnits % divisor;

  if (decimals === 0 || remPart === 0n) {
    return (isNegative ? '-' : '') + intPart.toString();
  }

  const fracStr = remPart.toString().padStart(decimals, '0');
  const trimmedFrac = fracStr.replace(/0+$/, '');

  const sign = isNegative ? '-' : '';
  return trimmedFrac.length > 0 ? `${sign}${intPart}.${trimmedFrac}` : `${sign}${intPart}`;
}

/** Convenience wrapper: Convert human USDC value to stroops (7 decimals). */
export function usdcToStroops(value: string | number | bigint): bigint {
  return toBaseUnits(value, 7);
}

/** Convenience wrapper: Convert stroops (7 decimals) to decimal USDC string. */
export function stroopsToUsdc(stroops: bigint): string {
  return fromBaseUnits(stroops, 7);
}

export interface FormatTokenAmountOptions {
  decimals?: number;
  maxFractionDigits?: number;
  /** Threshold of consecutive zeros after decimal before triggering subscript notation (default: 4) */
  subscriptThreshold?: number;
}

/**
 * Formats token base units into a clean, display-ready string.
 *
 * Handles:
 * - Trailing-zero trimming
 * - Optional maxFractionDigits rounding
 * - Zero-subscript notation for micro-values (e.g. 0.00000342 -> "0.0₅342")
 */
export function formatTokenAmount(units: bigint, opts?: FormatTokenAmountOptions): string {
  const decimals = opts?.decimals ?? 7;
  const maxFractionDigits = opts?.maxFractionDigits;
  const subscriptThreshold = opts?.subscriptThreshold ?? 4;

  const raw = fromBaseUnits(units, decimals);
  if (!raw.includes('.')) {
    return raw;
  }

  const [intPart, fracPart] = raw.split('.') as [string, string];

  // Check for zero-subscript format: e.g. 0.00000342 (intPart == "0", >= threshold consecutive zeros)
  if (intPart === '0' && fracPart.length >= subscriptThreshold) {
    const zeroMatch = fracPart.match(/^(0{4,})(\d*)$/);
    if (zeroMatch && zeroMatch[1] && zeroMatch[2]) {
      const zeroCount = zeroMatch[1].length;
      const rest = zeroMatch[2];
      return `0.0${toSubscript(zeroCount)}${rest}`;
    }
  }

  if (maxFractionDigits !== undefined && maxFractionDigits >= 0) {
    if (maxFractionDigits === 0) {
      return intPart;
    }
    const truncatedFrac = fracPart.slice(0, maxFractionDigits).replace(/0+$/, '');
    return truncatedFrac.length > 0 ? `${intPart}.${truncatedFrac}` : intPart;
  }

  return raw;
}

/**
 * Formats a USDC amount into a human-readable display string.
 */
export function formatUsdc(units: bigint | string): string {
  const parsedUnits = typeof units === 'bigint' ? units : BigInt(units);
  return formatTokenAmount(parsedUnits, { decimals: 7 });
}

/**
 * Formats basis points (bps) into a human percentage string.
 * e.g. 100 bps -> "1%", 50 bps -> "0.5%", 125 bps -> "1.25%"
 */
export function formatPercent(bps: number): string {
  if (!Number.isFinite(bps)) {
    throw new TypeError(`bps must be a finite number, got: ${bps}`);
  }
  const pct = bps / 100;
  // Format cleanly without trailing .00
  const formatted = pct.toLocaleString('en-US', {
    maximumFractionDigits: 4,
    useGrouping: false,
  });
  return `${formatted}%`;
}
