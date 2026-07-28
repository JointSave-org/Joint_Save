import React from "react"
import { render, screen, fireEvent, waitFor } from "@/test-utils"
import { YieldDashboard } from "@/components/dashboard/yield-dashboard"
import { vi, describe, it, expect } from "vitest"

describe("YieldDashboard Component", () => {
  it("renders yield dashboard header and APY rate", () => {
    render(<YieldDashboard deployedAmount={100} earnedYield={10} apy={6.5} />)

    expect(screen.getByText("Yield Dashboard")).toBeInTheDocument()
    expect(screen.getByText("6.5% APY")).toBeInTheDocument()
  })

  it("displays deployed amount and earned yield correctly", () => {
    render(<YieldDashboard deployedAmount={500} earnedYield={25} />)

    expect(screen.getByTestId("deployed-amount")).toHaveTextContent("500.00 XLM")
    expect(screen.getByTestId("earned-yield")).toHaveTextContent("25.00 XLM")
  })

  it("disables harvest button when earned yield is 0", () => {
    render(<YieldDashboard deployedAmount={100} earnedYield={0} />)

    const harvestBtn = screen.getByRole("button", { name: /Harvest Yield/i })
    expect(harvestBtn).toBeDisabled()
  })

  it("enables harvest button when deployed amount > 0 and earned yield > 0", () => {
    render(<YieldDashboard deployedAmount={100} earnedYield={15} />)

    const harvestBtn = screen.getByRole("button", { name: /Harvest Yield/i })
    expect(harvestBtn).not.toBeDisabled()
  })

  it("calls onHarvest handler when harvest button is clicked", async () => {
    const handleHarvestMock = vi.fn().mockResolvedValue(undefined)
    render(<YieldDashboard deployedAmount={100} earnedYield={15} onHarvest={handleHarvestMock} />)

    const harvestBtn = screen.getByRole("button", { name: /Harvest Yield/i })
    fireEvent.click(harvestBtn)

    await waitFor(() => {
      expect(handleHarvestMock).toHaveBeenCalledTimes(1)
      expect(screen.getByText("Yield harvested successfully!")).toBeInTheDocument()
    })
  })
})
