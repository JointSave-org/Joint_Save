import React from "react"
import { render, screen } from "@/test-utils"
import { YieldDashboard } from "@/components/group/yield-dashboard"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { useYieldAllocation } from "@/hooks/useYieldAllocation"

vi.mock("@/hooks/useYieldAllocation")

const mockUseYieldAllocation = vi.mocked(useYieldAllocation)

function allocationState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    state: {
      vault: "CVAULTCONTRACTADDRESS",
      shares: 2_000_000_000n,
      costBasis: 100_000_000n,
      bufferBps: 2000,
      locked: false,
      position: 150_000_000n, // 15 tokens at 7 decimals
      unrealised: 50_000_000n, // 5 tokens
      maxAllocatable: 40_000_000n, // 4 tokens
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    maxAllocatable: 40_000_000n,
    applyAllocation: vi.fn(),
    deallocate: vi.fn(),
    sync: vi.fn(),
    setBuffer: vi.fn(),
    setLocked: vi.fn(),
    ...overrides,
  }
}

describe("YieldDashboard vault allocation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders vault position, unrealised yield and max allocatable", async () => {
    mockUseYieldAllocation.mockReturnValue(allocationState() as never)

    render(<YieldDashboard poolAddress="CPOOLADDRESS" />)

    expect(screen.getByText("Vault Allocation")).toBeInTheDocument()
    expect(screen.getByText("Position value")).toBeInTheDocument()
    // 15 tokens position value (150_000_000 base units at 7 decimals)
    expect(screen.getByText("15")).toBeInTheDocument()
    expect(screen.getByText("Unrealised yield")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
    expect(screen.getByText("Available to allocate")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
  })

  it("shows the illiquidity badge and lock toggle when the vault is locked", () => {
    mockUseYieldAllocation.mockReturnValue(
      allocationState({
        state: {
          vault: "CVAULTCONTRACTADDRESS",
          shares: 2_000_000_000n,
          costBasis: 1_000_000_000n,
          bufferBps: 2000,
          locked: true,
          position: 1_500_000_000n,
          unrealised: 500_000_000n,
          maxAllocatable: 0n,
        },
      }) as never
    )

    render(<YieldDashboard poolAddress="CPOOLADDRESS" />)

    expect(screen.getByText("Vault locked")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Unlock vault/i })).toBeInTheDocument()
  })

  it("shows the empty state when no vault is configured", () => {
    mockUseYieldAllocation.mockReturnValue(
      allocationState({
        state: {
          vault: null,
          shares: 0n,
          costBasis: 0n,
          bufferBps: 2000,
          locked: false,
          position: 0n,
          unrealised: 0n,
          maxAllocatable: 0n,
        },
      }) as never
    )

    render(<YieldDashboard poolAddress="CPOOLADDRESS" />)

    expect(
      screen.getByText("No capital allocated to a vault yet.")
    ).toBeInTheDocument()
  })

  it("surfaces a load error when the hook reports one", () => {
    mockUseYieldAllocation.mockReturnValue(
      allocationState({ state: null, error: "Failed to load yield state" }) as never
    )

    render(<YieldDashboard poolAddress="CPOOLADDRESS" />)

    expect(screen.getByText("Failed to load yield state")).toBeInTheDocument()
  })
})
