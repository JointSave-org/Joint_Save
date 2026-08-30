import React from "react"
import { render, screen, fireEvent } from "@/test-utils"
import { describe, it, expect, vi } from "vitest"
import { ComparisonTable } from "@/components/explore/comparison-table"
import type { ComparisonPool } from "@/hooks/usePoolComparison"

type PoolOverrides = Partial<ComparisonPool["pool"] & { key?: string }>

function makePool(overrides: PoolOverrides = {}): ComparisonPool {
  const { key, ...poolOverrides } = overrides as { key?: string }
  return {
    key: key ?? "pool-1",
    pool: {
      id: "pool-1",
      name: "Family Fund",
      type: "rotational",
      status: "active",
      description: "Save for the family trip",
      contract_address: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
      token_symbol: "XLM",
      token_decimals: 7,
      contribution_amount: 100,
      target_amount: null,
      minimum_deposit: null,
      members_count: 5,
      frequency: "weekly",
      round_duration: 604800,
      deadline: null,
      created_at: "2026-01-01T00:00:00Z",
      total_saved: 500,
      ...(poolOverrides as Partial<ComparisonPool["pool"]>),
    },
    loading: false,
    error: null,
    health: {
      state: "scored",
      score: 90,
      band: "healthy",
      label: "Healthy",
      memberCount: 5,
      historyObserved: 3,
    },
    avgReputation: 90,
  }
}

describe("ComparisonTable", () => {
  it("renders all specified rows for a set of pools", () => {
    const pools = [
      makePool({
        key: "pool-1",
        name: "Family Fund",
        total_saved: 500,
        members_count: 5,
        contribution_amount: 100,
      }),
      makePool({
        key: "pool-2",
        name: "Vacation Club",
        id: "pool-2",
        total_saved: 800,
        members_count: 3,
        contribution_amount: 50,
      }),
    ]
    render(<ComparisonTable pools={pools} />)

    expect(screen.getByText("Pool Type")).toBeInTheDocument()
    expect(screen.getByText("TVL")).toBeInTheDocument()
    expect(screen.getByText("Members")).toBeInTheDocument()
    expect(screen.getByText("Deposit Amount")).toBeInTheDocument()
    expect(screen.getByText("Token")).toBeInTheDocument()
    expect(screen.getByText("Round Duration")).toBeInTheDocument()
    expect(screen.getByText("Health Score")).toBeInTheDocument()
    expect(screen.getByText("Avg Member Reputation")).toBeInTheDocument()
    expect(screen.getByText("Created")).toBeInTheDocument()
    expect(screen.getByText("Description")).toBeInTheDocument()

    expect(screen.getByText("Family Fund")).toBeInTheDocument()
    expect(screen.getByText("Vacation Club")).toBeInTheDocument()
  })

  it("highlights the best TVL and lowest deposit with badges", () => {
    const pools = [
      makePool({ key: "pool-1", name: "Family Fund", total_saved: 500, contribution_amount: 100 }),
      makePool({
        key: "pool-2",
        name: "Vacation Club",
        id: "pool-2",
        total_saved: 800,
        contribution_amount: 50,
      }),
    ]
    render(<ComparisonTable pools={pools} />)

    // 800 is the highest TVL → "Best" badge
    expect(screen.getAllByText("Best").length).toBeGreaterThanOrEqual(1)
    // 50 is the lowest deposit → "Lowest" badge
    expect(screen.getByText("Lowest")).toBeInTheDocument()
  })

  it("shows an error column for invalid pool addresses", () => {
    const pools = [
      makePool({ key: "pool-1", name: "Family Fund" }),
      {
        key: "bad-address",
        pool: null,
        loading: false,
        error: "Pool not found",
        health: null,
        avgReputation: null,
      },
    ]
    render(<ComparisonTable pools={pools} />)

    expect(screen.getByText("Invalid pool")).toBeInTheDocument()
    expect(screen.getByText(/Pool not found/)).toBeInTheDocument()
  })

  it("renders loading skeletons while a pool is being fetched", () => {
    const pools = [
      { key: "pool-1", pool: null, loading: true, error: null, health: null, avgReputation: null },
    ]
    render(<ComparisonTable pools={pools} />)
    expect(screen.getByLabelText("Pool comparison")).toBeInTheDocument()
  })

  it("calls onRemove when the remove button is clicked", () => {
    const onRemove = vi.fn()
    const pools = [makePool({ key: "pool-1", name: "Family Fund" })]
    render(<ComparisonTable pools={pools} onRemove={onRemove} />)

    fireEvent.click(screen.getByLabelText("Remove Family Fund from comparison"))
    expect(onRemove).toHaveBeenCalledWith("pool-1")
  })

  it("renders a Join Pool CTA linking to the join flow", () => {
    const pools = [
      makePool({
        key: "pool-1",
        name: "Family Fund",
        contract_address: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
      }),
    ]
    render(<ComparisonTable pools={pools} />)
    const joinLink = screen.getByRole("link", { name: /Join Pool/ })
    expect(joinLink).toHaveAttribute(
      "href",
      "/en/join/CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
    )
  })
})
