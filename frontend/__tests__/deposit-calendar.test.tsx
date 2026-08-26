import React from "react"
import { render, screen, waitFor, within } from "@/test-utils"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DepositCalendar } from "@/components/dashboard/deposit-calendar/DepositCalendar"
import { fetchRotationalState } from "@/hooks/useJointSaveContracts"
import { useIsMobile } from "@/hooks/use-mobile"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: vi.fn().mockReturnValue(false) }))

/**
 * Drives the real DepositCalendar through the real useDepositCalendar hook,
 * which reuses PoolDataProvider's cache. Only the two genuine boundaries are
 * stubbed: `/api/pools` (network) and the contract layer (RPC), which
 * vitest.setup.ts already replaces with hooks/__mocks__/useJointSaveContracts
 * — the same setup `__tests__/batch-deposit.test.tsx` relies on.
 */

const WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"

const CONTRACTS = [
  "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
]

interface PoolRow {
  id: string
  name: string
  type: string
  status: string
  contract_address: string
  contribution_amount: number | null
  token_symbol: string | null
}

function poolRow(index: number, overrides: Partial<PoolRow> = {}): PoolRow {
  return {
    id: `pool-${index}`,
    name: `Pool ${index}`,
    type: "rotational",
    status: "active",
    contract_address: CONTRACTS[index % CONTRACTS.length],
    contribution_amount: 50,
    token_symbol: "XLM",
    ...overrides,
  }
}

let memberPools: PoolRow[] = []

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()

    if (url.includes("member=")) {
      return new Response(JSON.stringify({ data: memberPools, total: memberPools.length }), {
        status: 200,
      })
    }
    if (url.includes("contract=")) {
      const contract = new URL(url, "http://localhost").searchParams.get("contract")
      const row = memberPools.find((p) => p.contract_address === contract)
      if (!row) return new Response(JSON.stringify({ error: "not found" }), { status: 404 })
      return new Response(JSON.stringify(row), { status: 200 })
    }
    // PoolDataProvider's own background pool list — not under test here.
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

function chainState(overrides: Record<string, unknown> = {}) {
  return {
    isActive: true,
    currentRound: 3,
    members: [WALLET],
    nextPayoutTime: Math.floor(Date.now() / 1000) + 3600,
    hasDeposited: false,
    depositCount: 0,
    treasuryFeeBps: 100,
    relayerFeeBps: 50,
    contractVersion: 1,
    ...overrides,
  }
}

