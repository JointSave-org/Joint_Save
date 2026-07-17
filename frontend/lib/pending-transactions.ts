"use client"

export type PendingTransactionType = "deposit" | "withdraw" | "trigger_payout"

export interface PendingTransactionRecord {
  hash: string
  type: PendingTransactionType
  poolId: string
  submittedAt: number
  amount?: string
}

export interface PendingTransactionStatusClient {
  getTransaction(hash: string): Promise<{
    status: "SUCCESS" | "NOT_FOUND" | "FAILED" | string
    resultXdr?: string
    errorResultXdr?: string
  }>
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface RecoveryOutcome {
  record: PendingTransactionRecord
  outcome: "success" | "failed" | "dropped"
  reason?: string
}

export const PENDING_TX_PREFIX = "jointsave:pending-tx:"
export const RECENT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000
export const DROPPED_TX_WINDOW_MS = 5 * 60 * 1000

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  if (typeof window === "undefined") return null
  return window.localStorage
}

function normalizeKeyPart(value: string): string {
  return value.trim().toUpperCase()
}

function isPendingTransactionType(value: string): value is PendingTransactionType {
  return value === "deposit" || value === "withdraw" || value === "trigger_payout"
}

export function pendingTransactionStorageKey(address: string): string {
  return `${PENDING_TX_PREFIX}${normalizeKeyPart(address)}`
}

function readRawRecords(storage: StorageLike, key: string): PendingTransactionRecord[] {
  try {
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is PendingTransactionRecord => {
      return (
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.hash === "string" &&
        typeof entry.type === "string" &&
        isPendingTransactionType(entry.type) &&
        typeof entry.poolId === "string" &&
        typeof entry.submittedAt === "number" &&
        Number.isFinite(entry.submittedAt)
      )
    })
  } catch {
    return []
  }
}

function writeRawRecords(storage: StorageLike, key: string, records: PendingTransactionRecord[]) {
  if (records.length === 0) {
    storage.removeItem(key)
    return
  }
  storage.setItem(key, JSON.stringify(records))
}

export function readPendingTransactionRecords(
  address: string,
  storage?: StorageLike,
): PendingTransactionRecord[] {
  const resolvedStorage = getStorage(storage)
  if (!resolvedStorage) return []
  return readRawRecords(resolvedStorage, pendingTransactionStorageKey(address))
}

export function writePendingTransactionRecords(
  address: string,
  records: PendingTransactionRecord[],
  storage?: StorageLike,
) {
  const resolvedStorage = getStorage(storage)
  if (!resolvedStorage) return
  writeRawRecords(resolvedStorage, pendingTransactionStorageKey(address), records)
}

export function addPendingTransactionRecord(
  address: string,
  record: PendingTransactionRecord,
  storage?: StorageLike,
) {
  const records = readPendingTransactionRecords(address, storage)
  const next = [...records.filter((entry) => entry.hash !== record.hash), record]
  writePendingTransactionRecords(address, next, storage)
}

export function removePendingTransactionRecord(
  address: string,
  hash: string,
  storage?: StorageLike,
) {
  const records = readPendingTransactionRecords(address, storage)
  const next = records.filter((entry) => entry.hash !== hash)
  const resolvedStorage = getStorage(storage)
  if (!resolvedStorage) return
  writeRawRecords(resolvedStorage, pendingTransactionStorageKey(address), next)
}

export function findRecentPendingTransaction(
  address: string,
  poolId: string,
  type: PendingTransactionType,
  now = Date.now(),
  storage?: StorageLike,
): PendingTransactionRecord | null {
  const records = readPendingTransactionRecords(address, storage)
  const normalizedPoolId = normalizeKeyPart(poolId)
  return (
    records.find(
      (record) =>
        normalizeKeyPart(record.poolId) === normalizedPoolId &&
        record.type === type &&
        now - record.submittedAt <= RECENT_DUPLICATE_WINDOW_MS,
    ) ?? null
  )
}

export function pendingTransactionLabel(type: PendingTransactionType): string {
  switch (type) {
    case "deposit":
      return "deposit"
    case "withdraw":
      return "withdrawal"
    case "trigger_payout":
      return "payout trigger"
  }
}

export function pendingTransactionSuccessMessage(type: PendingTransactionType): string {
  switch (type) {
    case "deposit":
      return "Your deposit from earlier completed successfully."
    case "withdraw":
      return "Your withdrawal from earlier completed successfully."
    case "trigger_payout":
      return "Your payout trigger from earlier completed successfully."
  }
}

export function pendingTransactionDroppedMessage(type: PendingTransactionType): string {
  return `A ${pendingTransactionLabel(type)} from earlier may have been dropped. You may need to resubmit it.`
}

export function pendingTransactionFailureMessage(
  type: PendingTransactionType,
  reason?: string,
): string {
  if (reason) {
    return `Your ${pendingTransactionLabel(type)} from earlier failed on-chain. ${reason}`
  }
  return `Your ${pendingTransactionLabel(type)} from earlier failed on-chain.`
}

export async function reconcilePendingTransactions(
  address: string,
  client: PendingTransactionStatusClient,
  storage?: StorageLike,
  now = Date.now(),
): Promise<RecoveryOutcome[]> {
  const records = readPendingTransactionRecords(address, storage).sort(
    (left, right) => left.submittedAt - right.submittedAt,
  )
  const outcomes: RecoveryOutcome[] = []

  for (const record of records) {
    const response = await client.getTransaction(record.hash)

    if (response.status === "SUCCESS") {
      removePendingTransactionRecord(address, record.hash, storage)
      outcomes.push({ record, outcome: "success" })
      continue
    }

    if (response.status === "FAILED") {
      removePendingTransactionRecord(address, record.hash, storage)
      outcomes.push({
        record,
        outcome: "failed",
        reason: response.errorResultXdr ?? response.resultXdr ?? "Transaction failed on-chain.",
      })
      continue
    }

    if (response.status === "NOT_FOUND" && now - record.submittedAt >= DROPPED_TX_WINDOW_MS) {
      removePendingTransactionRecord(address, record.hash, storage)
      outcomes.push({ record, outcome: "dropped" })
    }
  }

  return outcomes
}
