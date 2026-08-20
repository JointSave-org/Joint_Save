"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Layers, RefreshCw, AlertTriangle } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import { useBatchDeposit } from "@/hooks/useBatchDeposit"
import { BatchDepositProgress } from "@/components/dashboard/batch-deposit-progress"
import { toastManager } from "@/lib/toast"
import {
  MAX_TX_PER_BATCH,
  chunk,
  depositUrgency,
  formatBatchSummary,
  summarizeSelection,
} from "@/lib/batch-deposit"

/**
 * Dashboard panel that collects every rotational pool still owed a deposit
 * this round and deposits to the selected ones in one guided run.
 *
 * Rendered on the "My Groups" tab; renders nothing at all when the connected
 * wallet owes no deposits.
 */
export function BatchDepositPanel({ onDepositsComplete }: { onDepositsComplete?: () => void }) {
  const { address } = useStellar()
  const {
    pools,
    isScanning,
    scanError,
    hasScanned,
    refresh,
    buildBatchDepositTx,
    submitBatchDeposit,
    retryFailed,
    cancel,
    reset,
    items,
    isSubmitting,
  } = useBatchDeposit()

  const [open, setOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Default to depositing to everything that's owed, and drop selections for
  // pools that dropped out of the list on the last refresh.
  useEffect(() => {
    setSelectedIds(pools.map((p) => p.id))
  }, [pools])

  const summary = useMemo(() => summarizeSelection(pools, selectedIds), [pools, selectedIds])

  /** Everything owed, regardless of the current selection — shown on the card. */
  const owedSummary = useMemo(
    () =>
      summarizeSelection(
        pools,
        pools.map((p) => p.id)
      ),
    [pools]
  )

  const batchCount = useMemo(() => chunk(selectedIds, MAX_TX_PER_BATCH).length, [selectedIds])

  const hasRun = items.length > 0
  const failedCount = items.filter((i) => i.status === "failed" || i.status === "cancelled").length
  const confirmedCount = items.filter((i) => i.status === "confirmed").length

  const toggle = useCallback((poolId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...new Set([...prev, poolId])] : prev.filter((id) => id !== poolId)
    )
  }, [])

  const runBatch = useCallback(async () => {
    const selected = pools.filter((p) => selectedIds.includes(p.id))
    if (selected.length === 0) return

    try {
      const plan = buildBatchDepositTx(selected)
      if (plan.splitMessage) toastManager.info(plan.splitMessage)

      const result = await submitBatchDeposit(plan)

      if (result.failed.length === 0 && result.cancelled.length === 0) {
        toastManager.success(
          `Deposited to ${result.confirmed.length} ${
            result.confirmed.length === 1 ? "pool" : "pools"
          }`
        )
      } else {
        toastManager.warning(
          `${result.confirmed.length} of ${plan.totalTransactions} deposits confirmed — ${
            result.failed.length + result.cancelled.length
          } still outstanding`
        )
      }
    } catch (err) {
      toastManager.error(err instanceof Error ? err.message : "Batch deposit failed")
    }
  }, [pools, selectedIds, buildBatchDepositTx, submitBatchDeposit])

  const runRetry = useCallback(async () => {
    try {
      const result = await retryFailed()
      if (!result) return
      if (result.failed.length === 0 && result.cancelled.length === 0) {
        toastManager.success("All outstanding deposits confirmed")
      }
    } catch (err) {
      toastManager.error(err instanceof Error ? err.message : "Retry failed")
    }
  }, [retryFailed])

  /**
   * Notify the parent only once the dialog is dismissed.
   *
   * The dashboard reloads its pool list in response, and that reload swaps
   * "My Groups" to its loading skeleton — which unmounts this panel. Firing
   * it while the run is still on screen would therefore tear down the dialog
   * and the progress list the user is reading.
   */
  const closeDialog = useCallback(() => {
    if (isSubmitting) return
    const depositedSomething = items.some((i) => i.status === "confirmed")
    setOpen(false)
    reset()
    void refresh()
    if (depositedSomething) onDepositsComplete?.()
  }, [isSubmitting, items, reset, refresh, onDepositsComplete])

  // Nothing owed (or no wallet) → the panel stays out of the way entirely.
  if (!address || !hasScanned || (pools.length === 0 && !scanError)) return null

  if (scanError) {
    return (
      <Card className="p-4" data-testid="batch-deposit-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
            Couldn&apos;t check which pools need a deposit — {scanError}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={isScanning}>
            <RefreshCw
              className={`size-4 ${isScanning ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Retry
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card className="border-primary/30 bg-primary/5 p-4" data-testid="batch-deposit-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <Layers className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold">
                {pools.length} {pools.length === 1 ? "pool needs" : "pools need"} a deposit
              </p>
              <p className="text-sm text-muted-foreground">{formatBatchSummary(owedSummary)}</p>
            </div>
          </div>

          <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
            <Layers className="size-4" aria-hidden="true" />
            Batch Deposit
          </Button>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeDialog())}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          data-testid="batch-deposit-dialog"
        >
          <DialogHeader>
            <DialogTitle>Batch Deposit</DialogTitle>
            <DialogDescription>
              Each pool is deposited to in its own Stellar transaction — Soroban allows one contract
              call per transaction. They&apos;re signed one after another, and a pool that fails
              doesn&apos;t affect the others.
            </DialogDescription>
          </DialogHeader>

          {hasRun ? (
            <BatchDepositProgress items={items} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {selectedIds.length} of {pools.length} selected
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedIds(pools.map((p) => p.id))}
                    disabled={selectedIds.length === pools.length}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedIds([])}
                    disabled={selectedIds.length === 0}
                  >
                    Deselect All
                  </Button>
                </div>
              </div>

              <ul className="space-y-2" data-testid="batch-deposit-pool-list">
                {pools.map((pool) => {
                  const urgency = depositUrgency(pool.deadline)
                  const checked = selectedIds.includes(pool.id)
                  return (
                    <li key={pool.id}>
                      <label
                        htmlFor={`batch-pool-${pool.id}`}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                        data-testid={`batch-pool-row-${pool.id}`}
                      >
                        <Checkbox
                          id={`batch-pool-${pool.id}`}
                          checked={checked}
                          onCheckedChange={(value) => toggle(pool.id, value === true)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">{pool.name}</span>
                            <Badge
                              variant="secondary"
                              className={`border-0 ${urgency.className}`}
                              data-testid={`batch-urgency-${pool.id}`}
                            >
                              {urgency.label}
                            </Badge>
                          </span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            {pool.amount} {pool.tokenSymbol} · round {pool.round}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>

              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-sm font-medium" data-testid="batch-total">
                  {formatBatchSummary(summary)}
                </p>
                {batchCount > 1 && (
                  <p
                    className="mt-1 text-xs text-muted-foreground"
                    data-testid="batch-split-notice"
                  >
                    Split into {batchCount} batches due to transaction size limits — up to{" "}
                    {MAX_TX_PER_BATCH} transactions each.
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {hasRun ? (
              <>
                {isSubmitting ? (
                  <Button variant="outline" onClick={cancel} data-testid="batch-cancel">
                    Stop after current
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={closeDialog} data-testid="batch-close">
                      Close
                    </Button>
                    {failedCount > 0 && (
                      <Button onClick={() => void runRetry()} data-testid="batch-retry-failed">
                        <RefreshCw className="size-4" aria-hidden="true" />
                        Retry {failedCount} failed
                      </Button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void runBatch()}
                  disabled={selectedIds.length === 0}
                  data-testid="batch-deposit-now"
                >
                  Deposit Now
                </Button>
              </>
            )}
          </DialogFooter>

          {hasRun && !isSubmitting && confirmedCount > 0 && (
            <p className="text-sm text-muted-foreground" data-testid="batch-run-summary">
              {confirmedCount} {confirmedCount === 1 ? "deposit" : "deposits"} confirmed
              {failedCount > 0 ? `, ${failedCount} still outstanding` : ""}.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
