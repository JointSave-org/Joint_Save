"use client"

import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, ExternalLink } from "lucide-react"
import Link from "next/link"

interface PausedPoolBannerProps {
  groupId: string
  pausedAt: string
  pauseReason: string | null
  /** Only the pool admin sees the deep-link to incident review. */
  isAdmin: boolean
}

/**
 * Banner shown at the top of a paused pool's detail page (issue #261).
 *
 * States plainly that the pool is paused, why, and provides a deep-link to
 * the incident review screen for the admin to act on the pause. Members
 * arriving from a bookmark should understand immediately why deposits are
 * disabled.
 */
export function PausedPoolBanner({
  groupId,
  pausedAt,
  pauseReason,
  isAdmin,
}: PausedPoolBannerProps) {
  const t = useTranslations("group.paused")

  return (
    <Card className="p-4 mb-6 border-amber-500/30 bg-amber-500/5" role="alert">
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="rounded-full bg-amber-500/10 p-2 shrink-0 self-start">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        </div>

        <div className="flex-1 space-y-1">
          <h2 className="font-semibold text-amber-900 dark:text-amber-100">{t("title")}</h2>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {pauseReason || t("defaultReason")}
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-200">{t("body")}</p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t("pausedOn", {
              date: new Date(pausedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
        </div>

        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            asChild
            className="shrink-0 self-start border-amber-500/30 hover:bg-amber-500/10"
            data-testid="review-incident"
          >
            <Link href={`/dashboard/admin/security/incidents?poolId=${groupId}`}>
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("reviewIncident")}
            </Link>
          </Button>
        )}
      </div>
    </Card>
  )
}
