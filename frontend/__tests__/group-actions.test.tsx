import React from "react"
import { render, screen, fireEvent, waitFor } from "@/test-utils"
import { GroupActions } from "@/components/group/group-actions"
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/hooks/useJointSaveContracts")

describe("GroupActions Component", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders quick actions title and stellar address info", () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
        poolType="flexible"
        tokenAddress="native"
      />
    )

    expect(screen.getByText("Quick Actions")).toBeInTheDocument()
    expect(screen.getByText("Your Stellar address")).toBeInTheDocument()
  })

  it("shows contract pending notification when contract address is pending_deployment", () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="pending_deployment"
        poolType="flexible"
        tokenAddress="native"
      />
    )

    expect(screen.getByText(/Contract pending deployment/i)).toBeInTheDocument()
  })

  it("disables deposit button when contract is pending", () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="pending_deployment"
        poolType="flexible"
        tokenAddress="native"
      />
    )

    const depositBtn = screen.getByRole("button", { name: /Deposit/i })
    expect(depositBtn).toBeDisabled()
  })

  it("renders rotational pool trigger payout button for rotational pools", () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
        poolType="rotational"
        tokenAddress="native"
      />
    )

    expect(screen.getByRole("button", { name: /Trigger Payout/i })).toBeInTheDocument()
  })

  it("renders contribute and withdraw buttons for target pools", () => {
    render(
      <GroupActions
        groupId="pool-1"
        poolAddress="CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
        poolType="target"
        tokenAddress="native"
      />
    )

    expect(screen.getByRole("button", { name: /Contribute/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Withdraw/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Refund/i })).toBeInTheDocument()
  })
})
