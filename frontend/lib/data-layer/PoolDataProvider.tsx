"use client"

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react"
import { useStellar } from "@/components/web3-provider"
import {
  fetchRotationalState,
  fetchTargetState,
  fetchFlexibleState,
  fetchIsPaused,
  fetchPoolAdmin,
  fetchPoolTtl,
  type RotationalPoolState,
  type TargetPoolState,
  type FlexiblePoolState,
} from "@/hooks/useJointSaveContracts"

// ── Constants ─────────────────────────────────────────────────────────────────
const STALE_TIME_MS = 15000

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PoolData {
  id: string
  name: string
  type: string
  total_saved: number
  status: string
  updated_at: string
}

export interface PoolStateCache {
  db: Record<string, unknown> | null
  onchain: RotationalPoolState | TargetPoolState | FlexiblePoolState | null
  isPaused: boolean
  poolAdmin: string | null
  ttlDays: number | null
  lastFetched: number
  isLoading: boolean
  isStale: boolean
  error: string | null
}

export interface CacheStats {
  hits: number
  misses: number
  lastFetch: number | null
}

interface PoolDataContextType {
  pools: PoolData[]
  loading: boolean
  error: string | null
  isPolling: boolean
  startPolling: () => void
  stopPolling: () => void
  refresh: () => Promise<void>
  getCache: (contractId: string) => PoolStateCache | undefined
  getStats: (contractId: string) => CacheStats | undefined
  fetchPool: (contractId: string, isBackground?: boolean) => Promise<void>
  seedCache: (contractId: string, dbData: Record<string, unknown>) => void
  registerInterest: (contractId: string) => void
  unregisterInterest: (contractId: string) => void
  subscribe: (listener: () => void) => () => void
  recordHit: (contractId: string) => void
}

// ── Context ───────────────────────────────────────────────────────────────────

const PoolDataContext = createContext<PoolDataContextType | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function PoolDataProvider({
  children,
  pollInterval = 10000,
}: {
  children: ReactNode
  pollInterval?: number
}) {
  const { address } = useStellar()
  const [pools, setPools] = useState<PoolData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)

  // Cache & observer refs
  const cacheRef = useRef<Record<string, PoolStateCache>>({})
  const statsRef = useRef<Record<string, CacheStats>>({})
  const activeContractsRef = useRef<Set<string>>(new Set())
  const fetchingPromisesRef = useRef<Record<string, Promise<void> | undefined>>({})
  const listenersRef = useRef<Set<() => void>>(new Set())
  const addressRef = useRef<string | null>(null)

  useEffect(() => {
    addressRef.current = address
  }, [address])

  const notifyListeners = useCallback(() => {
    listenersRef.current.forEach((fn) => fn())
  }, [])

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => listenersRef.current.delete(listener)
  }, [])

  const getCache = useCallback((contractId: string) => cacheRef.current[contractId], [])
  const getStats = useCallback((contractId: string) => statsRef.current[contractId], [])

  const recordMiss = (contractId: string) => {
    const current = statsRef.current[contractId] ?? { hits: 0, misses: 0, lastFetch: null }
    statsRef.current[contractId] = { ...current, misses: current.misses + 1 }
  }

  const recordHit = useCallback(
    (contractId: string) => {
      const current = statsRef.current[contractId] ?? { hits: 0, misses: 0, lastFetch: null }
      statsRef.current[contractId] = { ...current, hits: current.hits + 1 }
      notifyListeners()
    },
    [notifyListeners]
  )

  const setEntry = (contractId: string, patch: Partial<PoolStateCache>) => {
    const prev = cacheRef.current[contractId] ?? {
      db: null,
      onchain: null,
      isPaused: false,
      poolAdmin: null,
      ttlDays: null,
      lastFetched: 0,
      isLoading: false,
      isStale: true,
      error: null,
    }
    cacheRef.current[contractId] = { ...prev, ...patch }
    notifyListeners()
  }

  const seedCache = useCallback(
    (contractId: string, dbData: Record<string, unknown>) => {
      if (!contractId || !dbData) return
      if (!cacheRef.current[contractId]?.lastFetched) {
        cacheRef.current[contractId] = {
          db: dbData,
          onchain: null,
          isPaused: false,
          poolAdmin: null,
          ttlDays: null,
          lastFetched: 0,
          isLoading: false,
          isStale: true,
          error: null,
        }
        notifyListeners()
      }
    },
    [notifyListeners]
  )

  const registerInterest = useCallback((contractId: string) => {
    if (!contractId) return
    activeContractsRef.current.add(contractId)
  }, [])

  const unregisterInterest = useCallback((contractId: string) => {
    if (!contractId) return
    activeContractsRef.current.delete(contractId)
  }, [])

  const fetchPools = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true)
    try {
      const res = await fetch("/api/pools")
      if (!res.ok) throw new Error("Failed to fetch pools")
      const data = await res.json()
      setPools(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || "An error occurred while fetching pools")
    } finally {
      if (!isBackground) setLoading(false)
    }
  }, [])

  const fetchPool = useCallback(
    async (contractId: string, isBackground = false) => {
      if (!contractId || contractId === "pending_deployment") return
      if (fetchingPromisesRef.current[contractId]) {
        return fetchingPromisesRef.current[contractId]
      }

      recordMiss(contractId)
      if (!isBackground) {
        setEntry(contractId, { isLoading: true })
      }

      const promise = (async () => {
        try {
          const isStellarContract = /^C[A-Z2-7]{55}$/.test(contractId)
          const url = isStellarContract
            ? `/api/pools?contract=${contractId}`
            : `/api/pools?id=${contractId}`

          const dbRes = await fetch(url)
          if (!dbRes.ok) throw new Error("Failed to load pool from database")
          const dbData = (await dbRes.json()) as { type?: string; contract_address?: string }

          let onchainState = null
          let isPaused = false
          let poolAdmin: string | null = null
          let ttlDays: number | null = null
          const contractAddr: string = dbData?.contract_address ?? ""
          const isPending = !contractAddr || contractAddr === "pending_deployment"

          if (!isPending) {
            const userAddress = addressRef.current || undefined
            const promises: Promise<unknown>[] = []

            if (dbData.type === "rotational") {
              promises.push(fetchRotationalState(contractAddr))
            } else if (dbData.type === "target") {
              promises.push(fetchTargetState(contractAddr, userAddress))
            } else if (dbData.type === "flexible") {
              promises.push(fetchFlexibleState(contractAddr, userAddress))
            }

            promises.push(fetchIsPaused(contractAddr))
            promises.push(fetchPoolAdmin(contractAddr))
            promises.push(fetchPoolTtl(contractAddr))

            const [stateVal, pausedVal, adminVal, ttlVal] = await Promise.all(promises)
            onchainState = stateVal
            isPaused = pausedVal as boolean
            poolAdmin = adminVal as string | null
            ttlDays = ttlVal as number | null
          }

          const fetchTime = Date.now()
          cacheRef.current[contractId] = {
            db: dbData,
            onchain: onchainState as any,
            isPaused,
            poolAdmin,
            ttlDays,
            lastFetched: fetchTime,
            isLoading: false,
            isStale: false,
            error: null,
          }
          const s = statsRef.current[contractId] ?? { hits: 0, misses: 0, lastFetch: null }
          statsRef.current[contractId] = { ...s, lastFetch: fetchTime }
          notifyListeners()
        } catch (err: unknown) {
          setEntry(contractId, {
            isLoading: false,
            error: (err as Error)?.message ?? "Failed to load pool details",
          })
        } finally {
          delete fetchingPromisesRef.current[contractId]
        }
      })()

      fetchingPromisesRef.current[contractId] = promise
      return promise
    },
    [notifyListeners]
  )

  const startPolling = useCallback(() => {
    setIsPolling(true)
  }, [])

  const stopPolling = useCallback(() => {
    setIsPolling(false)
  }, [])

  useEffect(() => {
    fetchPools()
  }, [fetchPools])

  useEffect(() => {
    if (!isPolling) return
    const timer = setInterval(() => {
      fetchPools(true)
      const activeIds = Array.from(activeContractsRef.current)
      activeIds.forEach((id) => fetchPool(id, true))
    }, pollInterval)
    return () => clearInterval(timer)
  }, [isPolling, pollInterval, fetchPools, fetchPool])

  return (
    <PoolDataContext.Provider
      value={{
        pools,
        loading,
        error,
        isPolling,
        startPolling,
        stopPolling,
        refresh: () => fetchPools(false),
        getCache,
        getStats,
        fetchPool,
        seedCache,
        registerInterest,
        unregisterInterest,
        subscribe,
        recordHit,
      }}
    >
      {children}
    </PoolDataContext.Provider>
  )
}

