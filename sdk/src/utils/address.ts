/**
 * Stellar address validation and display helpers.
 *
 * Validation is case-sensitive: Stellar strkeys are uppercase base32, and
 * silently lowercasing invalid input would hide bugs. Callers that accept
 * mixed case should normalise before validating.
 */

/** A 56-character base32 strkey beginning with `G`. */
const ACCOUNT_RE = /^G[A-Z2-7]{55}$/;

/** A 56-character base32 strkey beginning with `C`. */
const CONTRACT_RE = /^C[A-Z2-7]{55}$/;

/** Options for {@link shortAddress}. */
export interface ShortAddressOptions {
  /** Characters to keep from the start. Default: 6. */
  start?: number;
  /** Characters to keep from the end. Default: 4. */
  end?: number;
}

/** True when `address` is a valid Stellar account (`G…`) strkey. */
export function isValidStellarAccount(address: string): boolean {
  return ACCOUNT_RE.test(address);
}

/** True when `id` is a valid Stellar contract (`C…`) strkey. */
export function isValidContractId(id: string): boolean {
  return CONTRACT_RE.test(id);
}

/** True when `value` is a valid Soroban address: an account (`G…`) or contract (`C…`). */
export function isValidSorobanAddress(value: string): boolean {
  return isValidStellarAccount(value) || isValidContractId(value);
}

/**
 * Abbreviate an address for display, e.g. `GABC…WXYZ`.
 *
 * Returns the input unchanged when it is too short to shorten.
 */
export function shortAddress(
  address: string,
  options: ShortAddressOptions = {},
): string {
  const start = options.start ?? 6;
  const end = options.end ?? 4;
  if (start < 0 || end < 0) {
    throw new RangeError("start and end must be non-negative");
  }
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}\u2026${address.slice(-end)}`;
}
