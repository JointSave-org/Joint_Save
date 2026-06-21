import type { Page } from "@playwright/test"
import { E2E_ADDRESS, E2E_MEMBER_2 } from "./constants"

export { E2E_ADDRESS, E2E_MEMBER_2 }

/** Truncated form the UI renders for an address (`XXXX...XXXX`). */
export function truncate(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`
}

/** Shape of the per-test on-chain overrides consumed by the E2E seam. */
export interface E2EChainState {
  isActive?: boolean
  isPaused?: boolean
  isUnlocked?: boolean
  currentRound?: number
  members?: string[]
  nextPayoutTime?: number
  hasDeposited?: boolean
  admin?: string
  totalDeposited?: number | string
  targetAmount?: number | string
  totalBalance?: number | string
  balanceOf?: number | string
  treasuryFeeBps?: number
  relayerFeeBps?: number
  events?: unknown[]
}

/**
 * Seed `window.__E2E_STATE__` *before any page script runs* so the contract-read
 * seam returns these values. Safe to call with `{}` for sensible defaults.
 */
export async function seedChainState(page: Page, state: E2EChainState = {}) {
  await page.addInitScript((s) => {
    ;(window as any).__E2E_STATE__ = s
  }, state)
}

/**
 * Put the app in a "wallet connected" state by seeding the same localStorage keys
 * web3-provider restores on mount. No real wallet involved.
 */
export async function connectWallet(page: Page, address: string = E2E_ADDRESS) {
  await page.addInitScript((addr) => {
    localStorage.setItem("jointsave_address", addr)
    localStorage.setItem("jointsave_wallet_id", "freighter")
  }, address)
}
