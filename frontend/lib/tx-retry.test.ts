import assert from "node:assert/strict"
import test from "node:test"
import { Account, Asset, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk"
import {
  addPendingTx,
  backoffDelayMs,
  cleanupPendingTxs,
  classifySubmissionError,
  clearRetryHandler,
  findRecentPendingTx,
  getRetryHandler,
  isRetriableError,
  readPendingTxs,
  removePendingTx,
  submitWithRetry,
  TxAccountNotFoundError,
  TxAuthError,
  TxInsufficientBalanceError,
  TxRetryableError,
  updatePendingTx,
  writePendingTxs,
  type PendingTransaction,
  type RpcLike,
  type SendTransactionResult,
  type TxRetryOptions,
} from "./tx-retry"
import { PENDING_TX_MAX, PENDING_TX_MAX_AGE_MS } from "./constants"

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"
const NETWORK = "Test SDF Network ; September 2015"

interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  dump(): Record<string, string>
}

function createStorage(): Storage {
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

interface FakeServerOptions {
  sendResults?: SendTransactionResult[]
  sendError?: unknown
  getAccountError?: unknown
  txStatuses?: Record<string, string>
}

function makeFakeServer(opts: FakeServerOptions = {}) {
  const calls = {
    getAccount: 0,
    send: 0,
  }
  const sequences: string[] = []

  const server: RpcLike = {
    async getAccount(address: string) {
      calls.getAccount++
      if (opts.getAccountError) throw opts.getAccountError
      const seq = String(calls.getAccount)
      sequences.push(seq)
      return new Account(address, seq)
    },
    async simulateTransaction() {
      return { result: { retval: "AAAA" }, transactionData: "AAAA", minResourceFee: "0" }
    },
    async sendTransaction() {
      calls.send++
      if (opts.sendError) throw opts.sendError
      const results = opts.sendResults ?? []
      const idx = calls.send - 1
      const result = idx < results.length ? results[idx] : { status: "PENDING", hash: "hash-final" }
      if (result.status === "ERROR" && !result.errorResult) {
        result.errorResult = { result: { code: "txBadSeq" } }
      }
      return result
    },
    async getTransaction(hash: string) {
      const status = opts.txStatuses?.[hash] ?? "SUCCESS"
      return { status }
    },
  }

  return { server, calls, sequences }
}

function makeOptions(server: RpcLike, overrides: Partial<TxRetryOptions> = {}): TxRetryOptions {
  return {
    address: ADDRESS,
    networkPassphrase: NETWORK,
    sign: async (xdr: string) => xdr,
    buildTx: (account: Account) =>
      new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK,
      })
        .addOperation(
          Operation.payment({
            destination: ADDRESS,
            asset: Asset.native(),
            amount: "1",
          })
        )
        .setTimeout(300)
        .build(),
    rpcServer: server,
    prepare: async (tx) => tx,
    backoffMs: [0, 0, 0],
    pollIntervalMs: 0,
    ...overrides,
  }
}

function pendingRecord(overrides: Partial<PendingTransaction> = {}): PendingTransaction {
  return {
    hash: "hash-1",
    type: "deposit",
    poolId: "CPOOL1",
    poolName: "Pool",
    submittedAt: Date.now() - 10_000,
    status: "pending",
    attempts: 1,
    lastChecked: Date.now() - 10_000,
    ...overrides,
  }
}

test("backoffDelayMs returns the exponential backoff schedule", () => {
  assert.equal(backoffDelayMs(0), 2000)
  assert.equal(backoffDelayMs(1), 4000)
  assert.equal(backoffDelayMs(2), 8000)
  assert.equal(backoffDelayMs(5), 8000) // clamps after the schedule ends
})

test("isRetriableError classifies timeout/network/congestion as retriable", () => {
  assert.equal(isRetriableError(new Error("Request timed out after 5000ms")), true)
  assert.equal(isRetriableError(new TypeError("fetch failed")), true)
  assert.equal(isRetriableError(new Error("tx_bad_seq")), true)
  assert.equal(isRetriableError(new Error("tx_insufficient_fee")), true)
  assert.equal(isRetriableError(new Error("Server is at capacity")), true)
  assert.equal(isRetriableError(new TxRetryableError("boom")), true)
})

test("isRetriableError classifies user errors as non-retriable", () => {
  assert.equal(isRetriableError(new Error("Account not found: GABC")), false)
  assert.equal(isRetriableError(new Error("Insufficient balance")), false)
  assert.equal(isRetriableError(new Error("User declined the request")), false)
  assert.equal(isRetriableError(new Error("tx_bad_auth")), false)
  assert.equal(isRetriableError(new TxAccountNotFoundError("Account not found")), false)
})

