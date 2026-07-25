// Unit tests for contract version checking.
import { test } from "node:test"
import assert from "node:assert"

/**
 * Mirrors the isContractVersionUnknown function from useJointSaveContracts.ts.
 * We duplicate it here to avoid importing React/SDK dependencies in unit tests.
 */
function isContractVersionUnknown(
  contractVersion: number | null,
  knownVersion: number
): boolean {
  if (contractVersion === null) return false
  return contractVersion > knownVersion
}

test("isContractVersionUnknown - returns false when contract version matches known version", () => {
  assert.strictEqual(isContractVersionUnknown(1, 1), false)
})

test("isContractVersionUnknown - returns false when contract version is older than known", () => {
  assert.strictEqual(isContractVersionUnknown(1, 2), false)
})

test("isContractVersionUnknown - returns true when contract version is newer than known", () => {
  assert.strictEqual(isContractVersionUnknown(2, 1), true)
})

test("isContractVersionUnknown - returns false when contract version is null", () => {
  assert.strictEqual(isContractVersionUnknown(null, 1), false)
})

test("isContractVersionUnknown - returns true for v3 vs known v1", () => {
  assert.strictEqual(isContractVersionUnknown(3, 1), true)
})
