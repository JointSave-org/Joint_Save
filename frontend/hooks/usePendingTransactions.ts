"use client"

/**
 * Pending transaction tracker hook.
 *
 * Reads/writes the `jointsave_pending_txs` localStorage list, polls Horizon
 * `GET /transactions/{hash}` for every pending transaction on mount and every
 * 10 seconds, and transitions records pending → confirmed / failed.
 *
 * - Confirmed → record removed, relevant pool data/balance/activity refetched.
 * - Failed on-chain → record marked `failed` (the recovery dialog picks it up).
 * - NOT_FOUND past the dropped-tx window → marked failed with a "never landed"
 *   error (funds were not deducted), so deposits can be safely retried.
 * - Entries older than 1 hour are cleaned up on every poll.
 */

import { useCallback, useContext, useEffect, useRef, useState } from "react"
import { useStellar } from "@/components/web3-provider"
import { PoolDataContext } from "@/lib/data-layer/PoolDataProvider"
import { toastManager } from "@/lib/toast"
import {
  cleanupPendingTxs,
  clearRetryHandler,
  DROPPED_TX_ERROR_MARKER,
  getRetryHandler,
  readPendingTxs,
  removePendingTx,
  updatePendingTx,
  type PendingTransaction,
  type PendingTxType,
} from "@/lib/tx-retry"
import { DROPPED_TX_WINDOW_MS, PENDING_TX_POLL_INTERVAL_MS } from "@/lib/constants"

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org"

export type HorizonTxStatus = "confirmed" | "failed" | "not_found"

/** Injectable Horizon checker (used by the component tests). */
export async function checkTxOnHorizon(
  hash: string,
  horizonUrl = HORIZON_URL
): Promise<HorizonTxStatus> {
  try {
    const res = await fetch(`${horizonUrl}/transactions/${hash}`)
    if (res.status === 404) return "not_found"
    if (!res.ok) return "not_found"
    const data = (await res.json()) as { successful?: boolean }
    return data.successful ? "confirmed" : "failed"
  } catch {
    return "not_found"
  }
}

export function pendingTxLabel(type: PendingTxType): string {
  switch (type) {
    case "deposit":
      return "deposit"
    case "withdraw":
      return "withdrawal"
    case "payout":
      return "payout"
    case "emergency_withdraw":
      return "emergency withdrawal"
    case "pause":
      return "pause"
    case "join":
      return "join"
    case "create":
      return "pool creation"
  }
}

function pendingTxSuccessMessage(type: PendingTxType): string {
  return `Your ${pendingTxLabel(type)} completed successfully.`
}

export interface UsePendingTransactionsReturn {
  /** All tracked transactions (pending + failed). */
  pending: PendingTransaction[]
  /** Transactions that failed on-chain or were dropped — recovery candidates. */
  failed: PendingTransaction[]
  /** Hash currently being re-submitted via "Retry Now", if any. */
  retryingHash: string | null
  /** Whether a retry handler is registered for the hash (re-submittable). */
  canRetry: (hash: string) => boolean
  retryTransaction: (hash: string) => Promise<void>
  dismissFailed: (hash: string) => void
  refresh: () => void
}