test("classifySubmissionError surfaces typed user errors", () => {
  assert.ok(
    classifySubmissionError(new Error("Account not found: GABC")) instanceof TxAccountNotFoundError
  )
  assert.ok(
    classifySubmissionError(new Error("Send failed"), {
      result: { code: "opUnderfunded" },
    }) instanceof TxInsufficientBalanceError
  )
  assert.ok(classifySubmissionError(new Error("Signing declined")) instanceof TxAuthError)
  assert.ok(
    classifySubmissionError(new Error("Send failed"), {
      result: { code: "txInsufficientFee" },
    }) instanceof TxRetryableError
  )
})

test("pending tx tracker persists, updates, and removes records", () => {
  const storage = createStorage()
  writePendingTxs([pendingRecord()], storage)
  assert.equal(readPendingTxs(storage).length, 1)

  updatePendingTx("hash-1", { status: "failed", error: "nope" }, storage)
  assert.equal(readPendingTxs(storage)[0].status, "failed")

  removePendingTx("hash-1", storage)
  assert.equal(readPendingTxs(storage).length, 0)
})

test("addPendingTx evicts the oldest entries beyond the max", () => {
  const storage = createStorage()
  const now = Date.now()
  for (let i = 0; i < PENDING_TX_MAX + 3; i++) {
    addPendingTx(
      pendingRecord({ hash: `hash-${i}`, submittedAt: now - (PENDING_TX_MAX + 3 - i) * 1000 }),
      storage
    )
  }
  const records = readPendingTxs(storage)
  assert.equal(records.length, PENDING_TX_MAX)
  assert.ok(!records.some((r) => r.hash === "hash-0" || r.hash === "hash-1" || r.hash === "hash-2"))
  assert.ok(records.some((r) => r.hash === `hash-${PENDING_TX_MAX + 2}`))
})

test("cleanupPendingTxs removes entries older than one hour", () => {
  const storage = createStorage()
  const now = Date.now()
  addPendingTx(pendingRecord({ hash: "fresh", submittedAt: now - 1_000 }), storage)
  addPendingTx(
    pendingRecord({ hash: "stale", submittedAt: now - PENDING_TX_MAX_AGE_MS - 1_000 }),
    storage
  )
  const kept = cleanupPendingTxs(now, storage)
  assert.deepEqual(
    kept.map((r) => r.hash),
    ["fresh"]
  )
  assert.equal(readPendingTxs(storage).length, 1)
})

test("findRecentPendingTx matches only recent pending records for the same pool + type", () => {
  const storage = createStorage()
  const now = Date.now()
  addPendingTx(
    pendingRecord({ hash: "recent", poolId: "CPOOL1", type: "deposit", submittedAt: now - 60_000 }),
    storage
  )
  addPendingTx(
    pendingRecord({
      hash: "old",
      poolId: "CPOOL1",
      type: "deposit",
      submittedAt: now - 10 * 60_000,
    }),
    storage
  )
  addPendingTx(
    pendingRecord({
      hash: "other-type",
      poolId: "CPOOL1",
      type: "withdraw",
      submittedAt: now - 60_000,
    }),
    storage
  )

  assert.equal(findRecentPendingTx("cpool1", "deposit", now, storage)?.hash, "recent")
  assert.equal(findRecentPendingTx("CPOOL1", "withdraw", now, storage)?.hash, "other-type")
  assert.equal(findRecentPendingTx("CPOOL1", "pause", now, storage), null)
  assert.equal(findRecentPendingTx("CPOOL1", "deposit", now + 3 * 60_000, storage), null)
})

test("submitWithRetry retries transient failures with a fresh sequence per attempt", async () => {
  const { server, calls, sequences } = makeFakeServer({
    sendResults: [
      { status: "ERROR", hash: "hash-1" },
      { status: "ERROR", hash: "hash-2" },
    ],
  })

  const result = await submitWithRetry(
    makeOptions(server, { track: { type: "deposit", poolId: "CPOOL1" } })
  )

  assert.equal(result.status, "confirmed")
  assert.equal(result.hash, "hash-final")
  assert.equal(result.attempts, 3)
  assert.equal(calls.getAccount, 3, "sequence re-fetched before every attempt")
  assert.equal(calls.send, 3)
  assert.deepEqual(sequences, ["1", "2", "3"], "fresh sequence number used per rebuild")
})

test("submitWithRetry never retries account-not-found errors", async () => {
  const { server, calls } = makeFakeServer({
    getAccountError: new Error("Account not found: GABC"),
  })

  await assert.rejects(
    submitWithRetry(makeOptions(server)),
    (error: unknown) => error instanceof TxAccountNotFoundError
  )
  assert.equal(calls.getAccount, 1, "fails immediately without retries")
})

