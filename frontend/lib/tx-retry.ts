"use client"

/**
 * Automatic transaction retry + pending transaction tracker.
 *
 * `submitWithRetry` wraps the full Soroban submission pipeline
 * (simulate → assemble → sign → send → poll) and transparently retries
 * retriable failures with exponential backoff (2s → 4s → 8s). Before each
 * retry the account's sequence number is re-fetched so the rebuilt
 * transaction never carries a stale nonce.
 *
 * Retriable: network errors, RPC timeouts, `tx_bad_seq`, `tx_insufficient_fee`,
 * `tx_too_late`, congestion/rate-limit responses.
 * NOT retriable (fail immediately): account not found, insufficient balance,
 * auth/rejection errors — these are user errors that retrying won't fix.
 *
 * Idempotency: before every attempt a dedup check looks for a recent pending
 * transaction for the same pool + type; if one exists it is returned instead
 * of broadcasting a duplicate. Broadcast transactions are registered in the
 * `jointsave_pending_txs` tracker so a client-side timeout can never lose a
 * transaction that actually landed.
 */

import {
  Account,
  Transaction,
  rpc,
} from "@stellar/stellar-sdk"
import {
  TX_RETRY_MAX_ATTEMPTS,
  TX_RETRY_BACKOFF_MS,
  TX_CONFIRM_POLL_ATTEMPTS,
  TX_CONFIRM_POLL_INTERVAL_MS,
  PENDING_TX_MAX,
  PENDING_TX_MAX_AGE_MS,
  RECENT_DUPLICATE_WINDOW_MS,
} from "@/lib/constants"
import {
  addPendingTransactionRecord,
  removePendingTransactionRecord,
  type PendingTransactionType as LegacyPendingTransactionType,
  type StorageLike,
} from "@/lib/pending-transactions"

// ── Pending transaction tracker types ────────────────────────────────────────

export type PendingTxType =
  | "deposit"
  | "withdraw"
  | "payout"
  | "emergency_withdraw"
  | "pause"
  | "join"
  | "create"

export interface PendingTransaction {
  hash: string
  type: PendingTxType
  poolId: string
  poolName: string
  submittedAt: number // Date.now()
  status: "pending" | "confirmed" | "failed"
  attempts: number
  lastChecked: number
  error?: string
}

export const PENDING_TXS_STORAGE_KEY = "jointsave_pending_txs"

/** Marker set on records that never entered a ledger (dropped by network). */
export const DROPPED_TX_ERROR_MARKER =
  "Transaction was dropped by the network and never included in a ledger."

// ── Error taxonomy ───────────────────────────────────────────────────────────

/** Transient failures worth retrying (network, timeout, congestion, stale seq). */
export class TxRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TxRetryableError"
  }
}

/** Permanent user-facing failures that must NOT be retried. */
export class TxUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TxUserError"
  }
}

export class TxAccountNotFoundError extends TxUserError {}
export class TxInsufficientBalanceError extends TxUserError {}
export class TxAuthError extends TxUserError {}

const RETRIABLE_MESSAGE_PATTERN =
  /timeout|timed out|network|fetch failed|socket|econn|etimedout|enotfound|rate limit|capacity|throttl|too many requests|try again later|\b429\b|\b503\b|bad_seq|badseq|insufficient_fee|insufficientfee|too_late|toolate|tx_duplicate|duplicate/i

const USER_ERROR_MESSAGE_PATTERN =
  /account not found|does not exist|no account|insufficient balance|underfunded|insufficient funds|bad_auth|badauth|not authorized|authorization|declined|rejected|denied|cancelled|canceled|permission/i

export function isRetriableError(error: unknown): boolean {
  if (error instanceof TxRetryableError) return true
  if (error instanceof TxUserError) return false

  const message = error instanceof Error ? error.message : String(error)
  if (USER_ERROR_MESSAGE_PATTERN.test(message)) return false
  return RETRIABLE_MESSAGE_PATTERN.test(message)
}

