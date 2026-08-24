"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Landmark, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { toastManager } from "@/lib/toast"
import { useGovernance } from "@/hooks/useGovernance"
import { CreateProposalDialog } from "./create-proposal-dialog"
import { ProposalList } from "./proposal-list"
import type { GovernanceProposalType } from "@/lib/governance"

interface GovernancePanelProps {
  poolId: string
  governanceContractId: string
  poolContractAddress: string
  poolType: string
  isAdmin: boolean
  isMember: boolean
}

function useNowSeconds() {
  const [nowSecs, setNowSecs] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(timer)
  }, [])
  return nowSecs
}

export function GovernancePanel({
  poolId,
  governanceContractId,
  poolContractAddress,
  poolType,
  isAdmin,
  isMember,
}: GovernancePanelProps) {
  const t = useTranslations("governance")
  const nowSecs = useNowSeconds()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [votingId, setVotingId] = useState<string | null>(null)
  const [executingId, setExecutingId] = useState<string | null>(null)

  const {
    proposals,
    quorum,
    totalMembers,
    votesNeeded,
    loading,
    address,
    createProposal,
    vote,
    executeProposal,
  } = useGovernance(poolId, governanceContractId, poolContractAddress)

  const handleVote = useCallback(
    async (proposalId: string, inFavor: boolean) => {
      setVotingId(proposalId)
      try {
        const ok = await vote(proposalId, inFavor)
        if (ok) {
          toastManager.success(t("toastVoteRecorded"))
        } else {
          toastManager.error(t("toastError"))
        }
      } finally {
        setVotingId(null)
      }
    },
    [vote, t]
  )

  const handleExecute = useCallback(
    async (proposalId: string) => {
      setExecutingId(proposalId)
      try {
        const ok = await executeProposal(proposalId)
        if (ok) {
          toastManager.success(t("toastExecuted"))
        } else {
          toastManager.error(t("toastError"))
        }
      } finally {
        setExecutingId(null)
      }
    },
    [executeProposal, t]
  )

  const handleSubmitProposal = useCallback(
    async (
      proposalType: GovernanceProposalType,
      description: string,
      paramsHex: Record<string, string>
    ) => createProposal(proposalType, description, paramsHex),
    [createProposal]
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Landmark className="h-5 w-5" />
            {t("title")}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("quorumInfo", { needed: votesNeeded, total: totalMembers || "–", quorum })}
          </p>
        </div>
        {isMember && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("createProposal")}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading && proposals.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <ProposalList
            proposals={proposals}
            votesNeeded={votesNeeded}
            nowSecs={nowSecs}
            currentAddress={address}
            isAdmin={isAdmin}
            isMember={isMember}
            votingId={votingId}
            executingId={executingId}
            onVote={handleVote}
            onExecute={handleExecute}
          />
        )}
      </CardContent>

      <CreateProposalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        poolType={poolType}
        onSubmit={handleSubmitProposal}
      />
    </Card>
  )
}
