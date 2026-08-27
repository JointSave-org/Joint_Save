"use client"

import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { AlertCircle, CheckCircle2, Clock, MinusCircle, PenLine, Send } from "lucide-react"
import { computeProgress, type BatchDepositItem, type BatchItemStatus } from "@/lib/batch-deposit"

/**
 * Live per-pool progress for a batch-deposit run.
 *
 * Because each pool is its own Soroban transaction (see `useBatchDeposit`),
 * every row moves through its own lifecycle and a failure in one row leaves the
 * others untouched — which is exactly what this view has to make legible.
 */

interface StatusMeta {
  label: string
  icon: typeof Clock
  className: string
  /** Whether the icon should spin. */
  busy?: boolean
}

const STATUS_META: Record<BatchItemStatus, StatusMeta> = {
  pending: {
    label: "Waiting",
    icon: Clock,
    className: "bg-muted text-muted-foreground",
  },
  signing: {
    label: "Awaiting signature",
    icon: PenLine,
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    busy: true,
  },
  submitted: {
    label: "Submitted",
    icon: Send,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    busy: true,
  },
  confirmed: {
    label: "Confirmed",
    icon: CheckCircle2,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    className: "bg-destructive/15 text-destructive",
  },
  cancelled: {
    label: "Not attempted",
    icon: MinusCircle,
    className: "bg-muted text-muted-foreground",
  },
}

export function BatchDepositStatusBadge({ status }: { status: BatchItemStatus }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <Badge
      variant="secondary"
      className={`gap-1.5 border-0 font-medium ${meta.className}`}
      data-testid={`batch-status-${status}`}
    >
      {meta.busy ? (
        <Spinner className="size-3" />
      ) : (
        <Icon className="size-3 shrink-0" aria-hidden="true" />
      )}
      {meta.label}
    </Badge>
  )
}

export interface BatchDepositProgressProps {
  items: BatchDepositItem[]
}

export function BatchDepositProgress({ items }: BatchDepositProgressProps) {
  if (items.length === 0) return null

  const progress = computeProgress(items)

  return (
    <div className="space-y-4" data-testid="batch-deposit-progress">
      {/* Overall progress */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium" aria-live="polite" data-testid="batch-progress-label">
            {progress.label}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {progress.done}/{progress.total}
          </p>
        </div>
        <Progress
          value={progress.percent}
          aria-label="Batch deposit progress"
          data-testid="batch-progress-bar"
        />
      </div>

      {/* Per-pool status */}
      <ul className="space-y-2" data-testid="batch-progress-list">
        {items.map((item) => (
          <li
            key={item.pool.id}
            className="rounded-lg border p-3"
            data-testid={`batch-progress-item-${item.pool.id}`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.pool.name}</p>
                <p className="text-xs text-muted-foreground">
                  {item.pool.amount} {item.pool.tokenSymbol} · round {item.pool.round}
                </p>
              </div>
              <BatchDepositStatusBadge status={item.status} />
            </div>

            {item.status === "failed" && item.error && (
              <p className="mt-2 text-xs text-destructive break-words" role="alert">
                {item.error}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
