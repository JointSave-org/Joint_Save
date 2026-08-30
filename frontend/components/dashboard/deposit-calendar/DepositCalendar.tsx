"use client"

import { useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarDays, Download } from "lucide-react"
import { useTranslations } from "next-intl"
import { useIsMobile } from "@/hooks/use-mobile"
import { useDepositCalendar } from "@/hooks/useDepositCalendar"
import { buildIcs, downloadIcs, type IcsEventInput } from "@/lib/ical-export"
import type { DepositCalendarEvent } from "@/lib/deposit-calendar"
import { CalendarMonthGrid } from "./CalendarMonthGrid"
import { DepositListView } from "./DepositListView"

/** Deposit events with no known deadline can't produce a calendar entry. */
function toIcsEvent(event: DepositCalendarEvent): IcsEventInput | null {
  if (event.deadlineMs == null) return null
  return {
    uid: `deposit-${event.poolId}-${event.round}`,
    summary: `Deposit due: ${event.poolName}`,
    description: `Deposit ${event.amount} ${event.tokenSymbol} to ${event.poolName}. Pool contract: ${event.contractAddress}`,
    start: new Date(event.deadlineMs),
    url:
      typeof window !== "undefined"
        ? `${window.location.origin}/dashboard/group/${event.poolId}`
        : undefined,
  }
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "pool"
}

/**
 * Dashboard section showing every rotational pool's next deposit deadline in
 * one place, color-coded by urgency, with per-pool and "export all" iCal
 * download. Renders a month grid on desktop and a sorted timeline list on
 * mobile (<768px). Rendered from `MyGroups` behind a Grid/Calendar toggle.
 */
export function DepositCalendar() {
  const t = useTranslations("dashboard.depositCalendar")
  const isMobile = useIsMobile()
  const { events, isLoading, error, hasRotationalPools } = useDepositCalendar()

  const exportEvent = useCallback((event: DepositCalendarEvent) => {
    const icsEvent = toIcsEvent(event)
    if (!icsEvent) return
    downloadIcs(buildIcs([icsEvent]), `${slugify(event.poolName)}-deposit.ics`)
  }, [])

  const exportAll = useCallback(() => {
    const icsEvents = events.map(toIcsEvent).filter((e): e is IcsEventInput => e !== null)
    if (icsEvents.length === 0) return
    downloadIcs(buildIcs(icsEvents), "jointsave-deposits.ics")
  }, [events])

  if (isLoading && events.length === 0) {
    return (
      <div className="space-y-3" aria-label={t("loadingLabel")} data-testid="deposit-calendar-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-6 bg-destructive/10 text-destructive">
        <p>{error}</p>
      </Card>
    )
  }

  if (!hasRotationalPools) {
    return (
      <Card
        className="p-12 flex flex-col items-center text-center gap-3"
        data-testid="deposit-calendar-empty-state"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CalendarDays className="h-8 w-8 text-primary" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold">{t("empty.heading")}</h3>
        <p className="text-sm text-muted-foreground max-w-sm">{t("empty.subheading")}</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4" data-testid="deposit-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{t("title")}</h3>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportAll} data-testid="deposit-calendar-export-all">
          <Download className="size-4" aria-hidden="true" />
          {t("exportAll")}
        </Button>
      </div>

      {isMobile ? (
        <DepositListView events={events} onExport={exportEvent} />
      ) : (
        <CalendarMonthGrid events={events} onExport={exportEvent} />
      )}
    </div>
  )
}