test("submitWithRetry never retries auth rejections", async () => {
  const { server, calls } = makeFakeServer()

  await assert.rejects(
    submitWithRetry(
      makeOptions(server, {
        sign: async () => {
          throw new Error("User declined the request")
        },
      })
    ),
    (error: unknown) => error instanceof TxAuthError
  )
  assert.equal(calls.send, 0)
})

test("submitWithRetry retries tx_bad_seq then confirms", async () => {
  const { server, calls } = makeFakeServer({
    sendResults: [
      { status: "ERROR", hash: "hash-1", errorResult: { result: { code: "txBadSeq" } } },
    ],
  })

  const result = await submitWithRetry(makeOptions(server))
  assert.equal(result.status, "confirmed")
  assert.equal(calls.send, 2)
})

test("submitWithRetry dedupes against an in-flight pending transaction", async () => {
  const storage = createStorage()
  addPendingTx(
    pendingRecord({
      hash: "already-pending",
      poolId: "CPOOL1",
      type: "deposit",
      submittedAt: Date.now() - 30_000,
    }),
    storage
  )
  const { server, calls } = makeFakeServer()

  const result = await submitWithRetry(
    makeOptions(server, { dedup: { poolId: "CPOOL1", type: "deposit" }, storage })
  )

  assert.equal(result.status, "pending")
  assert.equal(result.hash, "already-pending")
  assert.equal(calls.getAccount, 0, "no submission attempt for a deduped tx")
  assert.equal(calls.send, 0)
})

test("submitWithRetry marks the tracker record failed when the tx fails on-chain", async () => {
  const storage = createStorage()
  const { server } = makeFakeServer({
    sendResults: [{ status: "PENDING", hash: "hash-onchain-fail" }],
    txStatuses: { "hash-onchain-fail": "FAILED" },
  })

  const result = await submitWithRetry(
    makeOptions(server, { track: { type: "deposit", poolId: "CPOOL1" }, storage })
  )

  assert.equal(result.status, "failed")
  assert.equal(result.hash, "hash-onchain-fail")
  assert.ok(result.error)
  const records = readPendingTxs(storage)
  assert.equal(records.length, 1)
  assert.equal(records[0].status, "failed")
  assert.equal(records[0].error, result.error)
})

test("submitWithRetry returns pending (with tracking) when confirmation is ambiguous", async () => {
  const storage = createStorage()
  const { server, calls } = makeFakeServer({
    sendResults: [{ status: "PENDING", hash: "hash-ambiguous" }],
    txStatuses: { "hash-ambiguous": "NOT_FOUND" },
  })

  const result = await submitWithRetry(
    makeOptions(server, {
      track: { type: "deposit", poolId: "CPOOL1" },
      storage,
      pollAttempts: 2,
    })
  )

  assert.equal(result.status, "pending")
  assert.equal(result.hash, "hash-ambiguous")
  assert.equal(calls.send, 1, "never re-broadcasts an ambiguous tx")
  const records = readPendingTxs(storage)
  assert.equal(records.length, 1)
  assert.equal(records[0].hash, "hash-ambiguous")
  assert.equal(records[0].status, "pending")
})

test("submitWithRetry treats a duplicate send as a broadcast, not a retry", async () => {
  const { server, calls } = makeFakeServer({
    sendResults: [
      { status: "ERROR", hash: "hash-dup", errorResult: { result: { code: "txDuplicate" } } },
    ],
  })

  const result = await submitWithRetry(makeOptions(server))
  assert.equal(result.status, "confirmed")
  assert.equal(result.hash, "hash-dup")
  assert.equal(calls.send, 1)
})

test("submitWithRetry confirms and removes the tracker record", async () => {
  const storage = createStorage()
  const { server } = makeFakeServer({
    sendResults: [{ status: "PENDING", hash: "hash-good" }],
  })

  const result = await submitWithRetry(
    makeOptions(server, { track: { type: "withdraw", poolId: "CPOOL1" }, storage })
  )

  assert.equal(result.status, "confirmed")
  assert.equal(readPendingTxs(storage).length, 0)
})

test("submitWithRetry registers a retry handler for the broadcast hash", async () => {
  const { server } = makeFakeServer({
    sendResults: [{ status: "PENDING", hash: "hash-handler" }],
    txStatuses: { "hash-handler": "NOT_FOUND" },
  })

  await submitWithRetry(makeOptions(server, { pollAttempts: 1 }))
  const handler = getRetryHandler("hash-handler")
  assert.equal(typeof handler, "function")
  clearRetryHandler("hash-handler")
})
