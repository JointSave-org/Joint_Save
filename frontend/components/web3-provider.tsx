"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
  xBullModule,
  AlbedoModule,
  LobstrModule,
} from "@creit.tech/stellar-wallets-kit"
import { QueryClient } from "@tanstack/react-query"
import { setSigningKit } from "@/lib/tx-queue"

// Create a single QueryClient instance (reserved for future use)
const _queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// ── E2E test seam ───────────────────────────────────────────────────────────
// When NEXT_PUBLIC_E2E=true we replace the real StellarWalletsKit with a stub so
// Playwright can drive connect/sign flows without a browser wallet extension.
// This branch is dead code in production builds (the flag is unset).
const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"
const E2E_DEFAULT_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"

function createE2EKit(): StellarWalletsKit {
  const getAddr = () =>
    (typeof localStorage !== "undefined" && localStorage.getItem("jointsave_address")) ||
    E2E_DEFAULT_ADDRESS
  const stub = {
    // Auto-select Freighter so connect() resolves without a real modal
    openModal: async ({
      onWalletSelected,
    }: {
      onWalletSelected?: (option: { id: string }) => void
    }) => onWalletSelected?.({ id: FREIGHTER_ID }),
    setWallet: () => {},
    getAddress: async () => ({ address: getAddr() }),
    // Echo the prepared XDR back as "signed" — the RPC layer is also stubbed
    signTransaction: async (xdr: string) => ({ signedTxXdr: xdr }),
    disconnect: async () => {},
  }
  return stub as unknown as StellarWalletsKit
}

// ── Stellar network config ────────────────────────────────────────────────────

export const STELLAR_NETWORK = WalletNetwork.TESTNET
export const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org"
export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org"
export const STELLAR_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

// ── Context ───────────────────────────────────────────────────────────────────

interface StellarContextValue {
  kit: StellarWalletsKit | null
  address: string | null
  walletId: string | null
  isConnected: boolean
  isInitializing: boolean
  connect: () => Promise<void>
  disconnect: () => void
}

const StellarContext = createContext<StellarContextValue>({
  kit: null,
  address: null,
  walletId: null,
  isConnected: false,
  isInitializing: true,
  connect: async () => {},
  disconnect: () => {},
})

export function useStellar() {
  return useContext(StellarContext)
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function Web3Provider({ children }: { children: ReactNode }) {
  const [kit, setKit] = useState<StellarWalletsKit | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [walletId, setWalletId] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  // Initialise the kit once on the client
  useEffect(() => {
    const walletKit = IS_E2E
      ? createE2EKit()
      : new StellarWalletsKit({
          network: STELLAR_NETWORK,
          selectedWalletId: FREIGHTER_ID,
          modules: [
            new FreighterModule(),
            new xBullModule(),
            new AlbedoModule(),
            new LobstrModule(),
          ],
        })
    setKit(walletKit)
    setSigningKit(walletKit)

    const savedAddress = localStorage.getItem("jointsave_address")
    const savedWalletId = localStorage.getItem("jointsave_wallet_id")
    if (savedAddress) setAddress(savedAddress)
    if (savedWalletId) setWalletId(savedWalletId)
    setIsInitializing(false)
  }, [])

  const connect = useCallback(async () => {
    if (!kit) return
    await kit.openModal({
      onWalletSelected: async (option) => {
        kit.setWallet(option.id)
        const { address: addr } = await kit.getAddress()
        setAddress(addr)
        setWalletId(option.id)
        localStorage.setItem("jointsave_address", addr)
        localStorage.setItem("jointsave_wallet_id", option.id)
      },
    })
  }, [kit])

  const disconnect = useCallback(() => {
    if (kit) {
      kit.disconnect().catch(() => {})
    }
    setAddress(null)
    setWalletId(null)
    localStorage.removeItem("jointsave_address")
    localStorage.removeItem("jointsave_wallet_id")
  }, [kit])

  return (
    <StellarContext.Provider
      value={{
        kit,
        address,
        walletId,
        isConnected: !!address,
        isInitializing,
        connect,
        disconnect,
      }}
    >
      {children}
    </StellarContext.Provider>
  )
}
