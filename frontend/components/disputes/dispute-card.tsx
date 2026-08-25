"use client"

/**
 * DisputeCard — single dispute row for the pool disputes panel (issue #208)
 * Shows status badge, counts, description, evidence links, and vote buttons
 * for eligible voters. Resolution notes appear once resolved.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, ExternalLink, Gavel, Scale } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { DisputeRecord } from "@/lib/disputes"

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  voting: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  resolved_upheld: "bg-green-500/15 text-green-600 dark:text-green-400",
  resolved_dismissed: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
  expired: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
}

interface DisputeCardProps {
  dispute: DisputeRecord
  viewerAddress: string | null
  isAdmin: boolean
  totalMembers: number
  onVote: (disputeId: string, inFavor: boolean) => void
  onResolve: (disputeId: string, outcome: "upheld" | "dismissed", resolution: string) => void
}

export function DisputeCard({
  dispute,
  viewerAddress,
  isAdmin,
  totalMembers,
  onVote,
  onResolve,
}: DisputeCardProps) {
  const t = useTranslations("group.disputes")
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolutionDraft, setResolutionDraft] = useState("")

  const viewer = viewerAddress?.toLowerCase() ?? null
  const isActive = dispute.status === "open" || dispute.status === "voting"
  const isExpired = new Date(dispute.expires_at).getTime() <= Date.now()

  const isFiler = viewer === dispute.filer_address.toLowerCase()
  const isTarget = !!dispute.target_address && viewer === dispute.target_address.toLowerCase()
  const canVote = isActive && !isExpired && !!viewer && !isFiler && !isTarget

  const needed = Math.ceil(totalMembers / 2)
  const totalVotes = dispute.votes_for + dispute.votes_against

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={STATUS_STYLES[dispute.status] ?? ""}>
          {t(`status.${dispute.status}`)}
        </Badge>
        <Badge variant="outline">{t(`types.${dispute.dispute_type}`)}</Badge>
        {isActive && !isExpired && (
          <span className="text-xs text-muted-foreground">
            {t("expiresIn", { time: formatRemaining(dispute.expires_at) })}
          </span>
        )}
      </div>

      <p className="text-sm whitespace-pre-wrap break-words">{dispute.description}</p>

      {(dispute.target_address || dispute.evidence_urls.length > 0) && (
        <div className="text-xs text-muted-foreground space-y-1">
          {dispute.target_address && (
            <p>
              <span className="font-medium">{t("against")}:</span>{" "}
              <span className="font-mono">{shorten(dispute.target_address)}</span>
            </p>
          )}
          {dispute.evidence_urls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline break-all"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              {url}
            </a>
          ))}
        </div>
      )}

      {(dispute.status === "resolved_upheld" || dispute.status === "resolved_dismissed") &&
        dispute.resolution && (
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <p className="font-medium mb-1">{t("resolutionNote")}</p>
            <p className="whitespace-pre-wrap break-words">{dispute.resolution}</p>
          </div>
        )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Scale className="h-3.5 w-3.5" />
          {t("voteCounts", { for: dispute.votes_for, against: dispute.votes_against, needed })}
          {isActive && !isExpired && (
            <span className="opacity-70">({t("votesCast", { count: totalVotes })})</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canVote && (
            <>
              <Button size="sm" variant="outline" onClick={() => onVote(dispute.id, false)}>
                {t("voteDismiss")}
              </Button>
              <Button size="sm" onClick={() => onVote(dispute.id, true)}>
                {t("voteUphold")}
              </Button>
            </>
          )}
          {isAdmin && isActive && (
            <Button size="sm" variant="secondary" onClick={() => setResolveOpen(true)}>
              <Gavel className="mr-1 h-3.5 w-3.5" />
              {t("resolve")}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              {t("resolveTitle")}
            </DialogTitle>
            <DialogDescription>{t("resolveDescription")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={resolutionDraft}
            onChange={(e) => setResolutionDraft(e.target.value)}
            placeholder={t("resolvePlaceholder")}
            rows={3}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              disabled={!resolutionDraft.trim()}
              onClick={() => {
                onResolve(dispute.id, "dismissed", resolutionDraft.trim())
                setResolutionDraft("")
                setResolveOpen(false)
              }}
            >
              {t("dismissDispute")}
            </Button>
            <Button
              disabled={!resolutionDraft.trim()}
              onClick={() => {
                onResolve(dispute.id, "upheld", resolutionDraft.trim())
                setResolutionDraft("")
                setResolveOpen(false)
              }}
            >
              {t("upholdDispute")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatRemaining(expiresAtIso: string): string {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now()
  if (diffMs <= 0) return "0m"
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`
}

function shorten(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}
