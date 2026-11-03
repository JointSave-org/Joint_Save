/**
 * Stellar & Soroban StrKey address validators and utilities.
 *
 * Rules:
 * - Stellar Account IDs start with 'G' and are 56 uppercase characters (Base32 RFC 4648).
 * - Soroban Contract IDs start with 'C' and are 56 uppercase characters (Base32 RFC 4648).
 * - Strkeys are strictly case-sensitive in this SDK (uppercase only; ARCHITECTURE.md note on strkey casing).
 * - Zero external dependencies (clean, standalone implementation).
 */

const BASE32_REGEX = /^[A-Z2-7]+$/;

/**
 * Validates whether a string is a syntactically valid Stellar Account ID (G...).
 *
 * Requirements:
 * - Length is exactly 56 characters
 * - Starts with 'G'
 * - Composed entirely of uppercase RFC 4648 Base32 characters (A-Z, 2-7)
 * - Does not lowercase or permit lowercase variants
 */
export function isValidStellarAccount(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  if (address.length !== 56) return false;
  if (!address.startsWith('G')) return false;
  return BASE32_REGEX.test(address);
}

/**
 * Validates whether a string is a syntactically valid Soroban Contract ID (C...).
 *
 * Requirements:
 * - Length is exactly 56 characters
 * - Starts with 'C'
 * - Composed entirely of uppercase RFC 4648 Base32 characters (A-Z, 2-7)
 * - Does not lowercase or permit lowercase variants
 */
export function isValidContractId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length !== 56) return false;
  if (!id.startsWith('C')) return false;
  return BASE32_REGEX.test(id);
}

/**
 * Validates whether a string is either a valid Stellar Account ID (G...) or Soroban Contract ID (C...).
 */
export function isValidSorobanAddress(value: unknown): value is string {
  return isValidStellarAccount(value) || isValidContractId(value);
}

export interface ShortAddressOptions {
  /** Number of prefix characters to retain (default: 6) */
  start?: number;
  /** Number of suffix characters to retain (default: 4) */
  end?: number;
  /** Ellipsis separator (default: "…") */
  separator?: string;
}

/**
 * Shortens an address for UI display, e.g. "GABCDE...WXYZ" -> "GABCDE…WXYZ".
 *
 * @param address - Address string to shorten
 * @param opts - Options for customizing prefix/suffix length
 * @returns Shortened string with ellipsis
 */
export function shortAddress(address: string, opts?: ShortAddressOptions): string {
  if (!address || typeof address !== 'string') return '';
  const start = opts?.start ?? 6;
  const end = opts?.end ?? 4;
  const separator = opts?.separator ?? '…';

  if (address.length <= start + end) {
    return address;
  }

  const prefix = address.slice(0, start);
  const suffix = end > 0 ? address.slice(-end) : '';
  return `${prefix}${separator}${suffix}`;
}
