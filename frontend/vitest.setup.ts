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
  // @ts-expect-error PointerEvent polyfill for jsdom
  global.PointerEvent = PointerEvent
}

// jsdom doesn't implement the Pointer Events capture API or scrollIntoView,
// which Radix UI's Select relies on — without these, interacting with any
// Select in tests throws "target.hasPointerCapture is not a function".
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Mock URL.createObjectURL and URL.revokeObjectURL for CSV exports in jsdom
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url")
  URL.revokeObjectURL = vi.fn()
}

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

// Mock @creit.tech/stellar-wallets-kit to prevent CommonJS import error with @stellar/freighter-api
vi.mock("@creit.tech/stellar-wallets-kit", () => {
  return {
    StellarWalletsKit: vi.fn().mockImplementation(() => ({
      openModal: vi.fn(),
      setWallet: vi.fn(),
      getAddress: vi.fn().mockResolvedValue({ address: "GBX1234567890TESTADDRESS" }),
      signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "mock_signed_xdr" }),
      disconnect: vi.fn().mockResolvedValue(undefined),
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

// Mock the useJointSaveContracts hooks module
// Tests can override specific functions using vi.mocked() as needed
vi.mock("@/hooks/useJointSaveContracts", () => {
  // Import the mock implementations directly
  return import("@/hooks/__mocks__/useJointSaveContracts")
})