export function usePoolData(contractId?: string) {
  const context = useContext(PoolDataContext)
  if (!context) {
    throw new Error("usePoolData must be used within a PoolDataProvider")
  }

  const {
    pools,
    loading,
    error,
    isPolling,
    startPolling,
    stopPolling,
    refresh,
    getCache,
    fetchPool,
    registerInterest,
    unregisterInterest,
    subscribe,
    recordHit,
  } = context

  // Force re-render when provider notifies
  const [, forceRender] = useState(0)
  useEffect(() => {
    return subscribe(() => forceRender((n) => n + 1))
  }, [subscribe])

  useEffect(() => {
    if (!contractId || contractId === "pending_deployment") return
    registerInterest(contractId)
    return () => unregisterInterest(contractId)
  }, [contractId, registerInterest, unregisterInterest])

  useEffect(() => {
    if (!contractId || contractId === "pending_deployment") return
    const entry = getCache(contractId)
    if (!entry || !entry.lastFetched) {
      fetchPool(contractId, false)
    } else {
      recordHit(contractId)
      const isStale = Date.now() - entry.lastFetched > STALE_TIME_MS
      if (isStale) {
        fetchPool(contractId, true)
      }
    }
  }, [contractId, fetchPool, getCache, recordHit])

  const refetch = useCallback(async () => {
    if (!contractId || contractId === "pending_deployment") return
    await fetchPool(contractId, false)
  }, [contractId, fetchPool])

  if (!contractId) {
    return {
      pools,
      loading,
      error,
      isPolling,
      startPolling,
      stopPolling,
      refresh,
    }
  }

  if (contractId === "pending_deployment") {
    return {
      data: null,
      isLoading: false,
      isStale: false,
      isPaused: false,
      poolAdmin: null,
      ttlDays: null,
      error: null,
      refetch: async () => {},
    }
  }

  const entry = getCache(contractId)
  const isStale = entry ? Date.now() - entry.lastFetched > STALE_TIME_MS : false

  return {
    data: entry ? { db: entry.db, onchain: entry.onchain } : null,
    isLoading: entry ? entry.isLoading : true,
    isStale: entry ? entry.isStale || isStale : false,
    isPaused: entry ? entry.isPaused : false,
    poolAdmin: entry ? entry.poolAdmin : null,
    ttlDays: entry ? entry.ttlDays : null,
    error: entry ? entry.error : null,
    refetch,
    pools,
    loading,
    isPolling,
    startPolling,
    stopPolling,
    refresh,
  }
}
