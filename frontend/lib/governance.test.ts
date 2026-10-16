// Unit tests for the governance domain helpers (issue #207)
import { test } from "node:test"
import assert from "node:assert"
import {
  decodeExecutionResult,
  encodeParamHex,
  buildYieldAllocationParams,
  isValidContractId,
  parseAmountToBaseUnits,
  formatTimeRemaining,
  meetsQuorum,
  mergeProposals,
  votesNeededForQuorum,
  type GovernanceProposal,
} from "./governance"

test("votesNeededForQuorum - rounds up to guarantee contract threshold", () => {
  assert.strictEqual(votesNeededForQuorum(51, 3), 2)
  assert.strictEqual(votesNeededForQuorum(50, 3), 2)
  assert.strictEqual(votesNeededForQuorum(51, 100), 51)
  assert.strictEqual(votesNeededForQuorum(66, 3), 2)
})

test("votesNeededForQuorum - degenerate inputs", () => {
  assert.strictEqual(votesNeededForQuorum(0, 5), 0)
  assert.strictEqual(votesNeededForQuorum(51, 0), 0)
  assert.strictEqual(votesNeededForQuorum(NaN, 5), 0)
})

test("meetsQuorum - matches contract votes*100 >= quorum*total check", () => {
  assert.strictEqual(meetsQuorum(2, 51, 3), true)
  assert.strictEqual(meetsQuorum(1, 51, 3), false)
  assert.strictEqual(meetsQuorum(0, 51, 3), false)
  assert.strictEqual(meetsQuorum(1, 50, 2), true)
})

test("formatTimeRemaining - buckets", () => {
  const now = 10_000
  assert.strictEqual(formatTimeRemaining(now + 3600 * 23 + 60 * 12, now), "23h 12m")
  assert.strictEqual(formatTimeRemaining(now + 60 * 5, now), "5m")
  assert.strictEqual(formatTimeRemaining(now + 30, now), "<1m")
  assert.strictEqual(formatTimeRemaining(now - 1, now), "Expired")
  assert.strictEqual(formatTimeRemaining(now, now), "Expired")
})

test("encodeParamHex - produces exactly 16 big-endian bytes", () => {
  assert.strictEqual(encodeParamHex(500), "000000000000000000000000000001f4")
  assert.strictEqual(encodeParamHex(0), "00000000000000000000000000000000")
  assert.strictEqual(
    encodeParamHex(BigInt("340282366920938463463374607431768211455")),
    "ffffffffffffffffffffffffffffffff"
  )
})

test("encodeParamHex - rejects negatives and overflow", () => {
  assert.throws(() => encodeParamHex(-1))
  assert.throws(() => encodeParamHex(1n << 128n))
})

test("decodeExecutionResult - round trips utf8 payload", () => {
  const hex = Buffer.from("quorum=66", "utf8").toString("hex")
  assert.strictEqual(decodeExecutionResult(hex), "quorum=66")
  assert.strictEqual(decodeExecutionResult(""), "")
  assert.strictEqual(decodeExecutionResult("zz"), "")
})

function proposal(id: string, status: GovernanceProposal["status"], createdAt: number) {
  return {
    id,
    proposer: "GPROPOSER",
    proposalType: "ChangeDepositAmount",
    description: "d",
    votesFor: [],
    votesAgainst: [],
    status,
    createdAt,
    expiresAt: createdAt + 172_800,
  } as GovernanceProposal
}

test("mergeProposals - dedupes by id and orders active before terminal states", () => {
  const merged = mergeProposals(
    [proposal("aaa", "Active", 300)],
    [
      proposal("bbb", "Executed", 200),
      proposal("ccc", "Rejected", 400),
      proposal("aaa", "Active", 300),
      proposal("ddd", "Passed", 350),
      proposal("eee", "Expired", 500),
    ]
  )
  assert.deepStrictEqual(
    merged.map((p) => p.id),
    ["aaa", "ddd", "bbb", "ccc", "eee"]
  )
})

test("buildYieldAllocationParams - allocation encodes action, vault and amount", () => {
  const vault = "C" + "A".repeat(55)
  const params = buildYieldAllocationParams({ action: "alloc", vault, amountBaseUnits: 1_500_000n })
  assert.equal(Buffer.from(params.action, "hex").toString("utf8"), "alloc")
  assert.equal(Buffer.from(params.vault, "hex").toString("utf8"), vault)
  assert.equal(params.amount.length, 32)
  assert.equal(BigInt("0x" + params.amount), 1_500_000n)
})

test("buildYieldAllocationParams - de-allocation omits vault", () => {
  const params = buildYieldAllocationParams({ action: "dealloc", amountBaseUnits: 42n })
  assert.equal(Buffer.from(params.action, "hex").toString("utf8"), "dealloc")
  assert.equal(params.vault, undefined)
  assert.equal(BigInt("0x" + params.amount), 42n)
})

test("buildYieldAllocationParams - allocation requires a valid vault", () => {
  assert.throws(() => buildYieldAllocationParams({ action: "alloc", amountBaseUnits: 1n }), /vault required/)
  assert.throws(
    () => buildYieldAllocationParams({ action: "alloc", vault: "nope", amountBaseUnits: 1n }),
    /invalid vault/
  )
})

test("isValidContractId", () => {
  assert.equal(isValidContractId("C" + "A".repeat(55)), true)
  assert.equal(isValidContractId("G" + "A".repeat(55)), false)
  assert.equal(isValidContractId("Cshort"), false)
})

test("parseAmountToBaseUnits", () => {
  assert.equal(parseAmountToBaseUnits("1", 7), 10_000_000n)
  assert.equal(parseAmountToBaseUnits("1.5", 7), 15_000_000n)
  assert.equal(parseAmountToBaseUnits("1,000.25", 7), 10_002_500_000n)
  assert.equal(parseAmountToBaseUnits("0.0000001", 7), 1n)
  assert.equal(parseAmountToBaseUnits("2.123456789", 7), 21_234_567n)
  assert.throws(() => parseAmountToBaseUnits("abc", 7), /invalid amount/)
})
