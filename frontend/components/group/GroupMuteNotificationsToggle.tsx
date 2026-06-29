"use client"

import { useEffect, useMemo, useState } from "react"
import { useStellar } from "@/components/web3-provider"
import { useUserProfile } from "@/hooks/useUserProfile"
import { Button } from "@/components/ui/button"

export function GroupMuteNotificationsToggle({ poolId }: { poolId: string }) {
  const { address } = useStellar()
  const { profile, loading, saving, saveProfile } = useUserProfile(address || null)
  const [localMuted, setLocalMuted] = useState(false)

  useEffect(() => {
    const muted = !!profile?.muted_pools?.includes(poolId)
    setLocalMuted(muted)
  }, [profile?.muted_pools, poolId])

  const isMuted = useMemo(() => localMuted, [localMuted])

  const toggle = async () => {
    if (!address || !poolId) return
    const current = profile?.muted_pools ?? []
    const next = isMuted
      ? current.filter((id) => id !== poolId)
      : Array.from(new Set([...current, poolId]))

    setLocalMuted(!isMuted)
    await saveProfile({ muted_pools: next })
  }

  return (
    <div className="mb-4 p-3 rounded-lg bg-muted/30 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Mute notifications for this pool</p>
        <p className="text-xs text-muted-foreground">
          Stops email notifications for this pool only.
        </p>
      </div>
      <Button
        type="button"
        variant={isMuted ? "destructive" : "outline"}
        onClick={toggle}
        disabled={loading || saving || !profile}
        className="shrink-0"
      >
        {isMuted ? "Muted" : "On"}
      </Button>
    </div>
  )
}
