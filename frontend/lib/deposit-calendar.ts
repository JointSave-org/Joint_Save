/**
 * Pure logic behind the dashboard's deposit calendar: urgency banding, time-
 * remaining formatting, and grouping/sorting of deposit events. No wallet, no
 * network, no React — see `hooks/useDepositCalendar.ts` for the data fetching
 * built on top of this, which reuses `PoolDataProvider`'s cache.
 */

import { format } from "date-fns"

// ── Types ────────────────────────────────────────────────────────────────────

/** One rotational pool's next deposit obligation for the connected wallet. */
export interface DepositCalendarEvent {
  /** Database id — used for navigation and as a stable React key. */
  poolId: string
  poolName: string
  /** Deployed Soroban contract id (C…). */
  contractAddress: string
  /** Per-round contribution in human units (not stroops). */
  amount: number
  tokenSymbol: string
  /** On-chain round this deposit belongs to. */
  round: number
  /** Next payout / round deadline as a unix timestamp in ms; null if unknown. */
  deadlineMs: number | null
  /** True when the connected wallet has already deposited for this round. */
  hasDeposited: boolean
}

// ── Urgency ──────────────────────────────────────────────────────────────────

export type CalendarUrgencyLevel = "green" | "yellow" | "red" | "unknown"

export interface CalendarUrgency {
  level: CalendarUrgencyLevel
  label: string
  /** Tailwind classes for the event chip/badge. */
  className: string
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Band a deposit deadline into an urgency level for the calendar's color
 * coding: green (>7 days away), yellow (2–7 days), red (<2 days or overdue).
 */
export function calendarUrgency(deadlineMs: number | null, now: number = Date.now()): CalendarUrgency {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) {
    return {
      level: "unknown",
      label: "No deadline",
      className: "bg-muted text-muted-foreground",
    }
  }

  const remaining = deadlineMs - now

  if (remaining < 2 * DAY_MS) {
    return {
      level: "red",
      label: remaining <= 0 ? "Overdue" : "Due soon",
      className: "bg-red-500/15 text-red-700 dark:text-red-400",
    }
  }
  if (remaining <= 7 * DAY_MS) {
    return {
      level: "yellow",
      label: `Due in ${Math.round(remaining / DAY_MS)}d`,
      className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    }
  }
  return {
    level: "green",
    label: `Due in ${Math.round(remaining / DAY_MS)}d`,
    className: "bg-green-500/15 text-green-700 dark:text-green-400",
  }
}

/** Short human label for the time remaining until (or overdue past) a deadline. */
export function formatTimeRemaining(deadlineMs: number | null, now: number = Date.now()): string {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return "No deadline"

  const remaining = deadlineMs - now

  if (remaining <= 0) {
    const overdueBy = -remaining
    if (overdueBy < HOUR_MS) return "Overdue"
    if (overdueBy < DAY_MS) return `Overdue by ${Math.round(overdueBy / HOUR_MS)}h`
    return `Overdue by ${Math.round(overdueBy / DAY_MS)}d`
  }
  if (remaining < DAY_MS) return `Due in ${Math.max(1, Math.round(remaining / HOUR_MS))}h`
  return `Due in ${Math.round(remaining / DAY_MS)}d`
}

// ── Grouping & sorting ───────────────────────────────────────────────────────

/** Key format used to group events onto calendar day cells. */
export function dayKey(deadlineMs: number): string {
  return format(new Date(deadlineMs), "yyyy-MM-dd")
}

/** Group events by calendar day, keyed `"yyyy-MM-dd"`. Events with no known deadline are dropped. */
export function groupEventsByDay(
  events: DepositCalendarEvent[]
): Map<string, DepositCalendarEvent[]> {
  const map = new Map<string, DepositCalendarEvent[]>()
  for (const event of events) {
    if (event.deadlineMs == null) continue
    const key = dayKey(event.deadlineMs)
    const existing = map.get(key)
    if (existing) {
      existing.push(event)
    } else {
      map.set(key, [event])
    }
  }
  return map
}

/** Soonest deadline first; unknown deadlines last, then alphabetical by pool name. */
export function upcomingSorted(events: DepositCalendarEvent[]): DepositCalendarEvent[] {
  return [...events].sort((a, b) => {
    const aUnknown = a.deadlineMs == null
    const bUnknown = b.deadlineMs == null
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
    if (!aUnknown && !bUnknown && a.deadlineMs !== b.deadlineMs) {
      return (a.deadlineMs as number) - (b.deadlineMs as number)
    }
    return a.poolName.localeCompare(b.poolName)
  })
}
