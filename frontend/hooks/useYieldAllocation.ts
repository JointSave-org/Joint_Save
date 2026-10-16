"use client"

import { useCallback, useEffect, useState } from "react"
import {
  fetchYieldAllocationState,
  useApplyYieldAllocation,
  useDeallocateYield,
  useSetYieldBuffer,
  useSetYieldLocked,
  useSyncYield,
} from "@/hooks/useJointSaveContracts"
import { type YieldAllocationState } from "@/lib/yield-allocation"

export interface UseYieldAllocationResult {
  state: YieldAllocationState | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  maxAllocatable: bigint
  applyAllocation: (vaultId: string, amount: bigint) => Promise<boolean>
  deallocate: (amount: bigint) => Promise<boolean>
  sync: () => Promise<boolean>
  setBuffer: (bps: number) => Promise<boolean>
  setLocked: (locked: boolean) => Promise<boolean>
}

/**
 * Loads a flexible pool's on-chain yield position and exposes the actions that
 * mutate it. Every mutation refetches so the UI reflects the new share balance
 * and cost basis without a manual reload.
 */
export function useYieldAllocation(poolContractId: string | null): UseYieldAllocationResult {
  const [state, setState] = useState<YieldAllocationState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { applyAllocation: chainApply } = useApplyYieldAllocation(poolContractId ?? "")
  const { deallocate: chainDeallocate } = useDeallocateYield(poolContractId ?? "")
  const { sync: chainSync } = useSyncYield(poolContractId ?? "")
  const { setBuffer: chainSetBuffer } = useSetYieldBuffer(poolContractId ?? "")
  const { setLocked: chainSetLocked } = useSetYieldLocked(poolContractId ?? "")

  const refresh = useCallback(async () => {
    if (!poolContractId) {
      setState(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await fetchYieldAllocationState(poolContractId)
      setState(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load yield state")
      setState(null)
    } finally {
      setLoading(false)
    }
  }, [poolContractId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const maxAllocatable = state?.maxAllocatable ?? 0n

  const applyAllocation = useCallback(
    async (vaultId: string, amount: bigint): Promise<boolean> => {
      const hash = await chainApply(vaultId, amount)
      if (!hash) return false
      await refresh()
      return true
    },
    [chainApply, refresh]
  )

  const deallocate = useCallback(
    async (amount: bigint): Promise<boolean> => {
      const hash = await chainDeallocate(amount)
      if (!hash) return false
      await refresh()
      return true
    },
    [chainDeallocate, refresh]
  )

  const sync = useCallback(async (): Promise<boolean> => {
    const hash = await chainSync()
    if (!hash) return false
    await refresh()
    return true
  }, [chainSync, refresh])

  const setBuffer = useCallback(
    async (bps: number): Promise<boolean> => {
      const hash = await chainSetBuffer(bps)
      if (!hash) return false
      await refresh()
      return true
    },
    [chainSetBuffer, refresh]
  )

  const setLocked = useCallback(
    async (locked: boolean): Promise<boolean> => {
      const hash = await chainSetLocked(locked)
      if (!hash) return false
      await refresh()
      return true
    },
    [chainSetLocked, refresh]
  )

  return {
    state,
    loading,
    error,
    refresh,
    maxAllocatable,
    applyAllocation,
    deallocate,
    sync,
    setBuffer,
    setLocked,
  }
}
