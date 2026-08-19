// Unit tests for the shared Soroban event mapper (issue #210)
import { test } from "node:test"
import assert from "node:assert"
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk"
import {
  mapSorobanEvent,
  mapTopicToActivityType,
  type RawSorobanEvent,
} from "./soroban-event-mapping"

const USER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"

function makeEvent(
  topic: string,
  opts: { user?: string; amountStroops?: bigint; value?: xdr.ScVal } = {}
): RawSorobanEvent {
  const topics = [nativeToScVal(topic, { type: "symbol" })]
  if (opts.user) topics.push(new Address(opts.user).toScVal())
  return {
    topic: topics,
    value:
      opts.value ??
      (opts.amountStroops != null
        ? nativeToScVal(opts.amountStroops, { type: "i128" })
        : nativeToScVal(undefined)),
    txHash: "abc123",
    ledger: 55_000,
    ledgerClosedAt: "2026-08-18T10:00:00Z",
  }
}

test("mapTopicToActivityType - known topics translate, unknown return null", () => {
  assert.strictEqual(mapTopicToActivityType("deposit"), "deposit")
  assert.strictEqual(mapTopicToActivityType("payout"), "payout")
  assert.strictEqual(mapTopicToActivityType("withdraw"), "withdraw")
  assert.strictEqual(mapTopicToActivityType("complete"), "complete")
  assert.strictEqual(mapTopicToActivityType("unlocked"), "complete")
  assert.strictEqual(mapTopicToActivityType("refunded"), "withdraw")
  assert.strictEqual(mapTopicToActivityType("yield"), "yield")
  assert.strictEqual(mapTopicToActivityType("transfer"), null)
})

test("mapSorobanEvent - full deposit event maps address, amount, ledger fields", () => {
  const mapped = mapSorobanEvent(makeEvent("deposit", { user: USER, amountStroops: 125_000_000n }))
  assert.ok(mapped)
  assert.strictEqual(mapped.activity_type, "deposit")
  assert.strictEqual(mapped.user_address, USER)
  assert.strictEqual(mapped.amount, 12.5)
  assert.strictEqual(mapped.tx_hash, "abc123")
  assert.strictEqual(mapped.ledger, 55_000)
  assert.strictEqual(mapped.ledgerClosedAt, "2026-08-18T10:00:00Z")
})

test("mapSorobanEvent - unlocked/refunded remap to complete/withdraw", () => {
  assert.strictEqual(mapSorobanEvent(makeEvent("unlocked"))?.activity_type, "complete")
  assert.strictEqual(mapSorobanEvent(makeEvent("refunded"))?.activity_type, "withdraw")
})

test("mapSorobanEvent - untracked topic and empty topics return null", () => {
  assert.strictEqual(mapSorobanEvent(makeEvent("transfer")), null)
  assert.strictEqual(
    mapSorobanEvent({
      topic: [],
      value: nativeToScVal(undefined),
      txHash: "x",
      ledger: 1,
    }),
    null
  )
})

test("mapSorobanEvent - non-numeric value yields null amount, missing close time yields null", () => {
  const mapped = mapSorobanEvent({
    topic: [nativeToScVal("payout", { type: "symbol" })],
    value: nativeToScVal("not-a-number"),
    txHash: "abc",
    ledger: 2,
  })
  assert.ok(mapped)
  assert.strictEqual(mapped.amount, null)
  assert.strictEqual(mapped.user_address, null)
  assert.strictEqual(mapped.ledgerClosedAt, null)
})
