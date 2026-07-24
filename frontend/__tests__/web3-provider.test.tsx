import React from "react"
import { render, screen, act } from "@/test-utils"
import { useStellar, STELLAR_NETWORK } from "@/components/web3-provider"
import { vi, describe, it, expect, beforeEach } from "vitest"

function TestConsumer() {
  const { address, isConnected, connect, disconnect } = useStellar()
  return (
    <div>
      <p data-testid="address">{address || "Disconnected"}</p>
      <p data-testid="status">{isConnected ? "Connected" : "Not Connected"}</p>
      <button onClick={connect}>Connect Wallet</button>
      <button onClick={disconnect}>Disconnect Wallet</button>
    </div>
  )
}

describe("Web3Provider", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("exports correct STELLAR_NETWORK constant", () => {
    expect(STELLAR_NETWORK).toBeDefined()
  })

  it("provides disconnected wallet context by default", () => {
    render(<TestConsumer />)

    expect(screen.getByTestId("address")).toHaveTextContent("Disconnected")
    expect(screen.getByTestId("status")).toHaveTextContent("Not Connected")
  })

  it("restores address from localStorage if previously connected", () => {
    const mockAddress = "GBX1234567890TESTADDRESS"
    localStorage.setItem("jointsave_address", mockAddress)

    render(<TestConsumer />)

    expect(screen.getByTestId("address")).toHaveTextContent(mockAddress)
    expect(screen.getByTestId("status")).toHaveTextContent("Connected")
  })

  it("clears session on disconnect", () => {
    const mockAddress = "GBX1234567890TESTADDRESS"
    localStorage.setItem("jointsave_address", mockAddress)

    render(<TestConsumer />)

    const disconnectBtn = screen.getByRole("button", { name: /Disconnect Wallet/i })
    act(() => {
      disconnectBtn.click()
    })

    expect(screen.getByTestId("address")).toHaveTextContent("Disconnected")
    expect(localStorage.getItem("jointsave_address")).toBeNull()
  })
})
