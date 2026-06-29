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

// ── Types ─────────────────────────────────────────────────────────────────────

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
  getCache: (contractId: string) => PoolStateCache | undefined
  getStats: (contractId: string) => CacheStats | undefined
  fetchPool: (contractId: string, isBackground?: boolean) => Promise<void>
  seedCache: (contractId: string, dbData: Record<string, unknown>) => void
  registerInterest: (contractId: string) => void
  unregisterInterest: (contractId: string) => void
  /** Subscribe to re-renders when cache changes */
  subscribe: (listener: () => void) => () => void
  recordHit: (contractId: string) => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STALE_TIME_MS = 15_000 // 15 seconds

// ── Context ───────────────────────────────────────────────────────────────────

const PoolDataContext = createContext<PoolDataContextType | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function PoolDataProvider({ children }: { children: ReactNode }) {
  const { address } = useStellar()

  // Use refs for the cache/stats data to avoid fetchPool needing them as deps
  const cacheRef = useRef<Record<string, PoolStateCache>>({})
  const statsRef = useRef<Record<string, CacheStats>>({})
  const activeContractsRef = useRef<Set<string>>(new Set())
  const fetchingPromisesRef = useRef<Record<string, Promise<void> | undefined>>({})
  const listenersRef = useRef<Set<() => void>>(new Set())
  const addressRef = useRef<string | null>(null)

  // Keep address ref in sync
  useEffect(() => {
    addressRef.current = address
  }, [address])

  /** Notify all subscribed hooks that cache changed so they can re-render */
  const notifyListeners = useCallback(() => {
    listenersRef.current.forEach((fn) => fn())
  }, [])

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => listenersRef.current.delete(listener)
  }, [])

  const getCache = useCallback((contractId: string) => cacheRef.current[contractId], [])
  const getStats = useCallback((contractId: string) => statsRef.current[contractId], [])

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  // ── Seed Cache from external list fetch ────────────────────────────────────

  const seedCache = useCallback(
    (contractId: string, dbData: Record<string, unknown>) => {
      if (!contractId || !dbData) return
      // Only seed if we have nothing yet — don't overwrite a live fetch
      if (!cacheRef.current[contractId]?.lastFetched) {
        cacheRef.current[contractId] = {
          db: dbData,
          onchain: null,
          isPaused: false,
          poolAdmin: null,
          ttlDays: null,
          lastFetched: 0, // stale intentionally so the hook triggers a background refresh
          isLoading: false,
          isStale: true,
          error: null,
        }
        notifyListeners()
      }
    },
    [notifyListeners]
  )

  // ── Register / Unregister ─────────────────────────────────────────────────

  const registerInterest = useCallback((contractId: string) => {
    if (!contractId) return
    activeContractsRef.current.add(contractId)
  }, [])

  const unregisterInterest = useCallback((contractId: string) => {
    if (!contractId) return
    activeContractsRef.current.delete(contractId)
  }, [])

  // ── Central Fetch ─────────────────────────────────────────────────────────

  const fetchPool = useCallback(
    async (contractId: string, isBackground = false) => {
      if (!contractId || contractId === "pending_deployment") return

      // Deduplication: reuse inflight promise
      if (fetchingPromisesRef.current[contractId]) {
        return fetchingPromisesRef.current[contractId]
      }

      recordMiss(contractId)

      if (!isBackground) {
        setEntry(contractId, { isLoading: true })
      }

      const promise = (async () => {
        try {
          // ── A: Fetch DB record ──────────────────────────────────────────────
          const isStellarContract = /^C[A-Z2-7]{55}$/.test(contractId)
          const url = isStellarContract
            ? `/api/pools?contract=${contractId}`
            : `/api/pools?id=${contractId}`

          const dbRes = await fetch(url)
          if (!dbRes.ok) throw new Error("Failed to load pool from database")
          const dbData = (await dbRes.json()) as { type?: string; contract_address?: string }

          // ── B: Fetch on-chain state ─────────────────────────────────────────
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
            isPaused = pausedVal
            poolAdmin = adminVal
            ttlDays = ttlVal
          }

          const fetchTime = Date.now()
          cacheRef.current[contractId] = {
            db: dbData,
            onchain: onchainState,
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
          console.error(`[PoolDataProvider] fetch failed for ${contractId}:`, err)
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
  ) // notifyListeners is stable — no cache dep, no loop

  // ── Centralised Polling ───────────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const activeIds = Array.from(activeContractsRef.current)
      if (activeIds.length === 0) return
      if (
        process.env.NEXT_PUBLIC_DEBUG_DATA_LAYER === "true" ||
        (typeof localStorage !== "undefined" && localStorage.getItem("DEBUG_DATA_LAYER") === "true")
      ) {
        console.log(`[PoolDataProvider] Polling ${activeIds.length} active pool(s)…`)
      }
      activeIds.forEach((id) => fetchPool(id, true))
    }, STALE_TIME_MS)

    return () => clearInterval(interval)
  }, [fetchPool])

  // ── Dev Debug Panel ───────────────────────────────────────────────────────

  const [showDebug, setShowDebug] = useState(false)
  const [debugTick, setDebugTick] = useState(0)
  const [isClient, setIsClient] = useState(false)
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Refresh debug panel every 2s when open
  useEffect(() => {
    if (!showDebug) return
    const t = setInterval(() => setDebugTick((n) => n + 1), 2000)
    return () => clearInterval(t)
  }, [showDebug])

  const isDebugEnabled =
    isClient &&
    (process.env.NEXT_PUBLIC_DEBUG_DATA_LAYER === "true" ||
      (typeof localStorage !== "undefined" && localStorage.getItem("DEBUG_DATA_LAYER") === "true"))

  const cacheSnapshot = cacheRef.current
  const statsSnapshot = statsRef.current

  return (
    <PoolDataContext.Provider
      value={{
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

      {/* ── In-app Developer Debug Panel ─────────────────────────────────── */}
      {isDebugEnabled && (
        <div className="fixed bottom-4 right-4 z-50 font-sans" data-testid="debug-panel">
          {showDebug ? (
            <div
              style={{ width: 480, maxHeight: 380 }}
              className="overflow-y-auto bg-slate-900/92 text-slate-100 border border-slate-700/60 rounded-2xl shadow-2xl backdrop-blur-md p-4 flex flex-col gap-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                <span className="text-sm font-semibold tracking-wide flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  Pool Data Layer · Debug Panel
                </span>
                <button
                  onClick={() => setShowDebug(false)}
                  className="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded-md transition"
                >
                  Collapse
                </button>
              </div>

              {/* Summary row */}
              <div className="flex gap-4 text-xs">
                <div className="bg-slate-800/60 rounded-lg px-3 py-1.5 flex flex-col items-center">
                  <span className="text-slate-400">Cached Pools</span>
                  <span className="font-bold text-white">{Object.keys(cacheSnapshot).length}</span>
                </div>
                <div className="bg-slate-800/60 rounded-lg px-3 py-1.5 flex flex-col items-center">
                  <span className="text-slate-400">Active Observers</span>
                  <span className="font-bold text-emerald-400">
                    {activeContractsRef.current.size}
                  </span>
                </div>
                <div className="bg-slate-800/60 rounded-lg px-3 py-1.5 flex flex-col items-center">
                  <span className="text-slate-400">Inflight</span>
                  <span className="font-bold text-amber-400">
                    {Object.keys(fetchingPromisesRef.current).length}
                  </span>
                </div>
                <div className="bg-slate-800/60 rounded-lg px-3 py-1.5 flex flex-col items-center">
                  <span className="text-slate-400">Stale TTL</span>
                  <span className="font-bold text-slate-300">{STALE_TIME_MS / 1000}s</span>
                </div>
              </div>

              {/* Per-pool table */}
              {Object.keys(statsSnapshot).length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">
                  No pool requests recorded yet.
                </p>
              ) : (
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="pb-1.5 font-medium">Pool / Contract Key</th>
                      <th className="pb-1.5 text-center font-medium">Hits</th>
                      <th className="pb-1.5 text-center font-medium">Misses</th>
                      <th className="pb-1.5 text-center font-medium">State</th>
                      <th className="pb-1.5 text-right font-medium">Last Fetch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(statsSnapshot).map(([id, s]) => {
                      const entry = cacheSnapshot[id]
                      const isLoading = entry?.isLoading
                      const isStale =
                        !entry?.lastFetched || Date.now() - entry.lastFetched > STALE_TIME_MS
                      const stateBadge = isLoading
                        ? { label: "Loading", cls: "text-amber-400" }
                        : isStale
                          ? { label: "Stale", cls: "text-rose-400" }
                          : { label: "Fresh", cls: "text-emerald-400" }

                      return (
                        <tr key={id} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                          <td
                            className="py-1.5 font-mono max-w-[160px] truncate text-slate-300"
                            title={id}
                          >
                            {id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id}
                          </td>
                          <td className="py-1.5 text-center text-emerald-400 font-semibold">
                            {s.hits}
                          </td>
                          <td className="py-1.5 text-center text-rose-400 font-semibold">
                            {s.misses}
                          </td>
                          <td className={`py-1.5 text-center font-semibold ${stateBadge.cls}`}>
                            {stateBadge.label}
                          </td>
                          <td className="py-1.5 text-right text-slate-400 font-mono">
                            {s.lastFetch ? new Date(s.lastFetch).toLocaleTimeString() : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* Footer actions */}
              <div className="flex items-center justify-between border-t border-slate-800/50 pt-2 text-[10px] text-slate-500">
                <span>Auto-refreshes every 2s while open · debugTick={debugTick}</span>
                <button
                  onClick={() => {
                    cacheRef.current = {}
                    statsRef.current = {}
                    notifyListeners()
                  }}
                  className="text-rose-400 hover:text-rose-300 hover:underline"
                >
                  Clear Cache
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowDebug(true)}
              className="group bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 text-white text-xs px-3.5 py-2 rounded-full shadow-xl backdrop-blur-md flex items-center gap-2 transition hover:scale-105"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Data Layer
            </button>
          )}
        </div>
      )}
    </PoolDataContext.Provider>
  )
}

// ── usePoolData Hook ──────────────────────────────────────────────────────────

export function usePoolData(contractId: string) {
  const context = useContext(PoolDataContext)
  if (!context) {
    throw new Error("usePoolData must be used within a PoolDataProvider")
  }

  const { getCache, fetchPool, registerInterest, unregisterInterest, subscribe, recordHit } =
    context

  // Force re-render when provider notifies (cache updated)
  const [, forceRender] = useState(0)
  useEffect(() => {
    return subscribe(() => forceRender((n) => n + 1))
  }, [subscribe])

  // Register interest for centralised polling
  useEffect(() => {
    if (!contractId || contractId === "pending_deployment") return
    registerInterest(contractId)
    return () => unregisterInterest(contractId)
  }, [contractId, registerInterest, unregisterInterest])

  // Fetch / stale-while-revalidate on mount or contractId change
  useEffect(() => {
    if (!contractId || contractId === "pending_deployment") return
    const entry = getCache(contractId)

    if (!entry || !entry.lastFetched) {
      // First request — foreground fetch
      fetchPool(contractId, false)
    } else {
      // Already cached: serve immediately, revalidate in background if stale
      recordHit(contractId)
      const isStale = Date.now() - entry.lastFetched > STALE_TIME_MS
      if (isStale) {
        fetchPool(contractId, true) // background — no loading flash
      }
    }
  }, [contractId, fetchPool, getCache, recordHit])

  const refetch = useCallback(async () => {
    if (!contractId || contractId === "pending_deployment") return
    await fetchPool(contractId, false)
  }, [contractId, fetchPool])

  // Handle missing / pending pools gracefully
  if (!contractId || contractId === "pending_deployment") {
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
    /** Unified data bag: { db: SupabaseRow, onchain: PoolState | null } */
    data: entry ? { db: entry.db, onchain: entry.onchain } : null,
    isLoading: entry ? entry.isLoading : true,
    isStale: entry ? entry.isStale || isStale : false,
    isPaused: entry ? entry.isPaused : false,
    poolAdmin: entry ? entry.poolAdmin : null,
    ttlDays: entry ? entry.ttlDays : null,
    error: entry ? entry.error : null,
    refetch,
  }
}
