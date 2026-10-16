import React from "react"
import { render, screen } from "@/test-utils"
import { VoteCard } from "@/components/governance/vote-card"
import { describe, it, expect, vi } from "vitest"
import type { GovernanceProposal } from "@/lib/governance"

const hexAmount = (baseUnits: bigint) => baseUnits.toString(16).padStart(32, "0")
const hexUtf8 = (value: string) => Buffer.from(value, "utf8").toString("hex")

function yieldProposal(overrides: Partial<GovernanceProposal> = {}): GovernanceProposal {
  return {
    id: "aa".repeat(32),
    proposer: "GPROPOSERADDRESS",
    proposalType: "Custom",
    description: "Allocate 5 tokens to the yield vault",
    votesFor: [],
    votesAgainst: [],
    status: "Active",
    createdAt: 1,
    expiresAt: 999999,
    parameters: {
      action: hexUtf8("alloc"),
      amount: hexAmount(50_000_000n), // 5 tokens at 7 decimals
      vault: hexUtf8("CVAULTCONTRACTADDRESS"),
    },
    ...overrides,
  }
}

describe("VoteCard yield allocation details", () => {
  it("shows the decoded action, amount and vault for an allocation proposal", () => {
    render(
      <VoteCard
        proposal={yieldProposal()}
        votesNeeded={2}
        nowSecs={100}
        currentAddress="GVIEWER"
        isAdmin={false}
        isMember={true}
        votingId={null}
        executingId={null}
        onVote={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.getByText("Yield allocation")).toBeInTheDocument()
    expect(screen.getByText("Allocate to vault")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
  })

  it("shows De-allocate for a dealloc proposal", () => {
    render(
      <VoteCard
        proposal={yieldProposal({
          description: "De-allocate 1 token",
          parameters: {
            action: hexUtf8("dealloc"),
            amount: hexAmount(10_000_000n),
          },
        })}
        votesNeeded={2}
        nowSecs={100}
        currentAddress="GVIEWER"
        isAdmin={false}
        isMember={true}
        votingId={null}
        executingId={null}
        onVote={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.getByText("De-allocate from vault")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("does not render the yield block for a plain custom proposal", () => {
    render(
      <VoteCard
        proposal={yieldProposal({ parameters: {} })}
        votesNeeded={2}
        nowSecs={100}
        currentAddress="GVIEWER"
        isAdmin={false}
        isMember={true}
        votingId={null}
        executingId={null}
        onVote={vi.fn()}
        onExecute={vi.fn()}
      />
    )

    expect(screen.queryByText("Yield allocation")).not.toBeInTheDocument()
  })
})
