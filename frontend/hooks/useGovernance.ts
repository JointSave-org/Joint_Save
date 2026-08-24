"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useStellar } from "@/components/web3-provider"
import {
  fetchActiveProposals,
  fetchGovernanceQuorum,
  fetchPoolMembers,
  fetchRecentProposals,
  useCreateProposal as useChainCreateProposal,
  useExecuteProposal as useChainExecuteProposal,
  useGovernanceVote as useChainVote,
  type GovernanceProposal,
} from "@/hooks/useJointSaveContracts"
import { mergeProposals, votesNeededForQuorum } from "@/lib/governance"

const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"

interface GovernanceVoteRow {
  proposal_id: string
  voter_address: string
  vote: boolean
}

/**
 * Loads on-chain proposals for a pool's governance contract and keeps the UI
 * fresh: Soroban RPC provides the source of truth while a Supabase Realtime
 * subscription on the `governance_votes` mirror triggers refetches so vote
 * counts update without a page refresh.
 */
export function useGovernance(
  poolId: string | null,
  govContractId: string | null,
  poolContractId: string | null
) {
  const { address } = useStellar()
  const [proposals, setProposals] = useState<GovernanceProposal[]>([])
  const [quorum, setQuorum] = useState<number>(51)
  const [totalMembers, setTotalMembers] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chainCreateProposal = useChainCreateProposal(govContractId ?? "")
  const chainVote = useChainVote(govContractId ?? "")
  const chainExecuteProposal = useChainExecuteProposal(govContractId ?? "")

  const refresh = useCallback(async () => {
    if (!govContractId || IS_E2E) {
      setProposals([])
      return
    }
    setLoading(true)
    try {
      const [active, recent, quorumVal] = await Promise.all([
        poolContractId
          ? fetchActiveProposals(govContractId, poolContractId)
          : Promise.resolve([] as GovernanceProposal[]),
        fetchRecentProposals(govContractId),
        fetchGovernanceQuorum(govContractId),
      ])
      setProposals(mergeProposals(active, recent))
      if (quorumVal !== null) setQuorum(quorumVal)
      if (poolContractId) {
        const members = await fetchPoolMembers(poolContractId)
        setTotalMembers(members.length)
      }
    } catch {
      setProposals([])
    } finally {
      setLoading(false)
    }
  }, [govContractId, poolContractId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!poolId || IS_E2E || !supabase) return

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        refresh()
      }, 1500)
    }

    const channel = supabase
      .channel(`governance_votes:${poolId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "governance_votes",
          filter: `pool_id=eq.${poolId}`,
        },
        scheduleRefresh
      )
      .subscribe()

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      supabase.removeChannel(channel)
    }
  }, [poolId, refresh])

  /** Mirror an on-chain vote into Supabase for realtime fan-out. Best-effort. */
  const mirrorVote = useCallback(
    async (proposalIdHex: string, inFavor: boolean) => {
      if (!poolId || !address || IS_E2E || !supabase) return
      try {
        await window.fetch("/api/governance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pool_id: poolId,
            proposal_id: proposalIdHex,
            voter_address: address.toLowerCase(),
            vote: inFavor,
          }),
        })
      } catch {}
    },
    [poolId, address]
  )

  const createProposal = useCallback(
    async (
      proposalType: string,
      description: string,
      paramsHex: Record<string, string>
    ): Promise<boolean> => {
      const hash = await chainCreateProposal.createProposal(proposalType, description, paramsHex)
      if (!hash) return false
      await refresh()
      return true
    },
    [chainCreateProposal, refresh]
  )

  const vote = useCallback(
    async (proposalIdHex: string, inFavor: boolean): Promise<boolean> => {
      const hash = await chainVote.vote(proposalIdHex, inFavor)
      if (!hash) return false
      await mirrorVote(proposalIdHex, inFavor)
      await refresh()
      return true
    },
    [chainVote, mirrorVote, refresh]
  )

  const executeProposal = useCallback(
    async (proposalIdHex: string): Promise<boolean> => {
      const hash = await chainExecuteProposal.executeProposal(proposalIdHex)
      if (!hash) return false
      await refresh()
      return true
    },
    [chainExecuteProposal, refresh]
  )

  return {
    proposals,
    quorum,
    totalMembers,
    votesNeeded: votesNeededForQuorum(quorum, totalMembers),
    loading,
    address,
    refresh,
    createProposal,
    vote,
    executeProposal,
  }
}

export type { GovernanceVoteRow }
