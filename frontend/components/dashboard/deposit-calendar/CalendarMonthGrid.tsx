"use client"

import { useMemo, useState } from "react"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { dayKey, groupEventsByDay, type DepositCalendarEvent } from "@/lib/deposit-calendar"
import { CalendarEventItem } from "./CalendarEventItem"

const MAX_VISIBLE_PER_DAY = 3

interface CalendarMonthGridProps {
  events: DepositCalendarEvent[]
  onExport: (event: DepositCalendarEvent) => void
}

export function CalendarMonthGrid({ events, onExport }: CalendarMonthGridProps) {
  const t = useTranslations("dashboard.depositCalendar")
  const [currentMonth, setCurrentMonth] = useState(() => new Date())

  const grouped = useMemo(() => groupEventsByDay(events), [events])

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth))
    const end = endOfWeek(endOfMonth(currentMonth))
    return eachDayOfInterval({ start, end })
  }, [currentMonth])

  const weekdayLabels = days.slice(0, 7).map((day) => format(day, "EEE"))

  return (
    <div data-testid="deposit-calendar-month-grid">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold" aria-live="polite">
          {format(currentMonth, "MMMM yyyy")}
        </h4>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("prevMonth")}
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            data-testid="deposit-calendar-prev-month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("nextMonth")}
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            data-testid="deposit-calendar-next-month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-center text-xs font-medium text-muted-foreground">
        {weekdayLabels.map((label) => (
          <div key={label} className="bg-background py-2">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day.getTime())
          const dayEvents = grouped.get(key) ?? []
          const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY)
          const overflow = dayEvents.length - visible.length
          return (
            <div
              key={key}
              className={`min-h-24 bg-background p-1 text-left align-top ${
                isSameMonth(day, currentMonth) ? "" : "opacity-40"
              }`}
              data-testid={`deposit-calendar-day-${key}`}
            >
              <div
                className={`mb-1 inline-flex size-5 items-center justify-center rounded-full text-[11px] ${
                  isToday(day) ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {visible.map((event) => (
                  <CalendarEventItem key={event.poolId} event={event} onExport={onExport} compact />
                ))}
                {overflow > 0 && (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {t("moreEvents", { count: overflow })}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
