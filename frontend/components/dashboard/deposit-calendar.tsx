"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Clock,
  CalendarDays,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useMemo, useEffect } from "react"
import { useStellar } from "@/components/web3-provider"
import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { useAllRotationalPools, type RotationalPoolMeta } from "@/hooks/useAllRotationalPools"
import { RotationalPoolState } from "@/hooks/useJointSaveContracts"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  generatePoolICal,
  generateAllICal,
  downloadICal,
} from "@/lib/ical-export"
import { motion } from "framer-motion"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepositEvent {
  poolId: string
  poolName: string
  contractAddress: string
  poolType: "rotational"
  depositAmount: number
  tokenSymbol: string
  deadline: Date
  hasDeposited: boolean
  currentRound: number
  totalMembers: number
  isActive: boolean
}

// ── Urgency helpers ───────────────────────────────────────────────────────────

function getUrgencyClass(deadline: Date, hasDeposited: boolean): string {
  if (hasDeposited) return "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
  const now = Date.now()
  const diff = deadline.getTime() - now
  const days = diff / (1000 * 60 * 60 * 24)
  if (days < 0 || days < 2) return "bg-red-500/15 border-red-500/40 text-red-400"
  if (days <= 7) return "bg-yellow-500/15 border-yellow-500/40 text-yellow-400"
  return "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
}

function getUrgencyDot(deadline: Date, hasDeposited: boolean): string {
  if (hasDeposited) return "bg-emerald-500"
  const now = Date.now()
  const diff = deadline.getTime() - now
  const days = diff / (1000 * 60 * 60 * 24)
  if (days < 0 || days < 2) return "bg-red-500"
  if (days <= 7) return "bg-yellow-500"
  return "bg-emerald-500"
}

