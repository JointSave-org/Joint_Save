"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { format, subDays } from "date-fns"
import { X } from "lucide-react"

export interface DateRangePickerProps {
  /** "YYYY-MM-DD" or "" for unbounded. */
  from: string
  /** "YYYY-MM-DD" or "" for unbounded. */
  to: string
  onChange: (from: string, to: string) => void
  /** Optional id prefix so multiple pickers can coexist on one page. */
  idPrefix?: string
}

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const

function presetRange(days: number): { from: string; to: string } {
  const today = new Date()
  return {
    from: format(subDays(today, days), "yyyy-MM-dd"),
    to: format(today, "yyyy-MM-dd"),
  }
}

/**
 * Simple two-field date range selector with quick presets.
 * Fully controlled: the parent owns the from/to strings.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  idPrefix = "date-range",
}: DateRangePickerProps) {
  const isFiltered = from !== "" || to !== ""

  const isPresetActive = (days: number) => {
    const range = presetRange(days)
    return from === range.from && to === range.to
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-from`} className="text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, to)}
          max={to || undefined}
          className="h-8 text-sm w-36"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-to`} className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id={`${idPrefix}-to`}
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
          min={from || undefined}
          className="h-8 text-sm w-36"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.days}
            type="button"
            variant={isPresetActive(preset.days) ? "secondary" : "ghost"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              const range = presetRange(preset.days)
              onChange(range.from, range.to)
            }}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          type="button"
          variant={!isFiltered ? "secondary" : "ghost"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => onChange("", "")}
        >
          All time
        </Button>
        {isFiltered && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("", "")}
            className="h-8 gap-1 text-xs"
            aria-label="Clear date filter"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
