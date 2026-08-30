/**
 * Pure logic behind the dashboard's batch-deposit feature.
 *
 * ── Why a *client-side* batch, not an on-chain one ──────────────────────────
 * A Stellar transaction may carry many operations, but Soroban allows exactly
 * **one `InvokeHostFunction` operation per transaction** — a tx with two
 * contract calls is rejected as malformed. So "deposit to N pools" cannot be a
 * single atomic transaction; it is necessarily N independent transactions.
 *
 * That constraint is what makes the feature useful rather than limiting: each
 * deposit succeeds or fails on its own, so a partial failure leaves the
 * successful deposits intact and only the failed pools need retrying.
 *
 * This module holds everything that needs no wallet, no network and no React,
 * so it can be unit-tested directly: selection totals, urgency banding,
 * batching, and progress calculation. See `hooks/useBatchDeposit.ts` for the
 * transaction building and submission built on top of it.
 */

// ── Batching ─────────────────────────────────────────────────────────────────

/**
 * Maximum transactions signed and submitted in one batch.
 *
 * Soroban's per-transaction limits (≈65 536 bytes of transaction size, plus
 * per-tx resource budgets) apply to each deposit individually and are never
 * close to being hit by a single `deposit` call. The real ceiling here is the
 * signing/submission run: 15 wallet round-trips is about as long as a user
 * will sit through before wanting feedback and a chance to stop. Anything
 * larger is split into further batches, surfaced in the UI.
 */
export const MAX_TX_PER_BATCH = 15

// ── Types ────────────────────────────────────────────────────────────────────

/** A rotational pool the connected wallet still owes a deposit to this round. */
export interface BatchDepositPool {
  /** Database id — stable key for selection and activity logging. */
  id: string
  name: string
  /** Deployed Soroban contract id (C…). */
  contractAddress: string
  /** Per-round contribution in human units (not stroops). */
  amount: number
  tokenSymbol: string
  /** On-chain round this deposit belongs to. */
  round: number
  /** Round deadline (next payout) as a unix timestamp in ms; null if unknown. */
  deadline: number | null
}

/** Where a single pool's deposit has got to. */
export type BatchItemStatus =
  | "pending"
  | "signing"
  | "submitted"
  | "confirmed"
  | "failed"
  /** Not attempted because the user cancelled the run partway through. */
  | "cancelled"

export interface BatchDepositItem {
  pool: BatchDepositPool
  status: BatchItemStatus
  txHash?: string
  error?: string
}

/** Statuses that mean the deposit will not change again without a retry. */
export const TERMINAL_STATUSES: readonly BatchItemStatus[] = ["confirmed", "failed", "cancelled"]

export function isTerminal(status: BatchItemStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// ── Selection totals ─────────────────────────────────────────────────────────

export interface BatchSelectionSummary {
  count: number
  /** Total per token symbol — pools may be denominated in different tokens. */
  totalsBySymbol: Record<string, number>
}

/** Sum the selected pools' contributions, grouped by token symbol. */
export function summarizeSelection(
  pools: BatchDepositPool[],
  selectedIds: Iterable<string>
): BatchSelectionSummary {
  const selected = new Set(selectedIds)
  const totalsBySymbol: Record<string, number> = {}
  let count = 0

  for (const pool of pools) {
    if (!selected.has(pool.id)) continue
    count++
    totalsBySymbol[pool.tokenSymbol] = (totalsBySymbol[pool.tokenSymbol] ?? 0) + pool.amount
  }

  return { count, totalsBySymbol }
}

/** Trim trailing zeros so "150.0000000" reads as "150". */
function formatAmount(value: number): string {
  return parseFloat(value.toFixed(7)).toString()
}

/**
 * Human summary of the current selection, e.g.
 * `"Depositing to 3 pools: 150 XLM total"`, or with mixed tokens
 * `"Depositing to 3 pools: 100 XLM + 50 USDC total"`.
 */
export function formatBatchSummary(summary: BatchSelectionSummary): string {
  if (summary.count === 0) return "No pools selected"

  const poolLabel = summary.count === 1 ? "1 pool" : `${summary.count} pools`
  const amounts = Object.entries(summary.totalsBySymbol)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, total]) => `${formatAmount(total)} ${symbol}`)
    .join(" + ")

  return `Depositing to ${poolLabel}: ${amounts} total`
}

// ── Batching ─────────────────────────────────────────────────────────────────

