"use client"

import { useTranslations } from "next-intl"
import { upcomingSorted, type DepositCalendarEvent } from "@/lib/deposit-calendar"
import { CalendarEventItem } from "./CalendarEventItem"

interface DepositListViewProps {
  events: DepositCalendarEvent[]
  onExport: (event: DepositCalendarEvent) => void
}

/** Mobile (<768px) fallback for the month grid: a scrollable timeline sorted by deadline. */
export function DepositListView({ events, onExport }: DepositListViewProps) {
  const t = useTranslations("dashboard.depositCalendar")
  const sorted = upcomingSorted(events)

  return (
    <div className="space-y-2" data-testid="deposit-calendar-list-view">
      <h4 className="text-sm font-semibold text-muted-foreground">{t("listHeading")}</h4>
      <ul className="space-y-2">
        {sorted.map((event) => (
          <li key={event.poolId}>
            <CalendarEventItem event={event} onExport={onExport} />
          </li>
        ))}
      </ul>
    </div>
  )
}
