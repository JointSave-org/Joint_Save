"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Download } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { useTranslations } from "next-intl"
import { calendarUrgency, formatTimeRemaining, type DepositCalendarEvent } from "@/lib/deposit-calendar"

interface CalendarEventItemProps {
  event: DepositCalendarEvent
  onExport: (event: DepositCalendarEvent) => void
  /** Compact rendering for calendar-grid day cells vs. the full mobile list row. */
  compact?: boolean
}

export function CalendarEventItem({ event, onExport, compact = false }: CalendarEventItemProps) {
  const t = useTranslations("dashboard.depositCalendar")
  const tPool = useTranslations("pool")
  const urgency = calendarUrgency(event.deadlineMs)
  const timeRemaining = formatTimeRemaining(event.deadlineMs)

  if (compact) {
    return (
      <Link
        href={`/dashboard/group/${event.poolId}`}
        className={`group flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${urgency.className}`}
        data-testid={`deposit-calendar-event-${event.poolId}`}
      >
        {event.hasDeposited && (
          <CheckCircle2
            className="size-3 shrink-0"
            aria-label={t("deposited")}
            data-testid={`deposit-calendar-deposited-${event.poolId}`}
          />
        )}
        <span className="truncate">{event.poolName}</span>
        <button
          type="button"
          className="ml-auto hidden shrink-0 group-hover:inline-flex"
          aria-label={t("exportEvent")}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onExport(event)
          }}
          data-testid={`deposit-calendar-export-${event.poolId}`}
        >
          <Download className="size-3" aria-hidden="true" />
        </button>
      </Link>
    )
  }

  return (
    <Link
      href={`/dashboard/group/${event.poolId}`}
      className="group flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
      data-testid={`deposit-calendar-event-${event.poolId}`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{event.poolName}</span>
          <Badge variant="secondary">{tPool("type.rotational")}</Badge>
          {event.hasDeposited && (
            <CheckCircle2
              className="size-4 shrink-0 text-green-600 dark:text-green-400"
              aria-label={t("deposited")}
              data-testid={`deposit-calendar-deposited-${event.poolId}`}
            />
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground">
          <span>
            {event.amount} {event.tokenSymbol}
          </span>
          <Badge variant="secondary" className={`border-0 ${urgency.className}`}>
            {timeRemaining}
          </Badge>
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={t("exportEvent")}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onExport(event)
        }}
        data-testid={`deposit-calendar-export-${event.poolId}`}
      >
        <Download className="size-4" aria-hidden="true" />
      </Button>
    </Link>
  )
}
