import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  SUPPORTED_TOKENS,
  getTokenBySymbol,
  getTokenByAddress,
  formatTokenDisplayAmount,
  getTokenBalance,
  getUsdApproxValue,
  formatUsdApprox,
} from "@/lib/token-utils"
import { fetchTokenBalance } from "@/hooks/useJointSaveContracts"

vi.mock("@/hooks/useJointSaveContracts")

describe("token-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("SUPPORTED_TOKENS", () => {
    it("registers native XLM and USDC", () => {
      const symbols = SUPPORTED_TOKENS.map((t) => t.symbol)
      expect(symbols).toEqual(["XLM", "USDC"])
    })

    it("gives XLM the native address and 7 decimals", () => {
      const xlm = SUPPORTED_TOKENS[0]
      expect(xlm.contractAddress).toBe("native")
      expect(xlm.decimals).toBe(7)
    })

    it("gives USDC a Stellar contract address", () => {
      const usdc = SUPPORTED_TOKENS[1]
      expect(usdc.contractAddress).toMatch(/^C[A-Z0-9]{55}$/)
    })
  })

  describe("getTokenBySymbol", () => {
    it("finds a token case-insensitively", () => {
      expect(getTokenBySymbol("usdc")?.symbol).toBe("USDC")
      expect(getTokenBySymbol("XLM")?.symbol).toBe("XLM")
    })

    it("returns undefined for an unknown or missing symbol", () => {
      expect(getTokenBySymbol("BTC")).toBeUndefined()
      expect(getTokenBySymbol(null)).toBeUndefined()
      expect(getTokenBySymbol(undefined)).toBeUndefined()
    })
  })

  describe("getTokenByAddress", () => {
    it("resolves 'native' to the XLM entry", () => {
      expect(getTokenByAddress("native")?.symbol).toBe("XLM")
    })

    it("resolves a known contract id to its token", () => {
      const usdc = SUPPORTED_TOKENS[1]
      expect(getTokenByAddress(usdc.contractAddress)?.symbol).toBe("USDC")
    })

    it("returns undefined for an unregistered address", () => {
      expect(getTokenByAddress("CUNKNOWNTOKENADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")).toBeUndefined()
    })
  })

  describe("formatTokenDisplayAmount", () => {
    it("formats base units using the token's decimals", () => {
      const xlm = getTokenBySymbol("XLM")!
      expect(formatTokenDisplayAmount(1250000000n, xlm)).toBe("125.00 XLM")
    })

    it("formats a zero balance", () => {
      const usdc = getTokenBySymbol("USDC")!
      expect(formatTokenDisplayAmount(0n, usdc)).toBe("0.00 USDC")
    })
  })

  describe("getTokenBalance", () => {
    it("converts the on-chain base-unit balance to a human number", async () => {
      vi.mocked(fetchTokenBalance).mockResolvedValueOnce(500000000n)
      const xlm = getTokenBySymbol("XLM")!
      const balance = await getTokenBalance("GABCDEF", xlm)
      expect(balance).toBe(50)
      expect(fetchTokenBalance).toHaveBeenCalledWith(xlm.contractAddress, "GABCDEF")
    })

    it("resolves to 0 instead of throwing when the RPC call fails", async () => {
      vi.mocked(fetchTokenBalance).mockRejectedValueOnce(new Error("account not found"))
      const usdc = getTokenBySymbol("USDC")!
      const balance = await getTokenBalance("GABCDEF", usdc)
      expect(balance).toBe(0)
    })
  })

  describe("getUsdApproxValue", () => {
    it("treats USDC as ~1:1 with USD", () => {
      const usdc = getTokenBySymbol("USDC")!
      expect(getUsdApproxValue(100, usdc)).toBe(100)
    })

    it("applies the fallback rate for XLM", () => {
      const xlm = getTokenBySymbol("XLM")!
      expect(getUsdApproxValue(100, xlm)).toBeCloseTo(12, 5)
    })

    it("returns 0 for non-positive or non-finite amounts", () => {
      const xlm = getTokenBySymbol("XLM")!
      expect(getUsdApproxValue(0, xlm)).toBe(0)
      expect(getUsdApproxValue(-5, xlm)).toBe(0)
      expect(getUsdApproxValue(NaN, xlm)).toBe(0)
    })
  })

  describe("formatUsdApprox", () => {
    it("formats with the approx symbol and 2 decimals", () => {
      const usdc = getTokenBySymbol("USDC")!
      expect(formatUsdApprox(42.5, usdc)).toBe("≈ $42.50")
    })
  })
})
