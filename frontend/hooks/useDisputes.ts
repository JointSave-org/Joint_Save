"use client"

/**
 * useDisputes — pool dispute feed + actions (issue #208)
 *
 * Loads disputes for a pool from /api/disputes, keeps them live via a
 * Supabase Realtime subscription (INSERT/UPDATE on `disputes`), and exposes
 * file/vote/resolve mutations that optimistically update the local list.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import type { DisputeRecord } from "@/lib/disputes"

const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"

export interface FileDisputeInput {
  poolId: string
  filerAddress: string
  disputeType: string
  description: string
  targetAddress?: string
  evidenceUrls?: string[]
}

export interface UseDisputesResult {
  disputes: DisputeRecord[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  fileDispute: (input: Omit<FileDisputeInput, "poolId">) => Promise<boolean>
  voteOnDispute: (disputeId: string, voterAddress: string, inFavor: boolean) => Promise<boolean>
  resolveDispute: (
    disputeId: string,
    adminAddress: string,
    outcome: "upheld" | "dismissed",
    resolution: string
  ) => Promise<boolean>
}

function sortDisputes(list: DisputeRecord[]): DisputeRecord[] {
  const statusRank: Record<string, number> = {
    open: 0,
    voting: 1,
    resolved_upheld: 2,
    resolved_dismissed: 3,
    expired: 4,
  }
  return [...list].sort((a, b) => {
    const byStatus = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
    if (byStatus !== 0) return byStatus
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function useDisputes(poolId: string | null): UseDisputesResult {
  const [disputes, setDisputes] = useState<DisputeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const knownIds = useRef<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!poolId || IS_E2E) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/disputes?pool_id=${encodeURIComponent(poolId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: { disputes: DisputeRecord[] } = await res.json()
      const list = data.disputes ?? []
      knownIds.current = new Set(list.map((d) => d.id))
      setDisputes(sortDisputes(list))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load disputes")
    } finally {
      setLoading(false)
    }
  }, [poolId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // ── Realtime: new or updated disputes replace their local copy ────────────

  useEffect(() => {
    if (!poolId || IS_E2E || !supabase) return

    const channel: RealtimeChannel = supabase
      .channel(`disputes:${poolId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "disputes",
          filter: `pool_id=eq.${poolId}`,
        },
        (payload: RealtimePostgresChangesPayload<DisputeRecord>) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as DisputeRecord
            if (knownIds.current.has(row.id)) return
            knownIds.current.add(row.id)
            setDisputes((prev) => sortDisputes([row, ...prev]))
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as DisputeRecord
            setDisputes((prev) => sortDisputes(prev.map((d) => (d.id === row.id ? row : d))))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [poolId])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const fileDispute = useCallback(
    async (input: Omit<FileDisputeInput, "poolId">): Promise<boolean> => {
      if (!poolId || IS_E2E) return false
      try {
        const res = await fetch("/api/disputes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pool_id: poolId,
            filer_address: input.filerAddress.toLowerCase(),
            dispute_type: input.disputeType,
            description: input.description,
            ...(input.targetAddress ? { target_address: input.targetAddress } : {}),
            ...(input.evidenceUrls ? { evidence_urls: input.evidenceUrls } : {}),
          }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Failed to file dispute (HTTP ${res.status})`)
        }
        await refresh()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to file dispute")
        return false
      }
    },
    [poolId, refresh]
  )

  const voteOnDispute = useCallback(
    async (disputeId: string, voterAddress: string, inFavor: boolean): Promise<boolean> => {
      if (IS_E2E) return false
      // Optimistic count bump; the realtime UPDATE will reconcile.
      setDisputes((prev) =>
        prev.map((d) =>
          d.id === disputeId
            ? {
                ...d,
                votes_for: d.votes_for + (inFavor ? 1 : 0),
                votes_against: d.votes_against + (inFavor ? 0 : 1),
                status: d.status === "open" ? "voting" : d.status,
              }
            : d
        )
      )
      try {
        const res = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            voter_address: voterAddress.toLowerCase(),
            vote: inFavor,
          }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Vote failed (HTTP ${res.status})`)
        }
        const data: { dispute: DisputeRecord } = await res.json()
        setDisputes((prev) =>
          sortDisputes(prev.map((d) => (d.id === data.dispute.id ? data.dispute : d)))
        )
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Vote failed")
        void refresh() // roll back the optimistic update with server truth
        return false
      }
    },
    [refresh]
  )

  const resolveDispute = useCallback(
    async (
      disputeId: string,
      adminAddress: string,
      outcome: "upheld" | "dismissed",
      resolution: string
    ): Promise<boolean> => {
      if (IS_E2E) return false
      try {
        const res = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            admin_address: adminAddress.toLowerCase(),
            outcome,
            resolution,
          }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Resolution failed (HTTP ${res.status})`)
        }
        const data: { dispute: DisputeRecord } = await res.json()
        setDisputes((prev) =>
          sortDisputes(prev.map((d) => (d.id === data.dispute.id ? data.dispute : d)))
        )
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : "Resolution failed")
        return false
      }
    },
    []
  )

  return { disputes, loading, error, refresh, fileDispute, voteOnDispute, resolveDispute }
}
