import React from "react"
import { render, screen } from "@/test-utils"
import { describe, it, expect } from "vitest"
import BridgePage from "@/app/[locale]/bridge/page"

describe("BridgePage", () => {
  it("renders the interactive bridge heading", () => {
    render(<BridgePage />)
    expect(screen.getByRole("heading", { name: /bridge usdc to stellar/i })).toBeInTheDocument()
  })

  it("renders the cross-chain transfer form", () => {
    render(<BridgePage />)
    expect(screen.getByText(/Start a transfer/i)).toBeInTheDocument()
    expect(screen.getByText(/Destination is always native USDC on Stellar/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText("100")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start bridge/i })).toBeInTheDocument()
  })

  it("lists CCTP source chains as options", () => {
    render(<BridgePage />)
    const select = screen.getByRole("combobox")
    expect(select).toBeInTheDocument()
  })

  it("prompts unconnected users to connect a wallet", () => {
    render(<BridgePage />)
    expect(screen.getByText("Connect your wallet")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /start bridge/i })).toBeDisabled()
  })

  it("does not show transfer progress before starting", () => {
    render(<BridgePage />)
    expect(screen.queryByText(/Transfer progress/i)).not.toBeInTheDocument()
  })
})