/** Split a list into consecutive chunks of at most `size` items. */
export function chunk<T>(items: T[], size: number = MAX_TX_PER_BATCH): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1")
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

/**
 * Message shown when a selection is large enough to be split, so the user
 * knows to expect more than one run. `null` when everything fits in one batch.
 */
export function describeSplit(batchCount: number): string | null {
  if (batchCount <= 1) return null
  return `Split into ${batchCount} batches due to transaction size limits`
}

// ── Urgency ──────────────────────────────────────────────────────────────────

export type UrgencyLevel = "overdue" | "urgent" | "soon" | "normal" | "unknown"

export interface Urgency {
  level: UrgencyLevel
  label: string
  /** Tailwind classes for the deadline chip. */
  className: string
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Band a round deadline into an urgency used for the deadline chip's colour.
 * Overdue → red, under a day → amber, under three days → yellow, else muted.
 */
export function depositUrgency(deadline: number | null, now: number = Date.now()): Urgency {
  if (deadline == null || !Number.isFinite(deadline) || deadline <= 0) {
    return {
      level: "unknown",
      label: "No deadline",
      className: "bg-muted text-muted-foreground",
    }
  }

  const remaining = deadline - now

  if (remaining <= 0) {
    return {
      level: "overdue",
      label: "Overdue",
      className: "bg-destructive/15 text-destructive",
    }
  }
  if (remaining < DAY_MS) {
    const hours = Math.max(1, Math.round(remaining / HOUR_MS))
    return {
      level: "urgent",
      label: `Due in ${hours}h`,
      className: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    }
  }
  if (remaining < 3 * DAY_MS) {
    return {
      level: "soon",
      label: `Due in ${Math.round(remaining / DAY_MS)}d`,
      className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    }
  }
  return {
    level: "normal",
    label: `Due in ${Math.round(remaining / DAY_MS)}d`,
    className: "bg-muted text-muted-foreground",
  }
}

/** Most urgent first, so the pools at risk sit at the top of the list. */
const URGENCY_ORDER: Record<UrgencyLevel, number> = {
  overdue: 0,
  urgent: 1,
  soon: 2,
  normal: 3,
  unknown: 4,
}

export function sortByUrgency(
  pools: BatchDepositPool[],
  now: number = Date.now()
): BatchDepositPool[] {
  return [...pools].sort((a, b) => {
    const rank =
      URGENCY_ORDER[depositUrgency(a.deadline, now).level] -
      URGENCY_ORDER[depositUrgency(b.deadline, now).level]
    if (rank !== 0) return rank
    // Within a band, the sooner deadline first; unknown deadlines last.
    const aDeadline = a.deadline ?? Number.POSITIVE_INFINITY
    const bDeadline = b.deadline ?? Number.POSITIVE_INFINITY
    if (aDeadline !== bDeadline) return aDeadline - bDeadline
    return a.name.localeCompare(b.name)
  })
}

// ── Progress ─────────────────────────────────────────────────────────────────

export interface BatchProgress {
  total: number
  /** Deposits that reached a terminal state (confirmed, failed or cancelled). */
  done: number
  confirmed: number
  failed: number
  /** 0–100, for the progress bar. */
  percent: number
  /** 1-based index of the deposit currently in flight, or null when idle. */
  currentIndex: number | null
  /** e.g. "Depositing to pool 2 of 5…" */
  label: string
}

/** Derive the progress-bar state from the current per-pool statuses. */
export function computeProgress(items: BatchDepositItem[]): BatchProgress {
  const total = items.length
  const confirmed = items.filter((i) => i.status === "confirmed").length
  const failed = items.filter((i) => i.status === "failed").length
  const done = items.filter((i) => isTerminal(i.status)).length
  const activeIndex = items.findIndex((i) => i.status === "signing" || i.status === "submitted")
  const currentIndex = activeIndex === -1 ? null : activeIndex + 1
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  let label: string
  if (total === 0) {
    label = "Nothing to deposit"
  } else if (currentIndex !== null) {
    label = `Depositing to pool ${currentIndex} of ${total}…`
  } else if (done === total) {
    label =
      failed === 0
        ? `Deposited to ${total} ${total === 1 ? "pool" : "pools"}`
        : `${confirmed} of ${total} deposits confirmed, ${failed} failed`
  } else {
    label = `Preparing ${total} ${total === 1 ? "deposit" : "deposits"}…`
  }

  return { total, done, confirmed, failed, percent, currentIndex, label }
}
