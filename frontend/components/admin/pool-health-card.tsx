"use client"

import { useLocale, useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, TrendingUp, Calendar, Activity, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminPoolData } from "@/app/api/admin/pools/route"
import { formatRelativeTime } from "@/lib/utils"

const BAND_STYLES = {
  healthy: {
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  },
  fair: {
    dot: "bg-amber-500",
    ring: "ring-amber-500/30",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  },
  "at-risk": {
    dot: "bg-rose-500",
    ring: "ring-rose-500/30",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  },
  new: {
    dot: "bg-muted-foreground",
    ring: "ring-muted-foreground/30",
    chip: "bg-muted text-muted-foreground border-border",
  },
}

function HealthScoreRing({ score, band }: { score: number; band: string }) {
  const styles = BAND_STYLES[band as keyof typeof BAND_STYLES] ?? BAND_STYLES.new
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="relative flex items-center justify-center">
      <svg width="88" height="88" className="transform -rotate-90">
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted/50"
        />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={styles.dot}
          style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold">{score}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  )
}

export function PoolHealthCard({
  pool,
  isSelected,
  onToggleSelect,
}: {
  pool: AdminPoolData
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const t = useTranslations("admin.healthCard")
  const tPool = useTranslations("pool")
  const locale = useLocale()
  const styles = BAND_STYLES[pool.health_band] ?? BAND_STYLES.new
  const memberCount = pool.pool_members?.length ?? pool.members_count
  const lastActivity = pool.pool_activity?.[0]?.created_at
  const criticalAnomalies = pool.anomalies.filter((a) => a.severity === "critical")

  return (
    <Card
      className={cn(
        "p-5 transition-all duration-200 hover:shadow-md",
        isSelected && "ring-2 ring-primary"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Health Score Ring */}
        <div className="shrink-0">
          {pool.health_band === "new" ? (
            <div className="w-[88px] h-[88px] rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
              <span className="text-xs text-muted-foreground text-center leading-tight">
                {t("noData")}
              </span>
            </div>
          ) : (
            <HealthScoreRing score={pool.health_score} band={pool.health_band} />
          )}
        </div>

        {/* Pool Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-base truncate">{pool.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="capitalize text-xs">
                  {tPool(`type.${pool.type}`)}
                </Badge>
                <Badge variant="outline" className={cn("text-xs", styles.chip)}>
                  {pool.health_band === "new" ? t("newBand") : `${pool.health_score}%`}
                </Badge>
                {criticalAnomalies.length > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {t("criticalCount", { count: criticalAnomalies.length })}
                  </Badge>
                )}
              </div>
            </div>
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(pool.id)}
                className="mt-1 h-4 w-4 rounded border-muted-foreground/50"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mt-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{t("membersLabel", { count: memberCount })}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>
                {pool.total_saved} {pool.token_symbol}
              </span>
            </div>
            {pool.next_payout && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>{t("nextPayout", { time: formatRelativeTime(new Date(pool.next_payout), locale) })}</span>
              </div>
            )}
            {lastActivity && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                <span>{t("activeLabel", { time: formatRelativeTime(new Date(lastActivity), locale) })}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Anomaly indicators */}
      {pool.anomalies.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap gap-1.5">
          {pool.anomalies.map((anomaly, i) => (
            <Badge
              key={i}
              variant="outline"
              className={cn(
                "text-[10px] font-normal",
                anomaly.severity === "critical" &&
                  "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
                anomaly.severity === "warning" &&
                  "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
                anomaly.severity === "info" &&
                  "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
              )}
            >
              {anomaly.message}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  )
}

export function PoolHealthCardSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <Skeleton className="w-[88px] h-[88px] rounded-full shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </div>
    </Card>
  )
}
