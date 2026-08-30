"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2, ThumbsDown, ThumbsUp, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import {
  formatTimeRemaining,
  type GovernanceProposal,
  type GovernanceProposalStatus,
} from "@/lib/governance"
import { PROPOSAL_TYPES } from "@/lib/governance"

const STATUS_BADGE: Record<GovernanceProposalStatus, string> = {
  Active: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  Passed: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  Executed: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30",
  Expired: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  Rejected: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
}

export function proposalTypeLabel(type: string): string {
  return PROPOSAL_TYPES.find((t) => t.value === type)?.label ?? type
}

function shortenAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

interface VoteCardProps {
  proposal: GovernanceProposal
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

export function VoteCard({
  proposal,
  votesNeeded,
  nowSecs,
  currentAddress,
  isAdmin,
  isMember,
  votingId,
  executingId,
  onVote,
  onExecute,
}: VoteCardProps) {
  const t = useTranslations("governance")

  const forCount = proposal.votesFor.length
  const againstCount = proposal.votesAgainst.length
  const progressTarget = Math.max(votesNeeded, 1)
  const isProposer =
    !!currentAddress && proposal.proposer.toLowerCase() === currentAddress.toLowerCase()
  const alreadyVoted =
    !!currentAddress &&
    (proposal.votesFor.some((v) => v.toLowerCase() === currentAddress.toLowerCase()) ||
      proposal.votesAgainst.some((v) => v.toLowerCase() === currentAddress.toLowerCase()))
  const open = proposal.status === "Active" || proposal.status === "Passed"
  const canVote = open && isMember && !isProposer && !alreadyVoted && votingId !== proposal.id

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t(`types.${proposal.proposalType}`)}</Badge>
          <Badge variant="outline" className={STATUS_BADGE[proposal.status]}>
            {t(`statuses.${proposal.status}`)}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {open ? t("timeLeft", { time: formatTimeRemaining(proposal.expiresAt, nowSecs) }) : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm whitespace-pre-wrap">{proposal.description}</p>
        <p className="text-xs text-muted-foreground">
          by <span className="font-mono">{shortenAddress(proposal.proposer)}</span>
          {isProposer ? " (you)" : ""}
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <ThumbsUp className="h-3.5 w-3.5" /> {forCount}
            </span>
            <span className="text-xs text-muted-foreground">
              {votesNeeded} needed · {againstCount} against
            </span>
          </div>
          <Progress value={Math.min((forCount / progressTarget) * 100, 100)} />
        </div>

        {open && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canVote || votingId !== null}
              onClick={() => onVote(proposal.id, true)}
              className="flex-1 min-w-28 touch-manipulation"
            >
              <ThumbsUp className="mr-1 h-4 w-4" />
              {votingId === proposal.id ? t("voting") : t("voteFor")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canVote || votingId !== null}
              onClick={() => onVote(proposal.id, false)}
              className="flex-1 min-w-28 touch-manipulation"
            >
              <ThumbsDown className="mr-1 h-4 w-4" />
              {t("voteAgainst")}
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                disabled={
                  proposal.status !== "Passed" ||
                  nowSecs >= proposal.expiresAt ||
                  executingId !== null
                }
                onClick={() => onExecute(proposal.id)}
                className={cn("min-w-28", proposal.status === "Passed" && "border-green-500/40")}
                variant="default"
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                {executingId === proposal.id ? t("executing") : t("execute")}
              </Button>
            )}
          </div>
        )}

        {!open && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <XCircle className="h-3.5 w-3.5" /> {t("closed")}
          </p>
        )}

        {open && !alreadyVoted && isProposer && (
          <p className="text-xs text-muted-foreground">{t("ownProposal")}</p>
        )}
        {open && alreadyVoted && (
          <p className="text-xs text-muted-foreground">{t("alreadyVoted")}</p>
        )}
      </CardContent>
    </Card>
  )
}
