"use client"

/**
 * Fixed banner shown below the navbar while transactions are pending
 * confirmation on-chain. Shows the transaction type, pool name, and a
 * spinning progress indicator, with an expandable "View Details" section
 * (retry count + last status check). Auto-dismisses with a slide-up
 * animation once all pending transactions resolve. Only visible while a
 * wallet is connected.
 */

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import { pendingTxLabel, usePendingTransactions } from "@/hooks/usePendingTransactions"
import { TxRecoveryDialog } from "@/components/shared/tx-recovery-dialog"

export function PendingTxBanner() {
  const t = useTranslations("common.pendingTx")
  const tBanner = useTranslations("common.pendingBanner")
  const { isConnected } = useStellar()
  const { pending, failed, retryingHash, canRetry, retryTransaction, dismissFailed } =
    usePendingTransactions()

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [hidden, setHidden] = useState(false)
  const hadActiveRef = useRef(false)

  const active = pending.filter((record) => record.status === "pending")

  // Slide-up dismissal once all pending transactions resolve.
  useEffect(() => {
    if (active.length > 0) {
      hadActiveRef.current = true
      setLeaving(false)
      setHidden(false)
      return
    }
    if (!hadActiveRef.current) return
    if (leaving) return
    setLeaving(true)
    const timer = window.setTimeout(() => {
      setHidden(true)
      setLeaving(false)
      hadActiveRef.current = false
      setDetailsOpen(false)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [active.length, leaving])

  // Keep the banner mounted while the slide-up animation plays out.
  const showBanner = isConnected && (active.length > 0 || leaving) && !hidden
  const now = Date.now()

  return (
    <>
      <TxRecoveryDialog
        failed={failed}
        retryingHash={retryingHash}
        canRetry={canRetry}
        onRetry={retryTransaction}
        onDismiss={dismissFailed}
      />

      {showBanner && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed inset-x-0 top-16 z-40 flex justify-center px-4 ${
            leaving ? "animate-slide-up" : ""
          }`}
        >
          <div className="w-full max-w-2xl rounded-lg border border-yellow-500/30 bg-yellow-500/10 shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-3 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600 dark:text-yellow-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                  {active.length === 1
                    ? tBanner("confirmingOne", {
                        label: pendingTxLabel(active[0].type, (k) => t(k)),
                        pool: active[0].poolName,
                      })
                    : tBanner("confirmingMany", { count: active.length })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-yellow-700 hover:bg-yellow-500/10 dark:text-yellow-400"
                aria-expanded={detailsOpen}
              >
                {detailsOpen ? (
                  <>
                    {tBanner("hideDetails")} <ChevronUp className="h-3 w-3" />
                  </>
                ) : (
                  <>
                    {tBanner("viewDetails")} <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            </div>

            {detailsOpen && (
              <div className="border-t border-yellow-500/20 px-4 py-3 space-y-2">
                {active.map((record) => (
                  <div
                    key={record.hash}
                    className="flex items-center justify-between gap-4 text-xs text-yellow-700/90 dark:text-yellow-400/90"
                  >
                    <span className="truncate">
                      {pendingTxLabel(record.type, (k) => t(k))} · {record.poolName}
                    </span>
                    <span className="shrink-0">
                      {tBanner(record.attempts === 1 ? "attempt" : "attempts", {
                        count: record.attempts,
                      })}{" "}
                      · {tBanner("checkedPrefix")} {formatCheckedAt(record.lastChecked, now, tBanner)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function formatCheckedAt(
  timestamp: number,
  now: number,
  t: (key: string, values?: Record<string, number>) => string
): string {
  const diffSecs = Math.max(0, Math.round((now - timestamp) / 1000))
  if (diffSecs < 60) return t("agoSeconds", { n: diffSecs })
  if (diffSecs < 3600) return t("agoMinutes", { n: Math.floor(diffSecs / 60) })
  return t("agoHours", { n: Math.floor(diffSecs / 3600) })
}
