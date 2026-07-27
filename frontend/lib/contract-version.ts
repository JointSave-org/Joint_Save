/**
 * Pure contract-version utility — no React, SDK, or browser dependencies.
 * Shared between production code and unit tests.
 */

/**
 * Check if a contract version is newer than the frontend's known version.
 * Returns true if the contract is running a version the frontend doesn't know about.
 */
export function isContractVersionUnknown(
  contractVersion: number | null,
  knownVersion: number
): boolean {
  if (contractVersion === null) return false
  return contractVersion > knownVersion
}
