import React from "react"
import { render, screen, waitFor, within } from "@/test-utils"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BatchDepositPanel } from "@/components/dashboard/batch-deposit-panel"
import {
  fetchRotationalState,
  fetchIsPaused,
  submitContractTx,
} from "@/hooks/useJointSaveContracts"
import { Address, Operation, Transaction, scValToNative } from "@stellar/stellar-sdk"

/**
 * Drives the real BatchDepositPanel through the real useBatchDeposit hook.
 * Only the two genuine boundaries are stubbed: `/api/pools` (network) and the
 * contract layer (RPC + wallet), which vitest.setup.ts already replaces with
 * hooks/__mocks__/useJointSaveContracts.
 */

const WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"
const OTHER_MEMBER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"

/** Distinct, checksum-valid contract ids so each pool is addressable. */
const CONTRACTS = [
  "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE",
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

/** Rows served from `/api/pools?member=…` for the current test. */
let memberPools: PoolRow[] = []
/** PATCH bodies the panel sent, so activity logging can be asserted. */
let loggedActivity: unknown[] = []

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()

    if (init?.method === "PATCH") {
      loggedActivity.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }
    if (url.includes("member=")) {
      return new Response(JSON.stringify({ data: memberPools, total: memberPools.length }), {
        status: 200,
      })
    }
    // The dashboard's own pool list is not under test here.
    return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 })
  })
}

