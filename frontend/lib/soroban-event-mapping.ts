/**
 * Pure mapping from raw Soroban contract events to the platform's activity
 * vocabulary. Shared by the client activity hook (fetchContractEvents in
 * hooks/useJointSaveContracts.ts) and the server-side indexer
 * (POST /api/pools/[id]/index-events) — it only touches @stellar/stellar-sdk
 * value types, so it is safe to import from either side.
 */

import { Address, xdr } from "@stellar/stellar-sdk"

function scValToBigInt(val: xdr.ScVal): bigint {
  // i128 / u128 are stored as hi+lo parts
  if (val.switch().name === "scvI128") {
    const parts = val.i128()
    return (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString())
  }
  if (val.switch().name === "scvU128") {
    const parts = val.u128()
    return (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString())
  }
  if (val.switch().name === "scvU64") return BigInt(val.u64().toString())
  if (val.switch().name === "scvI64") return BigInt(val.i64().toString())
  return 0n
}

/**
 * Contract event topic → pool_activity.activity_type.
 * Topics emitted by contracts: "deposit", "payout", "withdraw", "complete",
 * "unlocked", "refunded", "yield".
 */
const EVENT_TYPE_MAP: Record<string, string> = {
  deposit: "deposit",
  payout: "payout",
  withdraw: "withdraw",
  complete: "complete",
  unlocked: "complete",
  refunded: "withdraw",
  yield: "yield",
}

/** Translate a raw event topic symbol to an activity_type, or null if unknown. */
export function mapTopicToActivityType(topic: string): string | null {
  return EVENT_TYPE_MAP[topic] ?? null
}

/** The subset of rpc.Api.EventResponse the mapper reads. */
export interface RawSorobanEvent {
  topic: xdr.ScVal[]
  value: xdr.ScVal
  txHash: string
  ledger: number
  ledgerClosedAt?: string
}

export interface MappedSorobanEvent {
  activity_type: string
  user_address: string | null
  amount: number | null
  tx_hash: string
  ledger: number
  ledgerClosedAt: string | null
}

/**
 * Map one raw contract event to activity fields, or null when the event is not
 * one the activity feed tracks. First topic is the event name symbol; second
 * (optional) topic is the acting address; the value is the amount (i128, in
 * stroops) for deposit/payout/withdraw-style events.
 */
export function mapSorobanEvent(ev: RawSorobanEvent): MappedSorobanEvent | null {
  const topics = ev.topic
  if (!topics.length) return null

  const topicName = topics[0].switch().name === "scvSymbol" ? topics[0].sym().toString() : null
  if (!topicName) return null

  const activity_type = mapTopicToActivityType(topicName)
  if (!activity_type) return null

  let user_address: string | null = null
  if (topics[1]?.switch().name === "scvAddress") {
    try {
      user_address = Address.fromScVal(topics[1]).toString()
    } catch {}
  }

  let amount: number | null = null
  try {
    const val = ev.value
    const sw = val.switch().name
    if (sw === "scvI128" || sw === "scvU128" || sw === "scvU64" || sw === "scvI64") {
      amount = Number(scValToBigInt(val)) / 10_000_000
    }
  } catch {}

  return {
    activity_type,
    user_address,
    amount,
    tx_hash: ev.txHash,
    ledger: ev.ledger,
    ledgerClosedAt: ev.ledgerClosedAt ?? null,
  }
}
