// Unit tests for member-address validation, focused on duplicate detection.
import { test } from "node:test"
import assert from "node:assert"
import { findDuplicateAddresses, validateStellarAddress } from "./form-validation"

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA"
const C = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA"

test("findDuplicateAddresses - no duplicates returns an empty set", () => {
  const result = findDuplicateAddresses([A, B, C])
  assert.strictEqual(result.size, 0)
})

test("findDuplicateAddresses - flags both the first and later occurrence", () => {
  const result = findDuplicateAddresses([A, B, A])
  assert.deepStrictEqual(result, new Set([0, 2]))
})

test("findDuplicateAddresses - flags every member of a repeated group", () => {
  const result = findDuplicateAddresses([A, A, A])
  assert.deepStrictEqual(result, new Set([0, 1, 2]))
})

test("findDuplicateAddresses - ignores empty entries (covered by other validation)", () => {
  const result = findDuplicateAddresses(["", A, "", B])
  assert.strictEqual(result.size, 0)
})

test("findDuplicateAddresses - trims whitespace before comparing", () => {
  const result = findDuplicateAddresses([A, ` ${A} `])
  assert.deepStrictEqual(result, new Set([0, 1]))
})

test("validateStellarAddress - still rejects malformed addresses independently of duplicate checks", () => {
  assert.strictEqual(validateStellarAddress("not-an-address").valid, false)
})

test("validateStellarAddress - accepts real checksum-valid addresses", () => {
  // Generated via StrKey.encodeEd25519PublicKey — decodable, CRC16-valid strkeys.
  const valid = "GADUCKBBLGEFTAGKVQRK4FYPX4MLE7XL5TZQQI4E7BATRROUE2L2UVDJ"
  assert.strictEqual(validateStellarAddress(valid).valid, true)
})

test("validateStellarAddress - rejects well-formed strings with a bad checksum", () => {
  // 56 chars, correct charset, starts with G — but the CRC16 checksum is wrong,
  // so downstream ScVal encoding (nativeToScVal) would throw on it.
  const badChecksum = "GDXOINK23J7YV2E3ZHKWKW6CWYD2OYBWYO7GWAJ3H5XQ6SJBXMZ6IYJH"
  const result = validateStellarAddress(badChecksum)
  assert.strictEqual(result.valid, false)
  assert.match(result.message, /checksum/i)
})
