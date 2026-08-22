"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, Repeat, Loader2, LayoutTemplate } from "lucide-react"
import { toastManager } from "@/lib/toast"
import { formatRelativeTime } from "@/lib/utils"
import type { TemplatePoolType } from "@/lib/templates"

interface TemplateListItem {
  id: string
  name: string
  description: string | null
  pool_type: TemplatePoolType
  config: { amount?: string; targetAmount?: string; minimumDeposit?: string; members?: string[] }
  is_public: boolean
  use_count: number
  created_at: string
}

function poolTypeLabel(type: TemplatePoolType) {
  return type === "rotational" ? "Rotational" : type === "target" ? "Target" : "Flexible"
}

/**
 * "Use Template" dialog (issue #226). Opens from the top of the pool creation
 * form — shows the caller's templates plus community templates for the current
 * pool type, then navigates to the pre-filled creation form.
 */
export function UseTemplateDialog({
  open,
  onOpenChange,
  poolType,
  address,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  poolType: TemplatePoolType
  address: string | null
}) {
  const router = useRouter()
  const [mine, setMine] = useState<TemplateListItem[]>([])
  const [community, setCommunity] = useState<TemplateListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [usingId, setUsingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mineRes, communityRes] = await Promise.all([
        address
          ? fetch(`/api/templates?wallet=${encodeURIComponent(address.toLowerCase())}`)
          : Promise.resolve(null),
        fetch(`/api/templates/community?pool_type=${poolType}&sort=popular&page=0`),
      ])

      let mineData: { data: TemplateListItem[] } = { data: [] }
      if (mineRes) {
        const parsed = await mineRes.json().catch(() => ({ data: [] }))
        mineData = parsed ?? { data: [] }
      }
      const communityParsed = await communityRes.json().catch(() => ({ data: [] }))
      const communityData = communityParsed ?? { data: [] }

      const mineList = (mineData.data || []).filter(
        (t: TemplateListItem) => t.pool_type === poolType
      )
      const mineIds = new Set(mineList.map((t) => t.id))
      const communityList = (communityData.data || []).filter(
        (t: TemplateListItem) => t.pool_type === poolType && !mineIds.has(t.id)
      )

      setMine(mineList)
      setCommunity(communityList)
    } finally {
      setLoading(false)
    }
  }, [address, poolType])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleUse = async (template: TemplateListItem) => {
    if (!address) {
      toastManager.error("Connect your wallet to use a template")
      return
    }
    setUsingId(template.id)
    // Bump the use count (best-effort — never blocks navigation).
    await fetch(`/api/templates/${template.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-wallet-address": address },
      body: JSON.stringify({ incrementUse: true }),
    }).catch(() => {})
    onOpenChange(false)
    router.push(`/dashboard/create/${template.pool_type}?template=${template.id}`)
  }

  const renderCard = (template: TemplateListItem, showUseButton: boolean) => (
    <li
      key={template.id}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border p-4"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate">{template.name}</p>
          <Badge variant="secondary" className="text-[10px] capitalize shrink-0">
            {poolTypeLabel(template.pool_type)}
          </Badge>
          {template.is_public && (
            <Badge variant="outline" className="text-[10px] shrink-0">
              Community
            </Badge>
          )}
        </div>
        {template.description && (
          <p className="text-sm text-muted-foreground truncate mt-0.5">{template.description}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {template.config.members?.length ? template.config.members.length + 1 : "—"} members
          </span>
          <span className="flex items-center gap-1">
            <Repeat className="h-3 w-3" />
            used {template.use_count}×
          </span>
          <span className="hidden sm:inline">
            {formatRelativeTime(new Date(template.created_at))}
          </span>
        </div>
      </div>
      {showUseButton && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={usingId === template.id}
          onClick={() => handleUse(template)}
        >
          {usingId === template.id ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </>
          ) : (
            "Use Template"
          )}
        </Button>
      )}
    </li>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-primary" />
            Use a Template
          </DialogTitle>
          <DialogDescription>
            Pick a saved configuration to pre-fill this form. You can edit any value before creating
            the pool.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto space-y-6 pr-1">
            {mine.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">My Templates</h3>
                <ul className="space-y-2">{mine.map((t) => renderCard(t, true))}</ul>
              </section>
            )}

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                Community Templates
              </h3>
              {community.length > 0 ? (
                <ul className="space-y-2">{community.map((t) => renderCard(t, true))}</ul>
              ) : (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">
                  No public templates for {poolTypeLabel(poolType).toLowerCase()} pools yet — save
                  one from this form and it will appear here.
                </p>
              )}
            </section>

            {mine.length === 0 && community.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No templates available yet. Save this configuration as a template using the link
                below the submit button.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
