import React from "react"
import { render, screen, waitFor } from "@/test-utils"
import GroupPage from "@/app/dashboard/group/[id]/page"
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/hooks/useJointSaveContracts")

describe("GroupPage Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders loading skeleton state initially", () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))
    render(<GroupPage params={{ id: "pool-123" }} />)
    expect(screen.getByText("Loading...")).toBeInTheDocument()
  })

  it("renders Pool not found state when pool is null", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => null,
    })

    render(<GroupPage params={{ id: "non-existent-pool" }} />)

    await waitFor(() => {
      expect(screen.getByText("Pool not found")).toBeInTheDocument()
    })
  })

  it("renders dashboard page layout when pool is found", async () => {
    const mockPool = {
      id: "pool-123",
      name: "Community Savings",
      type: "flexible",
      contract_address: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
      token_address: "native",
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPool,
    })

    render(<GroupPage params={{ id: "pool-123" }} />)

    await waitFor(() => {
      expect(screen.getByText("Back to Dashboard")).toBeInTheDocument()
    })
  })
})