/**
 * Classify a send/execution failure (RPC ERROR result or thrown transport
 * error) into a retriable or user error. `tx_failed` (contract invocation
 * rejected) is deterministic for the current on-chain state, so it is
 * surfaced immediately instead of being hammered.
 */
export function classifySubmissionError(error: unknown, rawResult?: unknown): Error {
  if (error instanceof Error && !(error instanceof TxRetryableError)) {
    const detail = JSON.stringify(rawResult ?? "") ?? ""
    const haystack = `${error.message} ${detail}`
    if (/account not found|does not exist|no account/i.test(haystack)) {
      return new TxAccountNotFoundError(error.message)
    }
    if (/insufficient balance|underfunded|insufficient funds/i.test(haystack)) {
      return new TxInsufficientBalanceError(error.message)
    }
    if (
      /bad_auth|badauth|not authorized|authorization|declined|rejected|denied|cancelled|permission/i.test(
        haystack
      )
    ) {
      return new TxAuthError(error.message)
    }
    if (isRetriableError(error) || isRetriableError(new Error(haystack))) {
      return new TxRetryableError(error.message)
    }
    return error instanceof TxUserError ? error : new TxUserError(error.message)
  }
  return error instanceof Error ? error : new Error(String(error))
}

// ── Backoff ──────────────────────────────────────────────────────────────────

export function backoffDelayMs(
  attemptIndex: number,
  schedule: readonly number[] = TX_RETRY_BACKOFF_MS
): number {
  if (attemptIndex < 0) return schedule[0]
  return schedule[Math.min(attemptIndex, schedule.length - 1)] ?? schedule[schedule.length - 1]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Tracker storage (localStorage key: jointsave_pending_txs) ───────────────

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  if (typeof window === "undefined") return null
  return window.localStorage
}

function isPendingTransactionType(value: unknown): value is PendingTxType {
  return (
    value === "deposit" ||
    value === "withdraw" ||
    value === "payout" ||
    value === "emergency_withdraw" ||
    value === "pause" ||
    value === "join" ||
    value === "create"
  )
}

function isPendingTransaction(value: unknown): value is PendingTransaction {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.hash === "string" &&
    isPendingTransactionType(entry.type) &&
    typeof entry.poolId === "string" &&
    typeof entry.poolName === "string" &&
    typeof entry.submittedAt === "number" &&
    Number.isFinite(entry.submittedAt) &&
    (entry.status === "pending" || entry.status === "confirmed" || entry.status === "failed") &&
    typeof entry.attempts === "number" &&
    typeof entry.lastChecked === "number"
  )
}

export function readPendingTxs(storage?: StorageLike): PendingTransaction[] {
  const resolved = getStorage(storage)
  if (!resolved) return []
  try {
    const raw = resolved.getItem(PENDING_TXS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPendingTransaction)
  } catch {
    return []
  }
}

export function writePendingTxs(records: PendingTransaction[], storage?: StorageLike) {
  const resolved = getStorage(storage)
  if (!resolved) return
  if (records.length === 0) {
    resolved.removeItem(PENDING_TXS_STORAGE_KEY)
    return
  }
  resolved.setItem(PENDING_TXS_STORAGE_KEY, JSON.stringify(records))
}

/**
 * Add a transaction to the tracker. Deduped by hash; when the list exceeds
 * `PENDING_TX_MAX` the oldest entries are evicted first.
 */
export function addPendingTx(record: PendingTransaction, storage?: StorageLike) {
  const records = readPendingTxs(storage).filter((entry) => entry.hash !== record.hash)
  records.push(record)
  records.sort((a, b) => a.submittedAt - b.submittedAt)
  const capped = records.slice(Math.max(0, records.length - PENDING_TX_MAX))
  writePendingTxs(capped, storage)
}

export function removePendingTx(hash: string, storage?: StorageLike) {
  writePendingTxs(
    readPendingTxs(storage).filter((entry) => entry.hash !== hash),
    storage
  )
}

export function updatePendingTx(
  hash: string,
  patch: Partial<Omit<PendingTransaction, "hash">>,
  storage?: StorageLike
) {
  const records = readPendingTxs(storage).map((entry) =>
    entry.hash === hash ? { ...entry, ...patch } : entry
  )
  writePendingTxs(records, storage)
}

