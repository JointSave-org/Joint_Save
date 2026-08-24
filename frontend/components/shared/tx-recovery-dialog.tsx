"use client"

/**
 * Recovery dialog for transactions that failed after all retries (or were
 * dropped by the network). Offers "Retry Now" (re-submits the original
 * transaction through its registered retry handler), "View on Explorer",
 * and "Dismiss".
 */

import { useTranslations } from "next-intl"
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { pendingTxLabel } from "@/hooks/usePendingTransactions"
import { DROPPED_TX_ERROR_MARKER, type PendingTransaction } from "@/lib/tx-retry"

const STELLAR_EXPERT_BASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet"

export interface TxRecoveryDialogProps {
  /** Failed transactions, oldest first — the first one is shown. */
  failed: PendingTransaction[]
  /** Hash currently being re-submitted, if any. */
  retryingHash: string | null
  /** Whether a retry handler exists for the hash (re-submittable). */
  canRetry: (hash: string) => boolean
  onRetry: (hash: string) => void
  onDismiss: (hash: string) => void
}

function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash
}

export function TxRecoveryDialog({
  failed,
  retryingHash,
  canRetry,
  onRetry,
  onDismiss,
}: TxRecoveryDialogProps) {
  const t = useTranslations("common.txRecovery")
  const tPendingTx = useTranslations("common.pendingTx")
  const record = failed[0]
  if (!record) return null

  const isRetrying = retryingHash === record.hash
  const wasDropped = record.error === DROPPED_TX_ERROR_MARKER
  const retryAvailable = canRetry(record.hash)

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-[440px] bg-background border border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description", {
              label: pendingTxLabel(record.type, (k) => tPendingTx(k)),
              pool: record.poolName,
              attempts: record.attempts,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border p-3 bg-muted/20">
            <p className="text-muted-foreground text-xs mb-1">{t("hashLabel")}</p>
            <p className="font-mono text-xs break-all" title={record.hash}>
              {shortHash(record.hash)}
            </p>
          </div>

          {record.error && <p className="text-destructive text-xs">{record.error}</p>}

          {wasDropped && <p className="text-xs text-muted-foreground">{t("droppedNotice")}</p>}

          {record.type === "deposit" && (
            <p className="rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">
              {wasDropped ? t("depositSafeDropped") : t("depositNotDeducted")}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onDismiss(record.hash)} disabled={isRetrying}>
            {t("dismiss")}
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open(`${STELLAR_EXPERT_BASE}/tx/${record.hash}`, "_blank")}
            disabled={isRetrying}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("viewOnExplorer")}
          </Button>
          <Button onClick={() => onRetry(record.hash)} disabled={isRetrying || !retryAvailable}>
            {isRetrying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("retrying")}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("retryNow")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
