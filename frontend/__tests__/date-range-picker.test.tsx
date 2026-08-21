import React from "react"
import { render, screen, fireEvent } from "@/test-utils"
import { format, subDays } from "date-fns"
import { DateRangePicker } from "@/components/shared/date-range-picker"
import { vi, describe, it, expect, beforeEach } from "vitest"

describe("DateRangePicker", () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders from/to inputs and preset buttons", () => {
    render(<DateRangePicker from="" to="" onChange={onChange} />)

    expect(screen.getByLabelText("From")).toBeInTheDocument()
    expect(screen.getByLabelText("To")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Last 7 days" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Last 30 days" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Last 90 days" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "All time" })).toBeInTheDocument()
  })

  it("fires onChange when a date input changes", () => {
    render(<DateRangePicker from="" to="2026-08-18" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-08-01" } })
    expect(onChange).toHaveBeenCalledWith("2026-08-01", "2026-08-18")

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-08-20" } })
    expect(onChange).toHaveBeenCalledWith("", "2026-08-20")
  })

  it("presets select the expected range ending today", () => {
    render(<DateRangePicker from="" to="" onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }))
    expect(onChange).toHaveBeenCalledWith(
      format(subDays(new Date(), 7), "yyyy-MM-dd"),
      format(new Date(), "yyyy-MM-dd")
    )

    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }))
    expect(onChange).toHaveBeenLastCalledWith(
      format(subDays(new Date(), 30), "yyyy-MM-dd"),
      format(new Date(), "yyyy-MM-dd")
    )
  })

  it("All time clears the range and Clear appears only when filtered", () => {
    const { rerender } = render(
      <DateRangePicker from="2026-08-01" to="2026-08-18" onChange={onChange} />
    )

    expect(screen.getByRole("button", { name: /Clear date filter/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "All time" }))
    expect(onChange).toHaveBeenCalledWith("", "")

    rerender(<DateRangePicker from="" to="" onChange={onChange} />)
    expect(screen.queryByRole("button", { name: /Clear date filter/i })).not.toBeInTheDocument()
  })

  it("constrains from max and to min to keep the range valid", () => {
    render(<DateRangePicker from="2026-08-01" to="2026-08-18" onChange={onChange} />)

    expect(screen.getByLabelText("From")).toHaveAttribute("max", "2026-08-18")
    expect(screen.getByLabelText("To")).toHaveAttribute("min", "2026-08-01")
  })
})
