import React from "react"
import { render, screen, waitFor } from "@/test-utils"
import { GroupActions } from "@/components/group/group-actions"
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/hooks/useJointSaveContracts")

describe("GroupActions Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "pool-1",
        name: "Test Pool",
        type: "flexible",
        token_symbol: "XLM",
        token_decimals: 7,
      }),
    })
  })

  it("renders quick actions title and stellar address info", async () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
        poolType="flexible"
        tokenAddress="native"
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Quick Actions/i)).toBeInTheDocument()
    })
  })

  it("shows contract pending notification when contract address is pending_deployment", async () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="pending_deployment"
        poolType="flexible"
        tokenAddress="native"
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Contract pending deployment/i)).toBeInTheDocument()
    })
  })

  it("disables deposit button when contract is pending", async () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="pending_deployment"
        poolType="flexible"
        tokenAddress="native"
      />
    )

    await waitFor(() => {
      const depositBtn = screen.getByRole("button", { name: /Deposit/i })
      expect(depositBtn).toBeDisabled()
    })
  })

  it("renders rotational pool trigger payout button for rotational pools", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "pool-1",
        name: "Rotational Pool",
        type: "rotational",
        token_symbol: "XLM",
        token_decimals: 7,
      }),
    })

    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
        poolType="rotational"
        tokenAddress="native"
      />
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Trigger Payout/i })).toBeInTheDocument()
    })
  })

  it("renders contribute and withdraw buttons for target pools", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "pool-1",
        name: "Target Pool",
        type: "target",
        token_symbol: "XLM",
        token_decimals: 7,
      }),
    })

    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
        poolType="target"
        tokenAddress="native"
      />
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Contribute/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Withdraw/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Refund/i })).toBeInTheDocument()
    })
  })
})
