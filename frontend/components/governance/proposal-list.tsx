"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { GovernanceProposal, GovernanceProposalStatus } from "@/lib/governance"
import { VoteCard } from "./vote-card"

const STATUS_BADGE: Record<GovernanceProposalStatus, string> = {
  Active: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  Passed: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  Executed: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
  Expired: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  Rejected: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
}

interface ProposalListProps {
  proposals: GovernanceProposal[]
  votesNeeded: number
  nowSecs: number
  currentAddress?: string | null
  isAdmin: boolean
  isMember: boolean
  votingId: string | null
  executingId: string | null
  onVote: (proposalId: string, inFavor: boolean) => void
  onExecute: (proposalId: string) => void
}

export function ProposalList({
  proposals,
  votesNeeded,
  nowSecs,
  currentAddress,
  isAdmin,
  isMember,
  votingId,
  executingId,
  onVote,
  onExecute,
}: ProposalListProps) {
  const t = useTranslations("governance")
  const [showRecent, setShowRecent] = useState(false)

  const openProposals = proposals.filter((p) => p.status === "Active" || p.status === "Passed")
  const recentProposals = proposals.filter((p) => !openProposals.includes(p))

  if (proposals.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-center">
        <FileText className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t("emptyState")}</p>
        <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {openProposals.map((proposal) => (
        <VoteCard
          key={proposal.id}
          proposal={proposal}
          votesNeeded={votesNeeded}
          nowSecs={nowSecs}
          currentAddress={currentAddress}
          isAdmin={isAdmin}
          isMember={isMember}
          votingId={votingId}
          executingId={executingId}
          onVote={onVote}
          onExecute={onExecute}
        />
      ))}

      {recentProposals.length > 0 && (
        <Collapsible open={showRecent} onOpenChange={setShowRecent}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full">
              <ChevronDown
                className={`mr-1 h-4 w-4 transition-transform ${showRecent ? "rotate-180" : ""}`}
              />
              {showRecent ? t("hideRecent") : `${t("recentTitle")} (${recentProposals.length})`}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {recentProposals.map((proposal) => (
              <div
                key={proposal.id}
                className="flex items-start gap-2 rounded-md border p-3 text-sm"
              >
                <Badge variant="outline" className={`shrink-0 ${STATUS_BADGE[proposal.status]}`}>
                  {t(`statuses.${proposal.status}`)}
                </Badge>
                <span className="line-clamp-2 flex-1">{proposal.description}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {proposal.votesFor.length}/{proposal.votesAgainst.length}
                </span>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
