/**
 * Minimal RFC 5545 (iCalendar) export utility — mirrors `lib/csv-export.ts`'s
 * shape (a pure string builder + a browser-download trigger) so deposit
 * deadlines can be exported to Google Calendar / Apple Calendar without
 * pulling in a Node-oriented calendar-generation dependency.
 *
 * buildIcs      – pure function that converts events into a VCALENDAR string.
 * downloadIcs   – triggers a browser file-download from an ICS string (no-op in SSR).
 */

const CRLF = "\r\n"
/** RFC 5545 §3.1: content lines SHOULD be folded at 75 octets. */
const FOLD_LIMIT = 75

export interface IcsEventInput {
  /** Unique per event; `@jointsave.app` is appended to form the full UID. */
  uid: string
  summary: string
  description: string
  start: Date
  /** Event length in minutes. Ignored when `allDay` is true. Default 60. */
  durationMinutes?: number
  url?: string
  /** Renders as a whole-day event instead of a timed one. Default false. */
  allDay?: boolean
}

/** Escape TEXT-value special characters per RFC 5545 §3.3.11. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}

/** Fold a content line longer than 75 octets, continuing on lines that start with a space. */
function foldLine(line: string): string {
  if (line.length <= FOLD_LIMIT) return line
  const segments: string[] = []
  let rest = line
  let isFirst = true
  while (rest.length > 0) {
    const limit = isFirst ? FOLD_LIMIT : FOLD_LIMIT - 1
    segments.push((isFirst ? "" : " ") + rest.slice(0, limit))
    rest = rest.slice(limit)
    isFirst = false
  }
  return segments.join(CRLF)
}

/** `Date` → `YYYYMMDDTHHMMSSZ` (UTC), the RFC 5545 form used for DTSTAMP/DTSTART/DTEND. */
function formatIcsDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

/** `Date` → `YYYYMMDD`, used for all-day `DTSTART;VALUE=DATE`. */
function formatIcsDateOnly(date: Date): string {
  return formatIcsDateTime(date).slice(0, 8)
}

/** Build the unfolded content lines for a single VEVENT block. */
export function buildIcsEvent(input: IcsEventInput): string[] {
  const { uid, summary, description, start, durationMinutes = 60, url, allDay = false } = input

  const lines: string[] = ["BEGIN:VEVENT", `UID:${uid}@jointsave.app`, `DTSTAMP:${formatIcsDateTime(new Date())}`]

  if (allDay) {
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(start)}`)
    lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(end)}`)
  } else {
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
    lines.push(`DTSTART:${formatIcsDateTime(start)}`)
    lines.push(`DTEND:${formatIcsDateTime(end)}`)
  }

  lines.push(`SUMMARY:${escapeText(summary)}`)
  lines.push(`DESCRIPTION:${escapeText(description)}`)
  if (url) lines.push(`URL:${url}`)
  lines.push("END:VEVENT")

  return lines
}

/** Wrap one or more events in a VCALENDAR, folding long lines and using CRLF line endings. */
export function buildIcs(events: IcsEventInput[], calendarName = "JointSave Deposits"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JointSave//Deposit Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ]

  for (const event of events) {
    lines.push(...buildIcsEvent(event))
  }

  lines.push("END:VCALENDAR")

  return lines.map(foldLine).join(CRLF) + CRLF
}

/** Trigger a browser download for the given ICS string. */
export function downloadIcs(ics: string, filename: string): void {
  if (typeof window === "undefined") return
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
