import React from "react"
import { render, screen } from "@/test-utils"
import { describe, it, expect } from "vitest"
import BridgePage from "@/app/bridge/page"

describe("BridgePage", () => {
  it("renders the page heading", () => {
    render(<BridgePage />)
    expect(screen.getByRole("heading", { name: /bridge usdc to stellar/i })).toBeInTheDocument()
  })

  it("explains both bridging paths", () => {
    render(<BridgePage />)
    expect(screen.getAllByText(/Cross-Chain Transfer Protocol \(CCTP\)/i).length).toBeGreaterThan(
      0
    )
    expect(screen.getByText(/Option B: Stellar's native USDC/i)).toBeInTheDocument()
  })

  it("clarifies bridging happens on external services", () => {
    render(<BridgePage />)
    expect(screen.getByText(/This page is educational only/i)).toBeInTheDocument()
  })

  it("links back to the dashboard", () => {
    render(<BridgePage />)
    const link = screen.getByRole("link", { name: /go to your dashboard/i })
    expect(link).toHaveAttribute("href", "/dashboard")
  })

  it("links out to Circle CCTP and Stellar Expert", () => {
    render(<BridgePage />)
    expect(screen.getByRole("link", { name: /circle cctp/i })).toHaveAttribute(
      "href",
      "https://www.circle.com/cross-chain-transfer-protocol"
    )
    expect(screen.getByRole("link", { name: /stellar expert/i })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet"
    )
  })
})
