import React from "react"
import { render, screen, waitFor, act } from "@/test-utils"
import { PoolDataProvider, usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { vi, describe, it, expect, beforeEach } from "vitest"

function PoolConsumer() {
  const { pools, loading, error, isPolling, startPolling, stopPolling } = usePoolData()
  return (
    <div>
      <p data-testid="loading">{loading ? "Loading" : "Loaded"}</p>
      <p data-testid="error">{error || "No Error"}</p>
      <p data-testid="count">{pools.length}</p>
      <p data-testid="polling">{isPolling ? "Polling On" : "Polling Off"}</p>
      <button onClick={startPolling}>Start Polling</button>
      <button onClick={stopPolling}>Stop Polling</button>
    </div>
  )
}

describe("PoolDataProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches pool data on mount and updates state", async () => {
    const mockPools = [
      {
        id: "pool-1",
        name: "Pool One",
        type: "flexible",
        total_saved: 100,
        status: "active",
        updated_at: "2026-01-01",
      },
    ]

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPools,
    })

    render(
      <PoolDataProvider>
        <PoolConsumer />
      </PoolDataProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("Loaded")
      expect(screen.getByTestId("count")).toHaveTextContent("1")
    })
  })

  it("handles fetch error gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    render(
      <PoolDataProvider>
        <PoolConsumer />
      </PoolDataProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId("error")).toHaveTextContent("Failed to fetch pools")
    })
  })

  it("toggles polling state when startPolling and stopPolling are called", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })

    render(
      <PoolDataProvider>
        <PoolConsumer />
      </PoolDataProvider>
    )

    expect(screen.getByTestId("polling")).toHaveTextContent("Polling Off")

    const startBtn = screen.getByRole("button", { name: /Start Polling/i })
    act(() => {
      startBtn.click()
    })
    expect(screen.getByTestId("polling")).toHaveTextContent("Polling On")

    const stopBtn = screen.getByRole("button", { name: /Stop Polling/i })
    act(() => {
      stopBtn.click()
    })
    expect(screen.getByTestId("polling")).toHaveTextContent("Polling Off")
  })
})
