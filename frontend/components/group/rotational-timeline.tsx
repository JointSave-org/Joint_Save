"use client"

import { useMemo } from "react"
import { Check, Circle, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { RotationalPoolState } from "@/hooks/useJointSaveContracts"

interface PoolMember {
  id: string
  member_address: string
  status: "pending" | "paid" | "late"
  joined_at: string
  contribution_amount: number
}

interface ActivityEvent {
  id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  created_at: string
  tx_hash: string | null
}

interface RotationalTimelineProps {
  onchainState: RotationalPoolState
  members?: PoolMember[]
  activities?: ActivityEvent[]
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function RotationalTimeline({
  onchainState,
  members = [],
  activities = [],
}: RotationalTimelineProps) {
  const { currentRound, members: chainMembers } = onchainState
  const totalRounds = chainMembers.length

  const timelineNodes = useMemo(() => {
    if (totalRounds === 0) return []

    // Build a lookup of DB member data by normalized address
    const dbMemberByAddr = new Map<string, PoolMember>()
    for (const m of members) {
      dbMemberByAddr.set(m.member_address.toUpperCase(), m)
    }

    // Build a lookup of payout activities by member address
    const payoutByAddr = new Map<string, ActivityEvent>()
    for (const a of activities) {
      if (a.activity_type === "payout" && a.user_address) {
        payoutByAddr.set(a.user_address.toUpperCase(), a)
      }
    }

    return chainMembers.map((addr, index) => {
      const normalizedAddr = addr.toUpperCase()
      const dbMember = dbMemberByAddr.get(normalizedAddr)
      const payoutActivity = payoutByAddr.get(normalizedAddr)

      let status: "paid" | "current" | "upcoming"
      let paidRound: number | null = null
      let payoutDate: string | null = null
      let payoutAmount: number | null = null

      if (index < currentRound) {
        status = "paid"
        paidRound = index
        if (payoutActivity) {
          payoutDate = payoutActivity.created_at
          payoutAmount = payoutActivity.amount
        }
      } else if (index === currentRound) {
        status = "current"
      } else {
        status = "upcoming"
      }

      return {
        address: addr,
        shortAddress: formatAddress(addr),
        index,
        status,
        paidRound,
        payoutDate,
        payoutAmount,
        dbStatus: dbMember?.status,
      }
    })
  }, [chainMembers, currentRound, members, activities])

  if (totalRounds === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <div className="w-full">
        {/* Desktop: horizontal timeline */}
        <div className="hidden sm:block">
          <div className="relative flex items-center justify-between">
            {/* Connector line */}
            <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-border" />

            {timelineNodes.map((node) => (
              <TimelineNode key={node.address} node={node} />
            ))}
          </div>
        </div>

        {/* Mobile: vertical timeline */}
        <div className="sm:hidden">
          <div className="relative flex flex-col gap-0">
            {timelineNodes.map((node, i) => (
              <TimelineNodeVertical
                key={node.address}
                node={node}
                isLast={i === timelineNodes.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

interface TimelineNodeProps {
  node: {
    address: string
    shortAddress: string
    index: number
    status: "paid" | "current" | "upcoming"
    paidRound: number | null
    payoutDate: string | null
    payoutAmount: number | null
    dbStatus?: string
  }
}

function TimelineNode({ node }: TimelineNodeProps) {
  const { status, shortAddress, index, paidRound, payoutDate, payoutAmount } = node

  const nodeContent = (
    <div className="relative z-10 flex flex-col items-center gap-1.5">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
          status === "paid"
            ? "border-primary bg-primary text-primary-foreground"
            : status === "current"
              ? "border-yellow-500 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 ring-2 ring-yellow-500/30"
              : "border-border bg-muted text-muted-foreground"
        }`}
      >
        {status === "paid" ? (
          <Check className="h-4 w-4" />
        ) : status === "current" ? (
          <User className="h-4 w-4" />
        ) : (
          <Circle className="h-3 w-3" />
        )}
      </div>

      <span className="text-[11px] font-mono text-muted-foreground">{shortAddress}</span>

      <span
        className={`text-[10px] font-medium ${
          status === "paid"
            ? "text-primary"
            : status === "current"
              ? "text-yellow-700 dark:text-yellow-400"
              : "text-muted-foreground"
        }`}
      >
        {status === "paid" && `R${(paidRound ?? index) + 1}`}
        {status === "current" && "Current"}
        {status === "upcoming" && `R${index + 1}`}
      </span>
    </div>
  )

  if (status === "paid" && (payoutDate || payoutAmount != null)) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex-1 flex justify-center cursor-default">{nodeContent}</div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            <p className="font-medium">Round {(paidRound ?? index) + 1}</p>
            {payoutDate && (
              <p className="text-muted-foreground">
                Paid: {new Date(payoutDate).toLocaleDateString()}
              </p>
            )}
            {payoutAmount != null && (
              <p className="text-muted-foreground">{payoutAmount.toFixed(2)} XLM</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  return <div className="flex-1 flex justify-center">{nodeContent}</div>
}

interface TimelineNodeVerticalProps extends TimelineNodeProps {
  isLast: boolean
}

function TimelineNodeVertical({ node, isLast }: TimelineNodeVerticalProps) {
  const { status, shortAddress, index, paidRound, payoutDate, payoutAmount } = node

  const nodeContent = (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
            status === "paid"
              ? "border-primary bg-primary text-primary-foreground"
              : status === "current"
                ? "border-yellow-500 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 ring-2 ring-yellow-500/30"
                : "border-border bg-muted text-muted-foreground"
          }`}
        >
          {status === "paid" ? (
            <Check className="h-3.5 w-3.5" />
          ) : status === "current" ? (
            <User className="h-3.5 w-3.5" />
          ) : (
            <Circle className="h-2.5 w-2.5" />
          )}
        </div>
        {!isLast && (
          <div className={`w-0.5 h-6 ${status === "paid" ? "bg-primary" : "bg-border"}`} />
        )}
      </div>

      <div className="pt-1 pb-4">
        <span className="text-xs font-mono text-muted-foreground">{shortAddress}</span>
        <div>
          <Badge
            variant={status === "current" ? "default" : "secondary"}
            className={`text-[10px] mt-0.5 ${
              status === "paid"
                ? "bg-primary/10 text-primary"
                : status === "current"
                  ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                  : ""
            }`}
          >
            {status === "paid" && `Paid R${(paidRound ?? index) + 1}`}
            {status === "current" && "Current"}
            {status === "upcoming" && `Round ${index + 1}`}
          </Badge>
        </div>
        {status === "paid" && payoutDate && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(payoutDate).toLocaleDateString()}
            {payoutAmount != null && ` - ${payoutAmount.toFixed(2)} XLM`}
          </p>
        )}
      </div>
    </div>
  )

  if (status === "paid" && (payoutDate || payoutAmount != null)) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{nodeContent}</div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs space-y-1">
            <p className="font-medium">Round {(paidRound ?? index) + 1}</p>
            {payoutDate && (
              <p className="text-muted-foreground">
                Paid: {new Date(payoutDate).toLocaleDateString()}
              </p>
            )}
            {payoutAmount != null && (
              <p className="text-muted-foreground">{payoutAmount.toFixed(2)} XLM</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  return nodeContent
}