export function usePendingTransactions(): UsePendingTransactionsReturn {
  const { isConnected } = useStellar()
  const poolData = useContext(PoolDataContext)
  const [records, setRecords] = useState<PendingTransaction[]>([])
  const [retryingHash, setRetryingHash] = useState<string | null>(null)
  const pollInFlight = useRef(false)

  const syncFromStorage = useCallback(() => {
    setRecords(readPendingTxs())
  }, [])

  const refetchPoolData = useCallback(
    (record: PendingTransaction) => {
      if (!poolData) return
      // Background refetch of the affected pool (on-chain state, balance,
      // activity) plus the pool list itself.
      poolData.fetchPool(record.poolId, true).catch(() => {})
      poolData.refresh().catch(() => {})
    },
    [poolData]
  )

  // Initial load + one-hour cleanup on mount.
  useEffect(() => {
    cleanupPendingTxs()
    syncFromStorage()
  }, [syncFromStorage])

  // Horizon polling: on mount and every 10 seconds.
  useEffect(() => {
    if (!isConnected) return

    let cancelled = false

    const poll = async () => {
      if (pollInFlight.current) return
      pollInFlight.current = true

      try {
        const current = readPendingTxs()
        let changed = false

        for (const record of current) {
          if (cancelled) return
          if (record.status !== "pending") continue

          const outcome = await checkTxOnHorizon(record.hash)

          if (outcome === "confirmed") {
            removePendingTx(record.hash)
            clearRetryHandler(record.hash)
            toastManager.success(pendingTxSuccessMessage(record.type))
            refetchPoolData(record)
            changed = true
          } else if (outcome === "failed") {
            updatePendingTx(record.hash, {
              status: "failed",
              error: "Transaction failed on-chain.",
              lastChecked: Date.now(),
            })
            changed = true
          } else if (Date.now() - record.submittedAt >= DROPPED_TX_WINDOW_MS) {
            // Never entered a ledger — safe to retry, funds were not deducted.
            updatePendingTx(record.hash, {
              status: "failed",
              error: DROPPED_TX_ERROR_MARKER,
              lastChecked: Date.now(),
            })
            changed = true
          } else {
            updatePendingTx(record.hash, { lastChecked: Date.now() })
            changed = true
          }
        }

        // One-hour cleanup on every cycle.
        cleanupPendingTxs()
        if (changed) syncFromStorage()
      } finally {
        pollInFlight.current = false
      }
    }

    void poll()
    const interval = window.setInterval(() => {
      void poll()
    }, PENDING_TX_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isConnected, refetchPoolData, syncFromStorage])

  const canRetry = useCallback((hash: string) => getRetryHandler(hash) !== undefined, [])

  const retryTransaction = useCallback(
    async (hash: string) => {
      const record = readPendingTxs().find((entry) => entry.hash === hash)
      if (!record) return
      const handler = getRetryHandler(hash)
      if (!handler) {
        // Retry handler was lost (e.g. page reload) — the tx is still
        // verifiable on-chain, but it must be re-initiated from the pool page.
        removePendingTx(hash)
        syncFromStorage()
        toastManager.error(
          "This transaction can no longer be re-submitted from here. Please try again from the pool page."
        )
        return
      }

      setRetryingHash(hash)
      try {
        const result = await handler()
        clearRetryHandler(hash)

        if (result.status === "confirmed") {
          removePendingTx(hash)
          toastManager.success("Transaction re-submitted and confirmed.")
          refetchPoolData(record)
        } else if (result.status === "pending") {
          // The handler registered a fresh record under a new hash.
          removePendingTx(hash)
          toastManager.info("Transaction re-submitted and is confirming on-chain…")
        } else {
          updatePendingTx(hash, {
            status: "failed",
            error: result.error ?? "Transaction failed.",
            lastChecked: Date.now(),
          })
          toastManager.error(result.error ?? "Transaction failed.")
        }
      } catch (error) {
        const message = (error as Error).message || "Transaction failed"
        updatePendingTx(hash, { status: "failed", error: message, lastChecked: Date.now() })
        toastManager.error(message)
      } finally {
        setRetryingHash(null)
        syncFromStorage()
      }
    },
    [refetchPoolData, syncFromStorage]
  )

  const dismissFailed = useCallback(
    (hash: string) => {
      removePendingTx(hash)
      clearRetryHandler(hash)
      syncFromStorage()
    },
    [syncFromStorage]
  )

  const failed = records.filter((record) => record.status === "failed")

  return {
    pending: records,
    failed,
    retryingHash,
    canRetry,
    retryTransaction,
    dismissFailed,
    refresh: syncFromStorage,
  }
}
