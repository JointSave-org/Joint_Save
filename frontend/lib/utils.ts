import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const WEEK_MS = 604_800_000
const MAX_FUTURE_SKEW_MS = 10 * MINUTE_MS

/** "just now" / "Unknown date" don't come from Intl — kept as a small per-locale lookup. */
const RELATIVE_TIME_STRINGS: Record<string, { justNow: string; unknownDate: string }> = {
  en: { justNow: "just now", unknownDate: "Unknown date" },
  es: { justNow: "justo ahora", unknownDate: "Fecha desconocida" },
}

function relativeTimeStrings(locale: string) {
  const lang = locale.split("-")[0]
  return RELATIVE_TIME_STRINGS[lang] ?? RELATIVE_TIME_STRINGS.en
}

/**
 * Returns a human-readable relative timestamp.
 *
 * Ranges (all comparisons are against the caller's wall-clock):
 *   < 1 min   → "just now"
 *   < 1 hour  → "X minutes/minute ago"
 *   < 24 hrs  → "X hours/hour ago"
 *   < 7 days  → "X days/day ago"
 *   ≥ 7 days  → short locale date, e.g. "Jun 10"
 *
 * Future dates up to 10 minutes (skew) collapse to "just now".
 * Future dates beyond 10 minutes are surfaced as the short locale date.
 *
 * `locale` defaults to "en-US" for backward compatibility with callers that
 * don't pass one (out-of-scope areas not translated by issue #216).
 *
 * Time complexity : O(1)
 * Space complexity: O(1) — single string allocation
 */
export function formatRelativeTime(date: string | Date, locale: string = "en-US"): string {
  const strings = relativeTimeStrings(locale)
  const ts = typeof date === "string" ? new Date(date) : date
  if (isNaN(ts.getTime())) return strings.unknownDate

  const diffMs = Date.now() - ts.getTime()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" })

  // Handle future dates (diffMs < 0)
  if (diffMs < 0) {
    if (diffMs >= -MAX_FUTURE_SKEW_MS) {
      return strings.justNow
    }
    // Surface larger future differences as short locale date to expose timezone/timestamp bugs
    return ts.toLocaleDateString(locale, { month: "short", day: "numeric" })
  }

  if (diffMs < MINUTE_MS) return strings.justNow

  if (diffMs < HOUR_MS) {
    return rtf.format(-Math.floor(diffMs / MINUTE_MS), "minute")
  }

  if (diffMs < DAY_MS) {
    return rtf.format(-Math.floor(diffMs / HOUR_MS), "hour")
  }

  if (diffMs < WEEK_MS) {
    return rtf.format(-Math.floor(diffMs / DAY_MS), "day")
  }

  return ts.toLocaleDateString(locale, { month: "short", day: "numeric" })
}

/**
 * Returns the full date-time string shown in the hover tooltip.
 * Format: "Jun 17, 2026, 14:30:00" — locale-independent enough for precision.
 *
 * `locale` defaults to "en-US" for backward compatibility with callers that
 * don't pass one (out-of-scope areas not translated by issue #216).
 *
 * Time complexity : O(1)
 * Space complexity: O(1)
 */
export function formatExactDateTime(date: string | Date, locale: string = "en-US"): string {
  const ts = typeof date === "string" ? new Date(date) : date
  if (isNaN(ts.getTime())) return relativeTimeStrings(locale).unknownDate

  return ts.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}
