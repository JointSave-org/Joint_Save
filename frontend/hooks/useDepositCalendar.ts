"use client"

import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useStellar } from "@/components/web3-provider"
import { PoolDataContext } from "@/lib/data-layer/PoolDataProvider"
import { STALE_TIME_MS } from "@/lib/constants"
import type { RotationalPoolState } from "@/hooks/useJointSaveContracts"
import type { DepositCalendarEvent } from "@/lib/deposit-calendar"

/**
 * Every rotational pool the connected wallet belongs to, with its next
 * deposit deadline — for the dashboard's deposit calendar.
 *
 * Unlike `useBatchDeposit` (which reads on-chain state directly and only
 * keeps pools still owed a deposit), this hook goes through the shared
 * `PoolDataProvider` cache so a pool already open elsewhere on the page
 * (e.g. its `PoolCard`) is not fetched twice, and includes pools the wallet
 * has already deposited to this round (surfaced with a checkmark).
 */

/** The subset of the `/api/pools?member=` row this feature reads. */
interface MemberPoolRecord {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: string
  contract_address: string | null
  contribution_amount: number | null
  token_symbol: string | null
}

/** Stellar contract ids are `C` followed by 55 base32 characters. */
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/

function isDeployed(address: string | null | undefined): address is string {
  return !!address && CONTRACT_ADDRESS_RE.test(address.toUpperCase())
}

export function useDepositCalendar() {
  const { address } = useStellar()
  const context = useContext(PoolDataContext)
  if (!context) {
    throw new Error("useDepositCalendar must be used within a PoolDataProvider")
  }
  const { fetchPool, getCache, registerInterest, unregisterInterest, subscribe } = context

  const [records, setRecords] = useState<MemberPoolRecord[]>([])
  const [isLoadingRecords, setIsLoadingRecords] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRecords = useCallback(async () => {
    if (!address) {
      setRecords([])
      setIsLoadingRecords(false)
      return
    }
    setIsLoadingRecords(true)
    setError(null)
    try {
      const res = await fetch(`/api/pools?member=${encodeURIComponent(address.toLowerCase())}`)
      if (!res.ok) throw new Error("Failed to load your pools")
      const json = await res.json()
      const all: MemberPoolRecord[] = Array.isArray(json) ? json : (json.data ?? [])
      setRecords(
        all.filter(
          (p) =>
            p.type === "rotational" && p.status !== "completed" && isDeployed(p.contract_address)
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your pools")
      setRecords([])
    } finally {
      setIsLoadingRecords(false)
    }
  }, [address])

  useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  const contractAddresses = useMemo(
    () => records.map((r) => r.contract_address as string),
    [records]
  )

  // Re-render whenever the shared cache changes (fetch completes, background
  // poll refreshes an entry the calendar also depends on, etc).
  const [, forceRender] = useState(0)
  useEffect(() => subscribe(() => forceRender((n) => n + 1)), [subscribe])

  // Mirrors `usePoolData(contractId)`'s per-contract interest tracking, but
  // for a dynamic list of pools instead of one hook call per pool.
  useEffect(() => {
    contractAddresses.forEach((addr) => registerInterest(addr))
    return () => {
      contractAddresses.forEach((addr) => unregisterInterest(addr))
    }
  }, [contractAddresses, registerInterest, unregisterInterest])

  // Mirrors `usePoolData(contractId)`'s fetch-if-missing-or-stale gate.
  useEffect(() => {
    contractAddresses.forEach((addr) => {
      const entry = getCache(addr)
      if (!entry || !entry.lastFetched) {
        void fetchPool(addr, false)
      } else if (Date.now() - entry.lastFetched > STALE_TIME_MS) {
        void fetchPool(addr, true)
      }
    })
  }, [contractAddresses, fetchPool, getCache])

  const events: DepositCalendarEvent[] = useMemo(() => {
    return records.map((record) => {
      const contractAddress = record.contract_address as string
      const onchain = getCache(contractAddress)?.onchain as RotationalPoolState | null | undefined
      return {
        poolId: record.id,
        poolName: record.name,
        contractAddress,
        amount: record.contribution_amount ?? 0,
        tokenSymbol: record.token_symbol || "XLM",
        round: onchain?.currentRound ?? 0,
        deadlineMs: onchain && onchain.nextPayoutTime > 0 ? onchain.nextPayoutTime * 1000 : null,
        hasDeposited: onchain?.hasDeposited ?? false,
      }
    })
  }, [records, getCache])

  const isLoading =
    isLoadingRecords ||
    records.some((record) => {
      const entry = getCache(record.contract_address as string)
      return !entry || entry.isLoading
    })

  return {
    events,
    isLoading,
    error,
    hasRotationalPools: records.length > 0,
    refresh: loadRecords,
  }
}
