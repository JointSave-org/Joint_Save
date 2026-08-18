import { renderHook, act, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

// Override the global next/navigation mock so the hook can read & write ?pools=.
// replace() mutates currentParams so the hook re-derives selectedKeys from it,
// mirroring how next/navigation updates the real URL.
let currentParams = new URLSearchParams()
const replaceMock = vi.fn((href: string | { toString(): string }) => {
  const raw = typeof href === "string" ? href : href.toString()
  const qs = raw.replace(/^\?/, "")
  currentParams = new URLSearchParams(qs)
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/explore",
  // Return a fresh snapshot each render so the hook re-derives from the URL
  // after replace() mutates currentParams.
  useSearchParams: () => new URLSearchParams(currentParams.toString()),
  useParams: () => ({}),
}))

// The hook fetches pool data + reputation — stub both at module level.
vi.mock("@/hooks/useJointSaveContracts", () => ({
  fetchReputation: vi.fn().mockResolvedValue({
    totalDeposits: 100n,
    poolsCompleted: 1,
    missedRounds: 0,
    onTimeRate: 9000,
  }),
}))

import {
  usePoolComparison,
  parseComparisonKeys,
  serializeComparisonKeys,
  getPoolComparisonKey,
  MAX_COMPARISON_POOLS,
} from "@/hooks/usePoolComparison"

describe("usePoolComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentParams = new URLSearchParams()
  })

  describe("URL helpers", () => {
    it("parses a comma-separated pools param, de-duplicating and capping at 4", () => {
      expect(parseComparisonKeys("a,b,c")).toEqual(["a", "b", "c"])
      expect(parseComparisonKeys("a,a,b")).toEqual(["a", "b"])
      expect(parseComparisonKeys(" a , b ")).toEqual(["a", "b"])
      expect(parseComparisonKeys("")).toEqual([])
      expect(parseComparisonKeys(null)).toEqual([])
      expect(parseComparisonKeys("1,2,3,4,5")).toHaveLength(MAX_COMPARISON_POOLS)
    })

    it("serializes keys into a comma-separated string capped at 4", () => {
      expect(serializeComparisonKeys(["a", "b"])).toBe("a,b")
      expect(serializeComparisonKeys(["1", "2", "3", "4", "5"])).toBe("1,2,3,4")
      expect(serializeComparisonKeys([])).toBe("")
    })

    it("prefers the contract address as the comparison key, falling back to id", () => {
      expect(
        getPoolComparisonKey({
          id: "uuid-1",
          contract_address: "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
        })
      ).toBe("CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI")
      expect(getPoolComparisonKey({ id: "uuid-2", contract_address: "pending_deployment" })).toBe(
        "uuid-2"
      )
      expect(getPoolComparisonKey({ id: "uuid-3" })).toBe("uuid-3")
      expect(getPoolComparisonKey({ id: "uuid-4", contract_address: "not-a-contract" })).toBe(
        "uuid-4"
      )
    })
  })

  describe("selection behaviour", () => {
    it("reads initial selection from the URL", async () => {
      currentParams = new URLSearchParams("pools=addr1,addr2")
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      const { result } = renderHook(() => usePoolComparison())
      await waitFor(() => expect(result.current.selectedKeys).toEqual(["addr1", "addr2"]))
    })

    it("toggles a pool on and off, syncing to the URL", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      const { result, rerender } = renderHook(() => usePoolComparison())

      act(() => result.current.togglePool("addr1"))
      rerender()
      expect(result.current.selectedKeys).toEqual(["addr1"])
      expect(replaceMock).toHaveBeenCalledWith("?pools=addr1", { scroll: false })

      act(() => result.current.togglePool("addr1"))
      rerender()
      expect(result.current.selectedKeys).toEqual([])
      expect(replaceMock).toHaveBeenCalledWith("?", { scroll: false })
    })

    it("enforces the max of 4 pools when adding", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      currentParams = new URLSearchParams("pools=1,2,3,4")
      const { result } = renderHook(() => usePoolComparison())

      act(() => result.current.togglePool("5"))
      expect(result.current.selectedKeys).toEqual(["1", "2", "3", "4"])
      expect(result.current.isAtMax).toBe(true)
      expect(result.current.canAddMore).toBe(false)
    })

    it("removes a single pool and clears all", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      currentParams = new URLSearchParams("pools=a,b,c")
      const { result, rerender } = renderHook(() => usePoolComparison())

      act(() => result.current.removePool("b"))
      rerender()
      expect(result.current.selectedKeys).toEqual(["a", "c"])

      act(() => result.current.clearSelection())
      rerender()
      expect(result.current.selectedKeys).toEqual([])
    })

    it("marks invalid pool addresses with an error and no data", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })
      currentParams = new URLSearchParams("pools=does-not-exist")
      const { result } = renderHook(() => usePoolComparison())

      await waitFor(() => {
        expect(result.current.pools).toHaveLength(1)
        expect(result.current.pools[0].error).toBeTruthy()
        expect(result.current.pools[0].pool).toBeNull()
      })
    })

    it("fetches full pool data for valid keys", async () => {
      const mockPool = {
        id: "pool-1",
        name: "Family Fund",
        type: "rotational",
        status: "active",
        description: "desc",
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
        pool_members: [{ member_address: "GBX1234567890TESTADDRESS", contribution_amount: 100 }],
      }
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockPool })
      currentParams = new URLSearchParams(
        "pools=CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
      )
      const { result } = renderHook(() => usePoolComparison())

      await waitFor(() => {
        expect(result.current.pools).toHaveLength(1)
        expect(result.current.pools[0].loading).toBe(false)
        expect(result.current.pools[0].pool?.name).toBe("Family Fund")
        expect(result.current.pools[0].error).toBeNull()
      })
    })
  })
})
