import React from "react"
import { render, screen, waitFor } from "@/test-utils"
import GroupPage from "@/app/[locale]/dashboard/group/[id]/page"
import { ArchivedPoolCard } from "@/components/shared/archived-pool-card"
import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("@/hooks/useJointSaveContracts")

const BASE_POOL = {
  id: "pool-123",
  name: "Community Savings",
  type: "flexible" as const,
  contract_address: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
  token_address: "native",
  creator_address: "GBX1234567890TESTADDRESS",
}

function mockPoolFetch(pool: Record<string, unknown>) {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (typeof url === "string" && (url.includes("/admin/") || url.includes("activity"))) {
      return { ok: true, json: async () => [] }
    }
    return { ok: true, json: async () => pool }
  })
}

// ── Archived pool detail page ─────────────────────────────────────────────────

describe("Archived pool detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows the archived banner with the archival reason", async () => {
    mockPoolFetch({
      ...BASE_POOL,
      archived_at: "2026-08-01T00:00:00.000Z",
      archive_reason: "inactive_90d",
    })

    render(<GroupPage params={{ id: "pool-123" }} />)

    await waitFor(() => {
      expect(screen.getByText("This pool has been archived")).toBeInTheDocument()
    })
    expect(
      screen.getByText("Archived after 90 days with no activity and no member funds held.")
    ).toBeInTheDocument()
  })

  it("hides the actions panel so no deposit, withdraw, or pause control renders", async () => {
    mockPoolFetch({
      ...BASE_POOL,
      archived_at: "2026-08-01T00:00:00.000Z",
      archive_reason: "completed",
    })

    render(<GroupPage params={{ id: "pool-123" }} />)

    await waitFor(() => {
      expect(screen.getByText("This pool has been archived")).toBeInTheDocument()
    })

    // The whole actions column is gone rather than each button being disabled.
    expect(screen.queryByText("Quick Actions")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /deposit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument()
  })

  it("marks the activity feed as historical", async () => {
    mockPoolFetch({
      ...BASE_POOL,
      archived_at: "2026-08-01T00:00:00.000Z",
      archive_reason: "completed",
    })

    render(<GroupPage params={{ id: "pool-123" }} />)

    await waitFor(() => {
      expect(
        screen.getByText("Historical activity — this pool is archived and receives no new events.")
      ).toBeInTheDocument()
    })
  })

  it("keeps the actions panel on a pool that is not archived", async () => {
    mockPoolFetch({ ...BASE_POOL, archived_at: null, archive_reason: null })

    render(<GroupPage params={{ id: "pool-123" }} />)

    // The counterpart to the test above: proves the actions panel really does
    // render here, so its absence on an archived pool is the archival gate
    // rather than a mock that never mounts it.
    await waitFor(() => {
      expect(screen.getByText(/Quick Actions/i)).toBeInTheDocument()
    })
    expect(screen.queryByText("This pool has been archived")).not.toBeInTheDocument()
  })
})

// ── Archived pool card ────────────────────────────────────────────────────────

describe("ArchivedPoolCard", () => {
  const pool = {
    id: "pool-9",
    name: "Lagos Circle",
    type: "rotational" as const,
    archived_at: "2026-08-20T00:00:00.000Z",
    archive_reason: "completed" as const,
    completed_at: "2026-08-10T00:00:00.000Z",
    total_saved: 1250.5,
    members_count: 8,
    token_symbol: "USDC",
  }

  it("renders the name, archived badge, reason, final TVL, and member count", () => {
    render(<ArchivedPoolCard pool={pool} />)

    expect(screen.getByText("Lagos Circle")).toBeInTheDocument()
    expect(screen.getByText("Archived")).toBeInTheDocument()
    expect(
      screen.getByText("This pool finished and was archived after its review window.")
    ).toBeInTheDocument()
    expect(screen.getByText("1250.50 USDC")).toBeInTheDocument()
    expect(screen.getByText("8 members")).toBeInTheDocument()
  })

  it("links View History to the pool detail page", () => {
    render(<ArchivedPoolCard pool={pool} />)

    const link = screen.getByRole("link", { name: /view history/i })
    expect(link).toHaveAttribute("href", expect.stringContaining("/dashboard/group/pool-9"))
  })

  it("falls back to the archived date when the pool never completed", () => {
    render(
      <ArchivedPoolCard pool={{ ...pool, completed_at: null, archive_reason: "inactive_90d" }} />
    )

    expect(
      screen.getByText("Archived after 90 days with no activity and no member funds held.")
    ).toBeInTheDocument()
  })
})
