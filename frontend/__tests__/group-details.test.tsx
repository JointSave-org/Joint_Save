import React from "react"
import { render, screen, waitFor } from "@/test-utils"
import { GroupDetails } from "@/components/group/group-details"
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/hooks/useJointSaveContracts")

describe("GroupDetails Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders loading state initially", () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))
    render(<GroupDetails groupId="pool-1" />)
    expect(document.querySelector(".animate-spin")).toBeInTheDocument()
  })

  it("renders error state when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })
    render(<GroupDetails groupId="invalid-id" />)
    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch group/i)).toBeInTheDocument()
    })
  })

  it("renders group details correctly when fetch succeeds", async () => {
    const mockGroup = {
      id: "pool-1",
      name: "Emergency Savings",
      type: "flexible",
      status: "active",
      description: "Savings for emergency",
      total_saved: 500,
      target_amount: 1000,
      progress: 50,
      members_count: 5,
      next_payout: null,
      next_recipient: null,
      created_at: "2026-01-01T00:00:00Z",
      contract_address: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGroup,
    })

    render(<GroupDetails groupId="pool-1" />)

    await waitFor(() => {
      expect(screen.getByText("Emergency Savings")).toBeInTheDocument()
      expect(screen.getByText("Flexible")).toBeInTheDocument()
      expect(screen.getByText("Savings for emergency")).toBeInTheDocument()
    })
  })

  it("renders target pool progress bar correctly", async () => {
    const mockTargetGroup = {
      id: "pool-2",
      name: "Vacation Savings",
      type: "target",
      status: "active",
      description: "Target pool",
      total_saved: 250,
      target_amount: 500,
      progress: 50,
      members_count: 3,
      next_payout: null,
      next_recipient: null,
      created_at: "2026-01-01T00:00:00Z",
      contract_address: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTargetGroup,
    })

    render(<GroupDetails groupId="pool-2" />)

    await waitFor(() => {
      expect(screen.getByText("Vacation Savings")).toBeInTheDocument()
      expect(screen.getByText("Progress to Target")).toBeInTheDocument()
    })
  })

  it("shows contract pending warning when address is pending_deployment", async () => {
    const mockPendingGroup = {
      id: "pool-3",
      name: "Pending Group",
      type: "rotational",
      status: "active",
      description: "Pending",
      total_saved: 0,
      target_amount: null,
      progress: 0,
      members_count: 2,
      created_at: "2026-01-01T00:00:00Z",
      contract_address: "pending_deployment",
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPendingGroup,
    })

    render(<GroupDetails groupId="pool-3" />)

    await waitFor(() => {
      expect(screen.getByText(/Contract pending deployment/i)).toBeInTheDocument()
    })
  })
})
