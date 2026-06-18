"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  FreighterModule,
  xBullModule,
  AlbedoModule,
  LobstrModule,
} from "@creit.tech/stellar-wallets-kit"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

// Create a single QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// ── Stellar network config ────────────────────────────────────────────────────

export const STELLAR_NETWORK = WalletNetwork.TESTNET
export const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  "https://soroban-testnet.stellar.org"
export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
  "https://horizon-testnet.stellar.org"
export const STELLAR_NETWORK_PASSPHRASE =
  "Test SDF Network ; September 2015"

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
    const walletKit = new StellarWalletsKit({
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
