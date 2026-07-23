import ical, { ICalCalendarMethod } from "ical-generator"
import type { DepositEvent } from "@/components/dashboard/deposit-calendar"

const SITE_URL = typeof window !== "undefined" ? window.location.origin : "https://joint-save.vercel.app"

export function generatePoolICal(events: DepositEvent[], poolName?: string): string {
  const calendar = ical({ name: poolName || "JointSave Deposits", method: ICalCalendarMethod.PUBLISH })

  for (const event of events) {
    calendar.createEvent({
      start: event.deadline,
      end: new Date(event.deadline.getTime() + 60 * 60 * 1000),
      summary: `Deposit due: ${event.poolName}`,
      description: `Deposit ${event.depositAmount.toFixed(2)} ${event.tokenSymbol} to ${event.poolName}. Pool contract: ${event.contractAddress}`,
      url: `${SITE_URL}/dashboard/group/${event.poolId}`,
      allDay: false,
    })
  }

  return calendar.toString()
}

export function generateAllICal(events: DepositEvent[]): string {
  const calendar = ical({ name: "JointSave - All Deposits", method: ICalCalendarMethod.PUBLISH })

  for (const event of events) {
    calendar.createEvent({
      start: event.deadline,
      end: new Date(event.deadline.getTime() + 60 * 60 * 1000),
      summary: `Deposit due: ${event.poolName}`,
      description: `Deposit ${event.depositAmount.toFixed(2)} ${event.tokenSymbol} to ${event.poolName}. Pool contract: ${event.contractAddress}`,
      url: `${SITE_URL}/dashboard/group/${event.poolId}`,
      allDay: false,
    })
  }

  return calendar.toString()
}

export function downloadICal(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
