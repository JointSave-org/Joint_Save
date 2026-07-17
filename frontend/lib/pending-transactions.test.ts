import assert from "node:assert/strict"
import test from "node:test"
import {
  addPendingTransactionRecord,
  reconcilePendingTransactions,
  findRecentPendingTransaction,
  pendingTransactionStorageKey,
  readPendingTransactionRecords,
  removePendingTransactionRecord,
  type StorageLike,
} from "./pending-transactions"

function createStorage(): StorageLike & { dump(): Record<string, string> } {
  const state = new Map<string, string>()
  return {
    getItem(key: string) {
      return state.get(key) ?? null
    },
    setItem(key: string, value: string) {
      state.set(key, value)
    },
    removeItem(key: string) {
      state.delete(key)
    },
    dump() {
      return Object.fromEntries(state.entries())
    },
  }
}

test("pendingTransactionStorageKey normalizes the address", () => {
  assert.equal(
    pendingTransactionStorageKey("gaaa-bbbb-cccc"),
    "jointsave:pending-tx:GAAA-BBBB-CCCC",
  )
})

test("pending transaction records are stored, read, and removed", () => {
  const storage = createStorage()
  const address = "gabcdef"
  const record = {
    hash: "hash-1",
    type: "deposit" as const,
    poolId: "pool-1",
    submittedAt: 1_000,
    amount: "100",
  }

  addPendingTransactionRecord(address, record, storage)
  assert.deepEqual(readPendingTransactionRecords(address, storage), [record])

  removePendingTransactionRecord(address, record.hash, storage)
  assert.deepEqual(readPendingTransactionRecords(address, storage), [])
})

test("findRecentPendingTransaction only matches recent same-pool same-type records", () => {
  const storage = createStorage()
  const address = "gabcdef"
  const recent = {
    hash: "hash-1",
    type: "withdraw" as const,
    poolId: "pool-1",
    submittedAt: Date.now() - 60_000,
  }
  const old = {
    hash: "hash-2",
    type: "withdraw" as const,
    poolId: "pool-1",
    submittedAt: Date.now() - 10 * 60_000,
  }

  addPendingTransactionRecord(address, recent, storage)
  addPendingTransactionRecord(address, old, storage)

  assert.equal(findRecentPendingTransaction(address, "pool-1", "withdraw", Date.now(), storage)?.hash, "hash-1")
  assert.equal(findRecentPendingTransaction(address, "pool-1", "deposit", Date.now(), storage), null)
})

test("reconcilePendingTransactions clears resolved records and surfaces failure reasons", async () => {
  const storage = createStorage()
  const address = "gabcdef"
  const successRecord = {
    hash: "hash-success",
    type: "deposit" as const,
    poolId: "pool-1",
    submittedAt: 1_000,
  }
  const failedRecord = {
    hash: "hash-failed",
    type: "withdraw" as const,
    poolId: "pool-2",
    submittedAt: 2_000,
  }

  addPendingTransactionRecord(address, successRecord, storage)
  addPendingTransactionRecord(address, failedRecord, storage)

  const outcomes = await reconcilePendingTransactions(
    address,
    {
      async getTransaction(hash: string) {
        if (hash === successRecord.hash) {
          return { status: "SUCCESS" }
        }
        return { status: "FAILED", errorResultXdr: "tx_failed_xdr" }
      },
    },
    storage,
    3_000,
  )

  assert.deepEqual(outcomes, [
    { record: successRecord, outcome: "success" },
    { record: failedRecord, outcome: "failed", reason: "tx_failed_xdr" },
  ])
  assert.deepEqual(readPendingTransactionRecords(address, storage), [])
})

test("reconcilePendingTransactions keeps recent not-found records but removes stale ones", async () => {
  const storage = createStorage()
  const address = "gabcdef"
  const recent = {
    hash: "hash-recent",
    type: "trigger_payout" as const,
    poolId: "pool-1",
    submittedAt: Date.now() - 60_000,
  }
  const stale = {
    hash: "hash-stale",
    type: "trigger_payout" as const,
    poolId: "pool-1",
    submittedAt: Date.now() - 6 * 60_000,
  }

  addPendingTransactionRecord(address, recent, storage)
  addPendingTransactionRecord(address, stale, storage)

  const outcomes = await reconcilePendingTransactions(
    address,
    {
      async getTransaction() {
        return { status: "NOT_FOUND" }
      },
    },
    storage,
    Date.now(),
  )

  assert.deepEqual(outcomes, [{ record: stale, outcome: "dropped" }])
  assert.deepEqual(readPendingTransactionRecords(address, storage), [recent])
})