beforeEach(() => {
  memberPools = []
  localStorage.setItem("jointsave_address", WALLET)
  localStorage.setItem("jointsave_wallet_id", "freighter")
  vi.stubGlobal("fetch", mockFetch())
  vi.mocked(fetchRotationalState).mockResolvedValue(chainState())
  vi.mocked(useIsMobile).mockReturnValue(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  localStorage.clear()
})

describe("DepositCalendar", () => {
  it("shows the empty state when the wallet has no rotational pools", async () => {
    memberPools = []
    render(<DepositCalendar />)
    expect(await screen.findByTestId("deposit-calendar-empty-state")).toBeInTheDocument()
  })

  it("excludes completed pools and pools without a deployed contract", async () => {
    memberPools = [
      poolRow(1, { name: "Active Circle" }),
      poolRow(2, { name: "Finished Circle", status: "completed" }),
      poolRow(3, { name: "Not Deployed", contract_address: "pending_deployment" }),
    ]

    render(<DepositCalendar />)

    await waitFor(() =>
      expect(screen.getByTestId("deposit-calendar-event-pool-1")).toBeInTheDocument()
    )
    expect(screen.queryByText("Finished Circle")).not.toBeInTheDocument()
    expect(screen.queryByText("Not Deployed")).not.toBeInTheDocument()
  })

  it("renders each pool's deadline with a checkmark for pools already deposited", async () => {
    // Mobile's list view is used here (not the month grid) so a 10-day-out
    // deadline is never clipped by which calendar month happens to be showing.
    vi.mocked(useIsMobile).mockReturnValue(true)
    const nowSec = Math.floor(Date.now() / 1000)
    // Explicit contract_address overrides — poolRow()'s default of
    // CONTRACTS[index % CONTRACTS.length] would put pool-1 on CONTRACTS[1]
    // and pool-2 on CONTRACTS[0], the opposite of what's intended below.
    memberPools = [
      poolRow(1, { name: "Weekly Circle", contract_address: CONTRACTS[0] }),
      poolRow(2, { name: "Monthly Circle", contract_address: CONTRACTS[1] }),
    ]
    vi.mocked(fetchRotationalState).mockImplementation(async (contractId: string) =>
      contractId === CONTRACTS[1]
        ? chainState({ nextPayoutTime: nowSec + 10 * 86400, hasDeposited: false })
        : chainState({ nextPayoutTime: nowSec + 3600, hasDeposited: true })
    )

    render(<DepositCalendar />)

    // Wait for the checkmark itself, not just the row — the row renders
    // immediately (before the on-chain fetch resolves), so a synchronous
    // assertion right after `findByTestId` can race ahead of the real data.
    await waitFor(() =>
      expect(screen.getByTestId("deposit-calendar-deposited-pool-1")).toBeInTheDocument()
    )
    const weekly = screen.getByTestId("deposit-calendar-event-pool-1")
    expect(within(weekly).getByText("Weekly Circle")).toBeInTheDocument()

    const monthly = screen.getByTestId("deposit-calendar-event-pool-2")
    await waitFor(() =>
      expect(within(monthly).getByText(/due in \d+d/i)).toBeInTheDocument()
    )
    expect(within(monthly).getByText("Monthly Circle")).toBeInTheDocument()
    expect(screen.queryByTestId("deposit-calendar-deposited-pool-2")).not.toBeInTheDocument()
  })

  it("links each event to its pool detail page", async () => {
    memberPools = [poolRow(1, { name: "Weekly Circle" })]
    render(<DepositCalendar />)

    const link = await screen.findByTestId("deposit-calendar-event-pool-1")
    expect(link).toHaveAttribute("href", expect.stringContaining("/dashboard/group/pool-1"))
  })

  it("exports every upcoming deposit when Export All is clicked", async () => {
    // Mobile's list view surfaces the deadline as visible text, so the test
    // can wait for the on-chain fetch to actually resolve before exporting —
    // the row itself renders (with "No deadline") before that fetch settles.
    vi.mocked(useIsMobile).mockReturnValue(true)
    const user = userEvent.setup()
    memberPools = [poolRow(1), poolRow(2)]

    render(<DepositCalendar />)
    // Rows render immediately (before the on-chain fetch resolves) showing
    // "No deadline" — an empty queryAllByText check would pass vacuously
    // before the rows even exist, so assert both the rows and the data.
    await waitFor(() => {
      expect(screen.getAllByTestId(/^deposit-calendar-event-/)).toHaveLength(2)
      expect(screen.queryByText(/no deadline/i)).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId("deposit-calendar-export-all"))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it("exports a single pool's deposit from its own export button", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    const user = userEvent.setup()
    memberPools = [poolRow(1, { name: "Weekly Circle" })]

    render(<DepositCalendar />)
    await waitFor(() => {
      expect(screen.getByTestId("deposit-calendar-event-pool-1")).toBeInTheDocument()
      expect(screen.queryByText(/no deadline/i)).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId("deposit-calendar-export-pool-1"))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it("renders the month grid on desktop", async () => {
    memberPools = [poolRow(1)]
    render(<DepositCalendar />)
    expect(await screen.findByTestId("deposit-calendar-month-grid")).toBeInTheDocument()
    expect(screen.queryByTestId("deposit-calendar-list-view")).not.toBeInTheDocument()
  })

  it("switches to the sorted list/timeline view on mobile", async () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    memberPools = [poolRow(1)]

    render(<DepositCalendar />)
    expect(await screen.findByTestId("deposit-calendar-list-view")).toBeInTheDocument()
    expect(screen.queryByTestId("deposit-calendar-month-grid")).not.toBeInTheDocument()
  })
})
