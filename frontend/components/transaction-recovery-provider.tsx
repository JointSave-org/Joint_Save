"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { rpc } from "@stellar/stellar-sdk"
import { useStellar, STELLAR_RPC_URL } from "@/components/web3-provider"
import { toastManager } from "@/lib/toast"
import {
  reconcilePendingTransactions,
  pendingTransactionDroppedMessage,
  pendingTransactionFailureMessage,
  pendingTransactionSuccessMessage,
} from "@/lib/pending-transactions"

const RECOVERY_SCAN_INTERVAL_MS = 15_000

export function TransactionRecoveryProvider({ children }: { children: ReactNode }) {
  const { address } = useStellar()
  const scanInFlight = useRef(false)

  useEffect(() => {
    if (!address) return

    let cancelled = false
    const server = new rpc.Server(STELLAR_RPC_URL)

    const scan = async () => {
      if (scanInFlight.current) return
      scanInFlight.current = true

      try {
        const outcomes = await reconcilePendingTransactions(address, server)
        if (cancelled) return

        for (const outcome of outcomes) {
          if (outcome.outcome === "success") {
            toastManager.success(pendingTransactionSuccessMessage(outcome.record.type))
          } else if (outcome.outcome === "failed") {
            toastManager.error(
              pendingTransactionFailureMessage(outcome.record.type, outcome.reason),
            )
          } else {
            toastManager.warning(pendingTransactionDroppedMessage(outcome.record.type))
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to recover pending transactions", error)
        }
      } finally {
        scanInFlight.current = false
      }
    }

    void scan()
    const interval = window.setInterval(() => {
      void scan()
    }, RECOVERY_SCAN_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [address])

  return <>{children}</>
}
