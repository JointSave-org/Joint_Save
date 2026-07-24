import React from "react"
import { render, screen, waitFor, fireEvent } from "@/test-utils"
import { Transactions } from "@/components/dashboard/transactions"
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/lib/supabase")

describe("Transactions Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders transaction list header and export button", async () => {
    render(<Transactions />)

    await waitFor(() => {
      expect(screen.getByText("Transaction History")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Export CSV/i })).toBeInTheDocument()
    })
  })

  it("renders activity items correctly", async () => {
    render(<Transactions />)

    await waitFor(() => {
      expect(screen.getByText("deposit")).toBeInTheDocument()
      expect(screen.getByText("100.00 XLM")).toBeInTheDocument()
    })
  })

  it("filters transactions when dropdown selection changes", async () => {
    render(<Transactions />)

    await waitFor(() => {
      expect(screen.getByText("deposit")).toBeInTheDocument()
    })

    const select = screen.getByLabelText("Filter transactions")
    fireEvent.change(select, { target: { value: "withdraw" } })

    await waitFor(() => {
      expect(screen.getByText("withdraw")).toBeInTheDocument()
      expect(screen.queryByText("deposit")).not.toBeInTheDocument()
    })
  })

  it("triggers CSV download on Export CSV click", async () => {
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const elem = originalCreateElement(tagName)
      if (tagName === "a") {
        elem.click = clickSpy
      }
      return elem
    })

    render(<Transactions />)

    await waitFor(() => {
      const exportBtn = screen.getByRole("button", { name: /Export CSV/i })
      expect(exportBtn).not.toBeDisabled()
      fireEvent.click(exportBtn)
    })

    expect(clickSpy).toHaveBeenCalled()
  })
})
