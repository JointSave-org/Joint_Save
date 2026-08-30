"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Archive, ArchiveRestore, Loader2 } from "lucide-react"
import { toastManager } from "@/lib/toast"
import { signArchiveProof, signUnarchiveProof } from "@/lib/archive-proof"
import { STELLAR_NETWORK_PASSPHRASE, useStellar } from "@/components/web3-provider"
import type { ArchiveReason } from "@/lib/archival"

interface ArchivedPoolBannerProps {
  groupId: string
  archivedAt: string
  archiveReason: ArchiveReason | null
  /** Only the pool creator sees the restore control. */
  isAdmin: boolean
  /** Connected wallet — the endpoint authorises against the pool creator. */
  adminAddress: string | null
  onRestored?: () => void
}

/**
 * Banner shown at the top of an archived pool's detail page (issue #212).
 *
 * States plainly that the pool is archived, why, and that nothing was lost —
 * a member arriving from a bookmark should not have to guess why the deposit
 * button is gone. The admin gets the restore control here, which is the
 * escape hatch for a false-positive automated archival.
 */
export function ArchivedPoolBanner({
  groupId,
  archivedAt,
  archiveReason,
  isAdmin,
  adminAddress,
  onRestored,
}: ArchivedPoolBannerProps) {
  const t = useTranslations("group.archived")
  const { kit } = useStellar()
  const [restoring, setRestoring] = useState(false)

  const reason: ArchiveReason = archiveReason ?? "admin_archived"

  const handleRestore = async () => {
    if (!adminAddress || !kit) return toastManager.error(t("unarchiveError"))
    setRestoring(true)
    try {
      // The wallet signs before the request goes out: the endpoint authorises
      // on this signature, not on the address in the body.
      const proof = await signUnarchiveProof({
        kit,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        adminAddress,
        poolId: groupId,
      })
      const res = await fetch(`/api/pools/${groupId}/unarchive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          admin_address: adminAddress,
          signature: proof.signature,
          signed_at: proof.signedAt,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      toastManager.success(t("unarchiveSuccess"))
      onRestored?.()
    } catch {
      toastManager.error(t("unarchiveError"))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Card className="p-4 mb-6 border-muted-foreground/30 bg-muted/40" role="status">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="rounded-full bg-muted p-2 shrink-0 self-start">
          <Archive className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="flex-1 space-y-1">
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t(`reason.${reason}`)}</p>
          <p className="text-sm text-muted-foreground">{t("body")}</p>
          <p className="text-xs text-muted-foreground">
            {t("archivedOn", {
              date: new Date(archivedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              }),
            })}
          </p>
        </div>

        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestore}
            disabled={restoring}
            className="shrink-0 self-start"
            data-testid="unarchive-pool"
          >
            {restoring ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {restoring ? t("unarchiving") : t("unarchive")}
          </Button>
        )}
      </div>
    </Card>
  )
}

interface ArchivePoolButtonProps {
  groupId: string
  /** Connected wallet — the endpoint authorises against the pool creator. */
  adminAddress: string | null
  onArchived?: () => void
}

/**
 * Manual archive control for the pool admin, shown on an active pool. Behind a
 * confirmation because archival removes the pool from everyone's active list —
 * reversible, but not something to trigger with a stray click.
 */
export function ArchivePoolButton({ groupId, adminAddress, onArchived }: ArchivePoolButtonProps) {
  const t = useTranslations("group.archived")
  const { kit } = useStellar()
  const [open, setOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const handleArchive = async () => {
    if (!adminAddress || !kit) return toastManager.error(t("archiveError"))
    setArchiving(true)
    try {
      // Signed before the request, for the same reason as the restore above.
      const proof = await signArchiveProof({
        kit,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        adminAddress,
        poolId: groupId,
      })
      const res = await fetch(`/api/pools/${groupId}/archive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          admin_address: adminAddress,
          signature: proof.signature,
          signed_at: proof.signedAt,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      toastManager.success(t("archiveSuccess"))
      setOpen(false)
      onArchived?.()
    } catch {
      toastManager.error(t("archiveError"))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setOpen(true)}
        data-testid="archive-pool"
      >
        <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
        {t("archive")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("archiveConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("archiveConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={archiving}>
              {t("cancel")}
            </Button>
            <Button onClick={handleArchive} disabled={archiving}>
              {archiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {archiving ? t("archiving") : t("archive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