/** Remove entries older than one hour (and re-apply the size cap). */
export function cleanupPendingTxs(now = Date.now(), storage?: StorageLike) {
  const records = readPendingTxs(storage).filter(
    (entry) => now - entry.submittedAt <= PENDING_TX_MAX_AGE_MS
  )
  records.sort((a, b) => a.submittedAt - b.submittedAt)
  const capped = records.slice(Math.max(0, records.length - PENDING_TX_MAX))
  writePendingTxs(capped, storage)
  return capped
}

/** Dedup key lookup: a recent pending tx for the same pool + type. */
export function findRecentPendingTx(
  poolId: string,
  type: PendingTxType,
  now = Date.now(),
  storage?: StorageLike
): PendingTransaction | null {
  const normalizedPoolId = poolId.trim().toUpperCase()
  return (
    readPendingTxs(storage).find(
      (record) =>
        record.status === "pending" &&
        record.poolId.trim().toUpperCase() === normalizedPoolId &&
        record.type === type &&
        now - record.submittedAt <= RECENT_DUPLICATE_WINDOW_MS
    ) ?? null
  )
}

// ── Retry handler registry (for "Retry Now" in the recovery dialog) ─────────

type RetryHandler = () => Promise<TxResult>
const retryHandlers = new Map<string, RetryHandler>()

export function registerRetryHandler(hash: string, handler: RetryHandler) {
  retryHandlers.set(hash, handler)
}

export function getRetryHandler(hash: string): RetryHandler | undefined {
  return retryHandlers.get(hash)
}

export function clearRetryHandler(hash: string) {
  retryHandlers.delete(hash)
}

/** Test-only escape hatch to reset module state between test cases. */
export function __resetRetryHandlersForTests() {
  retryHandlers.clear()
}

// ── Submission ───────────────────────────────────────────────────────────────

export interface SendTransactionResult {
  status: string
  hash?: string
  errorResult?: unknown
}

export interface RpcLike {
  getAccount(address: string): Promise<Account>
  simulateTransaction(tx: Transaction): Promise<unknown>
  sendTransaction(tx: Transaction): Promise<SendTransactionResult>
  getTransaction(hash: string): Promise<{ status: string }>
}

export interface TxRetryOptions {
  address: string
  networkPassphrase: string
  /** Signs a transaction XDR and resolves with the signed XDR. */
  sign: (xdr: string) => Promise<string>
  /**
   * Builds a fresh transaction from a freshly fetched account so every retry
   * uses the current sequence number. Called once per attempt.
   */
  buildTx: (account: Account) => Transaction
  /** RPC client. Injectable for tests. */
  rpcServer: RpcLike
  /** Prepare the transaction for submission (default: simulate + assemble). */
  prepare?: (tx: Transaction) => Promise<Transaction>
  maxRetries?: number
  backoffMs?: readonly number[]
  pollAttempts?: number
  pollIntervalMs?: number
  /** Idempotency key — a recent pending tx for this pool + type short-circuits. */
  dedup?: { poolId: string; type: PendingTxType }
  /** Register the broadcast transaction in the `jointsave_pending_txs` tracker. */
  track?: { type: PendingTxType; poolId: string; poolName?: string; amount?: string }
  /** Legacy per-address pending record (kept for the existing recovery provider). */
  legacy?: { address: string; type: LegacyPendingTransactionType; poolId: string; amount?: string }
  storage?: StorageLike
  now?: () => number
}

export interface TxResult {
  status: "confirmed" | "pending" | "failed"
  hash: string
  attempts: number
  error?: string
}

function defaultPrepare(tx: Transaction, server: RpcLike): Promise<Transaction> {
  return server.simulateTransaction(tx).then((simResult) => {
    if (rpc.Api.isSimulationError(simResult as rpc.Api.SimulateTransactionResponse)) {
      throw new Error(`Simulation failed: ${(simResult as { error: string }).error}`)
    }
    return rpc
      .assembleTransaction(tx, simResult as rpc.Api.SimulateTransactionResponse)
      .build()
  })
}