function getTimeRemaining(deadline: Date): string {
  const now = Date.now()
  const diff = deadline.getTime() - now
  if (diff < 0) return "Overdue"
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h`
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return `${mins}m`
}

// ── Calendar date helpers ─────────────────────────────────────────────────────

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

// ── Pool event item (individual pool that hooks into PoolDataProvider) ─────────

function PoolEventItem({
  pool,
  onEventReady,
}: {
  pool: RotationalPoolMeta
  onEventReady: (event: DepositEvent) => void
}) {
  const cacheKey =
    pool.contractAddress && pool.contractAddress !== "pending_deployment"
      ? pool.contractAddress
      : pool.id
  const { data, isLoading } = usePoolData(cacheKey)

  useEffect(() => {
    if (!data?.onchain) return

    const onchain = data.onchain as RotationalPoolState
    if (!onchain.isActive) return

    const deadline = new Date(onchain.nextPayoutTime * 1000)
    const tokenDecimals = pool.tokenDecimals ?? 7
    const depositAmount =
      pool.depositAmount != null
        ? pool.depositAmount
        : 0

    onEventReady({
      poolId: pool.id,
      poolName: pool.name,
      contractAddress: pool.contractAddress,
      poolType: "rotational",
      depositAmount,
      tokenSymbol: pool.tokenSymbol || "XLM",
      deadline,
      hasDeposited: onchain.hasDeposited,
      currentRound: onchain.currentRound,
      totalMembers: onchain.members.length,
      isActive: onchain.isActive,
    })
  }, [data, pool, onEventReady])

  if (isLoading) {
    return (
      <div className="hidden" data-testid={`pool-event-loading-${pool.id}`} />
    )
  }

  return null
}

// ── Empty state ───────────────────────────────────────────────────────────────

function CalendarEmptyState({ onCreateClick }: { onCreateClick?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-4">
        <CalendarDays className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-xl font-bold mb-2">No deposit schedule yet</h3>
      <p className="text-muted-foreground max-w-md mb-6">
        You don't have any rotational pools yet. Create or join one to see
        your deposit schedule here.
      </p>
      {onCreateClick && (
        <Button onClick={onCreateClick}>Create a Pool</Button>
      )}
    </motion.div>
  )
}

// ── Event popover / detail card ───────────────────────────────────────────────

function EventCard({ event }: { event: DepositEvent }) {
  const router = useRouter()
  const urgencyClass = getUrgencyClass(event.deadline, event.hasDeposited)

  return (
    <Card
      className={`p-4 cursor-pointer hover:shadow-md transition-all duration-200 border ${urgencyClass}`}
      onClick={() => router.push(`/dashboard/group/${event.poolId}`)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${getUrgencyDot(event.deadline, event.hasDeposited)}`} />
            <h4 className="text-sm font-semibold truncate">{event.poolName}</h4>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Round {event.currentRound + 1} of {event.totalMembers}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary" className="text-[10px]">
              {event.depositAmount.toFixed(2)} {event.tokenSymbol}
            </Badge>
            <span className="text-muted-foreground">
              {event.deadline.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {event.hasDeposited ? (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/40 text-[10px]">
              <CalendarCheck className="h-3 w-3 mr-1" />
              Paid
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              <Clock className="h-3 w-3 mr-1" />
              {getTimeRemaining(event.deadline)}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  )
}

// ── Mobile list view ──────────────────────────────────────────────────────────

function MobileListView({ events }: { events: DepositEvent[] }) {
  const sorted = useMemo(
    () =>
      [...events].sort((a, b) => {
        if (a.hasDeposited !== b.hasDeposited) return a.hasDeposited ? 1 : -1
        return a.deadline.getTime() - b.deadline.getTime()
      }),
    [events]
  )

  return (
    <div className="space-y-3">
      {sorted.map((event) => (
        <EventCard key={`${event.poolId}-${event.deadline.toISOString()}`} event={event} />
      ))}
    </div>
  )
}

// ── Desktop calendar grid ─────────────────────────────────────────────────────

function CalendarGrid({
  events,
  currentMonth,
}: {
  events: DepositEvent[]
  currentMonth: Date
}) {
  const monthStart = startOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart)
  const totalDays = 42 // 6 weeks

  const days = useMemo(() => {
    const result: { date: Date; isCurrentMonth: boolean; events: DepositEvent[] }[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(calStart, i)
      const isCurrentMonth = date.getMonth() === currentMonth.getMonth()
      const dayEvents = events.filter((e) => isSameDay(e.deadline, date))
      result.push({ date, isCurrentMonth, events: dayEvents })
    }
    return result
  }, [calStart, currentMonth, events])

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  return (
    <div className="w-full">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-2">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 border border-border rounded-lg overflow-hidden">
        {days.map(({ date, isCurrentMonth, events: dayEvents }, idx) => (
          <div
            key={idx}
            className={`min-h-[80px] p-1.5 border-b border-r border-border last:border-r-0
              ${!isCurrentMonth ? "bg-muted/30" : ""}
              ${isToday(date) ? "bg-primary/5" : ""}
            `}
          >
            <span
              className={`text-xs font-medium block mb-1
                ${!isCurrentMonth ? "text-muted-foreground/50" : "text-foreground"}
                ${isToday(date) ? "text-primary font-bold" : ""}
              `}
            >
              {date.getDate()}
            </span>
            <div className="space-y-1">
              {dayEvents.slice(0, 3).map((event) => (
                <CalendarEventPill key={event.poolId} event={event} />
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[10px] text-muted-foreground block pl-1">
                  +{dayEvents.length - 3} more
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CalendarEventPill({ event }: { event: DepositEvent }) {
  const router = useRouter()
  const urgencyClass = getUrgencyClass(event.deadline, event.hasDeposited)

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        router.push(`/dashboard/group/${event.poolId}`)
      }}
      className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-medium truncate border
        ${urgencyClass}
        hover:opacity-80 transition-opacity cursor-pointer
      `}
      title={`${event.poolName} - ${event.depositAmount.toFixed(2)} ${event.tokenSymbol}`}
    >
      {event.hasDeposited && <CalendarCheck className="inline h-2.5 w-2.5 mr-0.5" />}
      {event.poolName}
    </button>
  )
}

// ── Main DepositCalendar component ────────────────────────────────────────────

export function DepositCalendar({
  onCreateClick,
}: {
  onCreateClick?: () => void
}) {
  const { address } = useStellar()
  const { pools, loading: poolsLoading } = useAllRotationalPools()
  const isMobile = useIsMobile()
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [events, setEvents] = useState<DepositEvent[]>([])

  const handleEventReady = useMemo(() => {
    return (event: DepositEvent) => {
      setEvents((prev) => {
        const exists = prev.some((e) => e.poolId === event.poolId)
        if (exists) {
          return prev.map((e) => (e.poolId === event.poolId ? event : e))
        }
        return [...prev, event]
      })
    }
  }, [])

  const sortedEvents = useMemo(
    () =>
      [...events]
        .filter((e) => e.isActive)
        .sort((a, b) => a.deadline.getTime() - b.deadline.getTime()),
    [events]
  )

  const pendingEvents = useMemo(
    () => sortedEvents.filter((e) => !e.hasDeposited),
    [sortedEvents]
  )

  const handleExportPool = (poolId: string) => {
    const poolEvents = events.filter((e) => e.poolId === poolId)
    if (poolEvents.length === 0) return
    const ics = generatePoolICal(poolEvents, poolEvents[0].poolName)
    const safeName = poolEvents[0].poolName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()
    downloadICal(ics, `jointsave_${safeName}_deposits.ics`)
  }

  const handleExportAll = () => {
    if (sortedEvents.length === 0) return
    const ics = generateAllICal(sortedEvents)
    downloadICal(ics, "jointsave_all_deposits.ics")
  }

  const navigateMonth = (direction: number) => {
    setCurrentMonth((prev) => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + direction)
      return d
    })
  }

  if (!address) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">Deposit Calendar</h2>
          <p className="text-muted-foreground mt-1">Connect your wallet to view your schedule</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hidden PoolEventItem components to register with PoolDataProvider */}
      {pools.map((pool) => (
        <PoolEventItem
          key={pool.contractAddress}
          pool={pool}
          onEventReady={handleEventReady}
        />
      ))}

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-3xl font-bold">Deposit Calendar</h2>
          <p className="text-muted-foreground mt-1">
            {pools.length === 0
              ? "Your upcoming deposit schedule"
              : `${pools.length} rotational pool${pools.length !== 1 ? "s" : ""} · ${pendingEvents.length} pending deposit${pendingEvents.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {sortedEvents.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleExportAll}>
            <Download className="h-4 w-4 mr-2" />
            Export All
          </Button>
        )}
      </motion.div>

      {/* Loading state */}
      {poolsLoading && (
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[400px] w-full rounded-lg" />
        </div>
      )}

      {/* Empty state */}
      {!poolsLoading && pools.length === 0 && (
        <CalendarEmptyState onCreateClick={onCreateClick} />
      )}

      {/* Calendar / List */}
      {!poolsLoading && pools.length > 0 && (
        <>
          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => navigateMonth(-1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="text-lg font-semibold min-w-[180px] text-center">
                {currentMonth.toLocaleString("default", {
                  month: "long",
                  year: "numeric",
                })}
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => navigateMonth(1)}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Per-pool export dropdown */}
            {events.length > 0 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentMonth(new Date())}
                  className="text-xs"
                >
                  Today
                </Button>
              </div>
            )}
          </div>

          {isMobile ? (
            <MobileListView events={sortedEvents} />
          ) : (
            <CalendarGrid events={sortedEvents} currentMonth={currentMonth} />
          )}

          {/* Upcoming deposits list with per-pool export */}
          {sortedEvents.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Upcoming Deposits
              </h4>
              <div className="grid gap-3">
                {sortedEvents.map((event) => (
                  <div key={`${event.poolId}-${event.deadline.toISOString()}`} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <EventCard event={event} />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleExportPool(event.poolId)}
                      title="Export to calendar"
                      className="shrink-0"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
