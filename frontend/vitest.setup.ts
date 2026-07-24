import "@testing-library/jest-dom"
import { vi } from "vitest"

// Mock matchMedia for components like Framer Motion or Theme Provider
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock PointerEvent if needed by Radix UI
if (!global.PointerEvent) {
  class PointerEvent extends Event {
    button = 0
    ctrlKey = false
    metaKey = false
    shiftKey = false
    altKey = false
  }
  // @ts-ignore
  global.PointerEvent = PointerEvent
}

// Mock @creit.tech/stellar-wallets-kit to prevent CommonJS import error with @stellar/freighter-api
vi.mock("@creit.tech/stellar-wallets-kit", () => {
  return {
    StellarWalletsKit: vi.fn().mockImplementation(() => ({
      openModal: vi.fn(),
      setWallet: vi.fn(),
      getAddress: vi.fn().mockResolvedValue({ address: "GBX1234567890TESTADDRESS" }),
      signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "mock_signed_xdr" }),
    })),
    WalletNetwork: {
      TESTNET: "TESTNET",
      PUBLIC: "PUBLIC",
    },
    FREIGHTER_ID: "freighter",
    FreighterModule: vi.fn(),
    xBullModule: vi.fn(),
    AlbedoModule: vi.fn(),
    LobstrModule: vi.fn(),
  }
})
