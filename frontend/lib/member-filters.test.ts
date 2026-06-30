// Unit tests for the pure member deposit-status filter helpers.
import { test } from "node:test"
import assert from "node:assert"
import { isPendingMember, countPendingMembers, filterPendingMembers } from "./member-filters"

// Build a minimal member with a given status.
function member(status: string) {
  return { status }
}

test("countPendingMembers - empty array is zero", () => {
  assert.strictEqual(countPendingMembers([]), 0)
})

test("countPendingMembers - counts only pending, ignoring paid and late", () => {
  const members = [member("pending"), member("paid"), member("late"), member("pending")]
  assert.strictEqual(countPendingMembers(members), 2)
})

test("countPendingMembers - all paid is zero", () => {
  const members = [member("paid"), member("paid")]
  assert.strictEqual(countPendingMembers(members), 0)
})

test("filterPendingMembers - empty array returns empty", () => {
  assert.deepStrictEqual(filterPendingMembers([]), [])
})

test("filterPendingMembers - returns only the pending members", () => {
  const pendingA = member("pending")
  const pendingB = member("pending")
  const members = [pendingA, member("paid"), member("late"), pendingB]
  assert.deepStrictEqual(filterPendingMembers(members), [pendingA, pendingB])
})

test("isPendingMember - true only for pending status", () => {
  assert.strictEqual(isPendingMember(member("pending")), true)
  assert.strictEqual(isPendingMember(member("paid")), false)
  assert.strictEqual(isPendingMember(member("late")), false)
})
