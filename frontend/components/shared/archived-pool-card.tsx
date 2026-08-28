"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Archive, ArrowRight, Users } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { useTranslations } from "next-intl"
import type { ArchiveReason } from "@/lib/archival"

export interface ArchivedPool {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  archived_at: string | null
  archive_reason: ArchiveReason | null
  completed_at: string | null
  total_saved: number
  members_count: number
  token_symbol?: string | null
}

/**
 * Compact card for a pool that has left discovery (issue #212).
 *
 * Deliberately quieter and cheaper than PoolCard: no on-chain reads, no
 * health badge, no sparkline. An archived pool's numbers are final, so there
 * is nothing live to fetch, and the archived list is exactly where a page of
 * per-card RPC calls would be pure waste.
 */
export function ArchivedPoolCard({ pool }: { pool: ArchivedPool }) {
  const t = useTranslations("dashboard.archived")
  const tPool = useTranslations("pool")

  const tokenSymbol = pool.token_symbol || "XLM"
  // The completion date is what a member looks for first; pools archived for
  // inactivity never completed, so the archival date stands in.
  const dateLabel = pool.completed_at ?? pool.archived_at
  const reason: ArchiveReason = pool.archive_reason ?? "admin_archived"

  return (
    <Card
      className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 opacity-75 hover:opacity-100 focus-within:opacity-100 transition-opacity"
      role="article"
      aria-label={t("cardAria", { name: pool.name, reason: t(`reason.${reason}`) })}
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold truncate">{pool.name}</h3>
          <Badge variant="secondary">{tPool(`type.${pool.type}`)}</Badge>
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Archive className="h-3 w-3" aria-hidden="true" />
            {t("badge")}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">{t(`reason.${reason}`)}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {dateLabel && (
            <span>
              {pool.completed_at ? t("completedOn") : t("archivedOn")}{" "}
              <time dateTime={dateLabel} className="text-foreground">
                {new Date(dateLabel).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {t("memberCount", { count: pool.members_count })}
          </span>
          <span>
            {t("finalTvl")}{" "}
            <span className="text-foreground font-medium">
              {pool.total_saved.toFixed(2)} {tokenSymbol}
            </span>
          </span>
        </div>
      </div>

      <Button variant="outline" size="sm" asChild className="shrink-0 self-start sm:self-center">
        <Link href={`/dashboard/group/${pool.id}`}>
          {t("viewHistory")}
          <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </Button>
    </Card>
  )
}