interface PollOutcomeHandlers {
  rpcServer: RpcLike
  resolveConfirmed: (hash: string) => void
  markFailed: (hash: string, error: string) => void
  attempts: number
  now: () => number
}

/** Poll the RPC for ledger inclusion. Returns a final TxResult or null. */
async function pollForConfirmation(
  hash: string,
  pollAttempts: number,
  pollIntervalMs: number,
  handlers: PollOutcomeHandlers
): Promise<TxResult | null> {
  for (let pollCount = 0; pollCount < pollAttempts; pollCount++) {
    let status: string
    try {
      status = (await handlers.rpcServer.getTransaction(hash)).status
    } catch {
      status = "NOT_FOUND"
    }

    if (status === "SUCCESS") {
      handlers.resolveConfirmed(hash)
      return { status: "confirmed", hash, attempts: handlers.attempts }
    }
    if (status === "FAILED") {
      const error = `Transaction failed on-chain after ${handlers.attempts} attempt(s).`
      handlers.markFailed(hash, error)
      return { status: "failed", hash, attempts: handlers.attempts, error }
    }

    if (pollCount < pollAttempts - 1) await sleep(pollIntervalMs)
  }
  return null
}

/**
 * Submit a transaction with automatic retry on transient failures.
 *
 * - Re-fetches the account (fresh sequence number) and rebuilds the tx per attempt.
 * - Retries retriable errors up to `maxRetries` with exponential backoff.
 * - Never retries user errors (auth, insufficient balance, account not found).
 * - Returns `{ status: "pending" }` with the broadcast hash when confirmation
 *   is ambiguous after polling — the tracker keeps watching Horizon, so a tx
 *   that landed despite a client-side timeout is never duplicated.
 */
