"use client"

import { usePoolData } from "@/lib/data-layer/PoolDataProvider"
import { RotationalTimeline } from "@/components/group/rotational-timeline"
import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"
import type { RotationalPoolState } from "@/hooks/useJointSaveContracts"

interface RotationalTimelineContainerProps {
  groupId: string
  contractAddress?: string
}

export function RotationalTimelineContainer({
  groupId,
  contractAddress,
}: RotationalTimelineContainerProps) {
  const cacheKey =
    contractAddress && contractAddress !== "pending_deployment" ? contractAddress : groupId

  const { data, isLoading } = usePoolData(cacheKey)

  if (isLoading) {
    return (
      <Card className="p-6" aria-label="Loading round timeline">
        <Skeleton className="h-5 w-40 mb-4" />
        <div className="flex items-center justify-between">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </Card>
    )
  }

  const onchainState = data?.onchain as RotationalPoolState | null
  if (!onchainState || !("currentRound" in onchainState)) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (data?.db?.pool_members as any[]) ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activities = (data?.db?.pool_activity as any[]) ?? []

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Round Timeline</h3>
      <RotationalTimeline onchainState={onchainState} members={members} activities={activities} />
    </Card>
  )
}