/** Default on-chain answer: active, unpaid, wallet is a member. */
function chainStateOwing(overrides: Record<string, unknown> = {}) {
  return {
    isActive: true,
    currentRound: 3,
    members: [WALLET, OTHER_MEMBER],
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
  loggedActivity = []
  localStorage.setItem("jointsave_address", WALLET)
  localStorage.setItem("jointsave_wallet_id", "freighter")
  vi.stubGlobal("fetch", mockFetch())
  vi.mocked(fetchRotationalState).mockResolvedValue(chainStateOwing())
  vi.mocked(fetchIsPaused).mockResolvedValue(false)
  vi.mocked(submitContractTx).mockImplementation(
    async (
      _tx: unknown,
      opts?: {
        onPhase?: (phase: "signing" | "submitted" | "confirmed", hash?: string) => void
      }
    ) => {
      opts?.onPhase?.("signing")
      opts?.onPhase?.("submitted", "tx_hash_mock")
      opts?.onPhase?.("confirmed", "tx_hash_mock")
      return "tx_hash_mock"
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  localStorage.clear()
})

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId("batch-deposit-panel")
  await user.click(screen.getByRole("button", { name: /batch deposit/i }))
  return screen.findByTestId("batch-deposit-dialog")
}

describe("BatchDepositPanel", () => {
  it("stays hidden when no pool requires a deposit", async () => {
    memberPools = [poolRow(1), poolRow(2)]
    vi.mocked(fetchRotationalState).mockResolvedValue(chainStateOwing({ hasDeposited: true }))

    render(<BatchDepositPanel />)

    await waitFor(() => expect(fetchRotationalState).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId("batch-deposit-panel")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /batch deposit/i })).not.toBeInTheDocument()
  })

  it("stays hidden when the wallet belongs to no pools at all", async () => {
    memberPools = []
    render(<BatchDepositPanel />)
    await waitFor(() => expect(screen.queryByTestId("batch-deposit-panel")).not.toBeInTheDocument())
  })

  it("skips paused pools and pools the wallet is not actually a member of", async () => {
    memberPools = [poolRow(1), poolRow(2), poolRow(3)]

    vi.mocked(fetchIsPaused).mockImplementation(
      async (contractId: string) => contractId === CONTRACTS[1]
    )
    vi.mocked(fetchRotationalState).mockImplementation(async (contractId: string) =>
      contractId === CONTRACTS[2] ? chainStateOwing({ members: [OTHER_MEMBER] }) : chainStateOwing()
    )

    render(<BatchDepositPanel />)

    const panel = await screen.findByTestId("batch-deposit-panel")
    expect(within(panel).getByText(/1 pool needs a deposit/i)).toBeInTheDocument()
  })

  it("lists every pool requiring a deposit with its amount, round and urgency", async () => {
    const user = userEvent.setup()
    memberPools = [
      poolRow(1, { name: "Weekly Circle", contribution_amount: 50 }),
      poolRow(2, { name: "Monthly Circle", contribution_amount: 100 }),
    ]

    render(<BatchDepositPanel />)
    const dialog = await openDialog(user)

    expect(within(dialog).getByText("Weekly Circle")).toBeInTheDocument()
    expect(within(dialog).getByText("Monthly Circle")).toBeInTheDocument()
    expect(within(dialog).getByText(/50 XLM · round 3/)).toBeInTheDocument()
    expect(within(dialog).getByText(/100 XLM · round 3/)).toBeInTheDocument()
    // Deadline is an hour out, so both rows are flagged urgent.
    expect(within(dialog).getByTestId("batch-urgency-pool-1")).toHaveTextContent(/due in 1h/i)
  })

  it("totals the selection and updates as pools are checked and unchecked", async () => {
    const user = userEvent.setup()
    memberPools = [
      poolRow(1, { contribution_amount: 50 }),
      poolRow(2, { contribution_amount: 50 }),
      poolRow(3, { contribution_amount: 50 }),
    ]

    render(<BatchDepositPanel />)
    const dialog = await openDialog(user)

    expect(within(dialog).getByTestId("batch-total")).toHaveTextContent(
      "Depositing to 3 pools: 150 XLM total"
    )

    await user.click(within(dialog).getByTestId("batch-pool-row-pool-2"))
    expect(within(dialog).getByTestId("batch-total")).toHaveTextContent(
      "Depositing to 2 pools: 100 XLM total"
    )

    await user.click(within(dialog).getByRole("button", { name: /^deselect all$/i }))
    expect(within(dialog).getByTestId("batch-total")).toHaveTextContent("No pools selected")
    expect(within(dialog).getByTestId("batch-deposit-now")).toBeDisabled()

    await user.click(within(dialog).getByRole("button", { name: /^select all$/i }))
    expect(within(dialog).getByTestId("batch-total")).toHaveTextContent(
      "Depositing to 3 pools: 150 XLM total"
    )
  })

  it("builds one deposit transaction per selected pool, targeting the right contract", async () => {
    const user = userEvent.setup()
    memberPools = [poolRow(1), poolRow(2)]

    render(<BatchDepositPanel />)
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByTestId("batch-deposit-now"))

    await waitFor(() => expect(submitContractTx).toHaveBeenCalledTimes(2))

    const submitted = vi.mocked(submitContractTx).mock.calls.map(([tx]) => tx as Transaction)
    const invocations = submitted.map((tx) => {
      // Soroban permits exactly one host-function invocation per transaction.
      expect(tx.operations).toHaveLength(1)
      expect(tx.source).toBe(WALLET)

      const op = tx.operations[0] as Operation.InvokeHostFunction
      expect(op.type).toBe("invokeHostFunction")

      const invocation = op.func.invokeContract()
      return {
        contractId: Address.fromScAddress(invocation.contractAddress()).toString(),
        fn: invocation.functionName().toString(),
        args: invocation.args().map((arg) => scValToNative(arg)),
      }
    })

    // Each transaction calls `deposit(member)` on its own pool contract.
    expect(invocations).toEqual([
      { contractId: CONTRACTS[1], fn: "deposit", args: [WALLET] },
      { contractId: CONTRACTS[2], fn: "deposit", args: [WALLET] },
    ])

    const poolIds = vi
      .mocked(submitContractTx)
      .mock.calls.map(([, opts]) => opts?.pendingTx?.poolId)
    expect(poolIds).toEqual([CONTRACTS[1], CONTRACTS[2]])
  })

  it("shows per-pool progress and confirms every deposit", async () => {
    const user = userEvent.setup()
    memberPools = [poolRow(1, { name: "Alpha" }), poolRow(2, { name: "Beta" })]

    render(<BatchDepositPanel />)
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByTestId("batch-deposit-now"))

    const progress = await screen.findByTestId("batch-deposit-progress")
    await waitFor(() =>
      expect(within(progress).getByTestId("batch-progress-label")).toHaveTextContent(
        "Deposited to 2 pools"
      )
    )

    expect(within(progress).getAllByTestId("batch-status-confirmed")).toHaveLength(2)
    expect(within(progress).getByTestId("batch-progress-item-pool-1")).toHaveTextContent("Alpha")
    expect(within(progress).getByTestId("batch-progress-item-pool-2")).toHaveTextContent("Beta")

    // Each confirmed deposit is recorded against its pool.
    expect(loggedActivity).toHaveLength(2)
  })

  it("keeps successful deposits and surfaces why the failed one failed", async () => {
    const user = userEvent.setup()
    memberPools = [poolRow(1, { name: "Alpha" }), poolRow(2, { name: "Beta" })]

    vi.mocked(submitContractTx).mockImplementation(
      async (
        _tx: unknown,
        opts?: {
          pendingTx?: { poolId: string }
          onPhase?: (phase: "signing" | "submitted" | "confirmed", hash?: string) => void
        }
      ) => {
        if (opts?.pendingTx?.poolId === CONTRACTS[2 % CONTRACTS.length]) {
          throw new Error("Simulation failed: insufficient balance")
        }
        opts?.onPhase?.("signing")
        opts?.onPhase?.("confirmed", "tx_hash_mock")
        return "tx_hash_mock"
      }
    )

    render(<BatchDepositPanel />)
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByTestId("batch-deposit-now"))

    const progress = await screen.findByTestId("batch-deposit-progress")
    await waitFor(() =>
      expect(within(progress).getByTestId("batch-progress-label")).toHaveTextContent(
        "1 of 2 deposits confirmed, 1 failed"
      )
    )

    expect(within(progress).getByTestId("batch-progress-item-pool-1")).toHaveTextContent(
      /confirmed/i
    )
    const failedRow = within(progress).getByTestId("batch-progress-item-pool-2")
    expect(failedRow).toHaveTextContent(/failed/i)
    expect(failedRow).toHaveTextContent("Simulation failed: insufficient balance")
  })

  it("retries only the failed pools", async () => {
    const user = userEvent.setup()
    memberPools = [poolRow(1, { name: "Alpha" }), poolRow(2, { name: "Beta" })]

    let failBeta = true
    vi.mocked(submitContractTx).mockImplementation(
      async (
        _tx: unknown,
        opts?: {
          pendingTx?: { poolId: string }
          onPhase?: (phase: "signing" | "submitted" | "confirmed", hash?: string) => void
        }
      ) => {
        const isBeta = opts?.pendingTx?.poolId === CONTRACTS[2 % CONTRACTS.length]
        if (isBeta && failBeta) throw new Error("Send failed")
        opts?.onPhase?.("signing")
        opts?.onPhase?.("confirmed", "tx_hash_mock")
        return "tx_hash_mock"
      }
    )

    render(<BatchDepositPanel />)
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByTestId("batch-deposit-now"))

    const retryButton = await screen.findByTestId("batch-retry-failed")
    expect(retryButton).toHaveTextContent("Retry 1 failed")
    expect(submitContractTx).toHaveBeenCalledTimes(2)

    failBeta = false
    await user.click(retryButton)

    // Exactly one extra transaction — Alpha was already confirmed on-chain.
    await waitFor(() => expect(submitContractTx).toHaveBeenCalledTimes(3))
    expect(vi.mocked(submitContractTx).mock.calls[2][1]?.pendingTx?.poolId).toBe(
      CONTRACTS[2 % CONTRACTS.length]
    )

    await waitFor(() => expect(screen.queryByTestId("batch-retry-failed")).not.toBeInTheDocument())
  })

  it("splits a selection larger than 15 pools into multiple batches", async () => {
    const user = userEvent.setup()
    memberPools = Array.from({ length: 16 }, (_, i) => poolRow(i + 1))
    // Give every pool a unique contract so nothing is de-duplicated.
    memberPools.forEach((p, i) => {
      p.contract_address = CONTRACTS[i % CONTRACTS.length]
    })

    render(<BatchDepositPanel />)
    const dialog = await openDialog(user)

    expect(within(dialog).getByTestId("batch-split-notice")).toHaveTextContent(
      "Split into 2 batches due to transaction size limits"
    )

    // 15 selected still fits in a single batch.
    await user.click(within(dialog).getByTestId("batch-pool-row-pool-16"))
    expect(within(dialog).queryByTestId("batch-split-notice")).not.toBeInTheDocument()
  })
})