export async function submitWithRetry(options: TxRetryOptions): Promise<TxResult> {
  const {
    address,
    networkPassphrase,
    sign,
    buildTx,
    rpcServer,
    dedup,
    track,
    legacy,
    storage,
    now = Date.now,
  } = options
  const maxRetries = options.maxRetries ?? TX_RETRY_MAX_ATTEMPTS
  const backoff = options.backoffMs ?? [...TX_RETRY_BACKOFF_MS]
  const pollAttempts = options.pollAttempts ?? TX_CONFIRM_POLL_ATTEMPTS
  const pollIntervalMs = options.pollIntervalMs ?? TX_CONFIRM_POLL_INTERVAL_MS
  const prepare = options.prepare ?? ((tx: Transaction) => defaultPrepare(tx, rpcServer))

  const registerRecord = (hash: string, attempts: number) => {
    if (track) {
      addPendingTx(
        {
          hash,
          type: track.type,
          poolId: track.poolId,
          poolName: track.poolName || track.poolId,
          submittedAt: now(),
          status: "pending",
          attempts,
          lastChecked: now(),
        },
        storage
      )
    }
    if (legacy) {
      addPendingTransactionRecord(legacy.address, {
        hash,
        type: legacy.type,
        poolId: legacy.poolId,
        submittedAt: now(),
        amount: legacy.amount,
      })
    }
  }

  const resolveConfirmed = (hash: string) => {
    removePendingTx(hash, storage)
    if (legacy) removePendingTransactionRecord(legacy.address, hash)
    clearRetryHandler(hash)
  }

  const markFailed = (hash: string, error: string) => {
    updatePendingTx(hash, { status: "failed", error, lastChecked: now() }, storage)
    if (legacy) removePendingTransactionRecord(legacy.address, hash)
    clearRetryHandler(hash)
  }

  let attempts = 0
  let lastError: unknown = null

  while (attempts < maxRetries) {
    attempts++

    // Idempotency check — never broadcast a duplicate of a tx that is still
    // in flight for the same pool + type.
    if (dedup) {
      const recent = findRecentPendingTx(dedup.poolId, dedup.type, now(), storage)
      if (recent) {
        return {
          status: "pending",
          hash: recent.hash,
          attempts: recent.attempts + attempts - 1,
        }
      }
    }

    // 1. Fresh account + rebuilt transaction (fresh sequence number).
    let account: Account
    try {
      account = await rpcServer.getAccount(address)
    } catch (error) {
      const classified = classifySubmissionError(error)
      if (classified instanceof TxRetryableError) {
        lastError = classified
        if (attempts < maxRetries) {
          await sleep(backoffDelayMs(attempts - 1, backoff))
          continue
        }
        break
      }
      throw classified
    }

    let tx: Transaction
    try {
      tx = buildTx(account)
    } catch (error) {
      throw classifySubmissionError(error)
    }

    // 2. Simulate + assemble.
    let preparedTx: Transaction
    try {
      preparedTx = await prepare(tx)
    } catch (error) {
      const classified = classifySubmissionError(error)
      if (classified instanceof TxRetryableError) {
        lastError = classified
        if (attempts < maxRetries) {
          await sleep(backoffDelayMs(attempts - 1, backoff))
          continue
        }
        break
      }
      throw classified
    }

    // 3. Sign.
    let signedTxXdr: string
    try {
      signedTxXdr = await sign(preparedTx.toXDR())
    } catch (error) {
      const classified = classifySubmissionError(error)
      if (classified instanceof TxRetryableError) {
        lastError = classified
        if (attempts < maxRetries) {
          await sleep(backoffDelayMs(attempts - 1, backoff))
          continue
        }
        break
      }
      throw classified
    }

    // 4. Send.
    let sendResult: SendTransactionResult
    try {
      sendResult = await rpcServer.sendTransaction(
        new Transaction(signedTxXdr, networkPassphrase)
      )
    } catch (error) {
      const classified = classifySubmissionError(error)
      if (classified instanceof TxRetryableError) {
        lastError = classified
        if (attempts < maxRetries) {
          await sleep(backoffDelayMs(attempts - 1, backoff))
          continue
        }
        break
      }
      throw classified
    }

    if (sendResult.status === "ERROR") {
      // A `tx_duplicate` result means the identical envelope is already
      // queued on the network — treat it as broadcast, never re-submit.
      if (sendResult.hash && /duplicate/i.test(JSON.stringify(sendResult.errorResult ?? ""))) {
        const hash = sendResult.hash
        registerRecord(hash, attempts)
        registerRetryHandler(hash, () => submitWithRetry(options))

        const pollOutcome = await pollForConfirmation(hash, pollAttempts, pollIntervalMs, {
          rpcServer,
          resolveConfirmed,
          markFailed,
          attempts,
          now,
        })
        if (pollOutcome) return pollOutcome
        updatePendingTx(hash, { lastChecked: now() }, storage)
        return { status: "pending", hash, attempts }
      }

      const classified = classifySubmissionError(
        new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`),
        sendResult.errorResult
      )
      if (classified instanceof TxRetryableError) {
        lastError = classified
        if (attempts < maxRetries) {
          await sleep(backoffDelayMs(attempts - 1, backoff))
          continue
        }
        break
      }
      throw classified
    }

    // 5. Broadcast accepted (PENDING / DUPLICATE) — register tracking.
    const hash = sendResult.hash!
    registerRecord(hash, attempts)
    registerRetryHandler(hash, () => submitWithRetry(options))

    // 6. Poll for confirmation.
    const pollOutcome = await pollForConfirmation(hash, pollAttempts, pollIntervalMs, {
      rpcServer,
      resolveConfirmed,
      markFailed,
      attempts,
      now,
    })
    if (pollOutcome) return pollOutcome

    // Confirmation is ambiguous — the tx may still land. Hand it to the
    // tracker rather than resubmitting (never duplicate an in-flight tx).
    updatePendingTx(hash, { lastChecked: now() }, storage)
    return { status: "pending", hash, attempts }
  }

  throw new TxRetryableError(
    `Transaction failed after ${attempts} attempt(s): ${(lastError as Error)?.message ?? "unknown error"}`
  )
}

/** Map a legacy pending type to the tracker's canonical type names. */
export function toTrackedTxType(type: LegacyPendingTransactionType): PendingTxType {
  if (type === "trigger_payout") return "payout"
  return type
}