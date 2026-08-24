"use client"

import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, ArrowUpRight, CheckCircle2, X } from "lucide-react"
import type { ComparisonPool, ComparisonPoolRecord } from "@/hooks/usePoolComparison"

/**
 * Cell content that highlights the "best" value in a row.
 *
 * For a handful of numeric rows we pick a winner (e.g. highest TVL, lowest
 * deposit) and render it emphasised with a check badge so users can scan the
 * table and instantly see which pool is strongest per metric.
 */
interface BestValueCellProps {
  best: boolean
  children: React.ReactNode
  /** Short label for the check badge, e.g. "Best" / "Lowest". */
  badgeLabel?: string
}

function BestValueCell({ best, children, badgeLabel }: BestValueCellProps) {
  const t = useTranslations("explore.comparisonTable")
  const label = badgeLabel ?? t("best")
  return (
    <div className="flex items-center gap-1.5">
      <span className={best ? "font-semibold text-primary" : ""}>{children}</span>
      {best && (
        <span
          title={t("valueSuffix", { label })}
          className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-3 w-3" />
          {label}
        </span>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** True when this column's value is the "best" across the given row of pools. */
function isBest(
  pools: ComparisonPool[],
  getter: (pool: ComparisonPool) => number | null,
  preferHigher: boolean
): boolean[] {
  const values = pools.map((p) => getter(p))
  const finite = values.filter((v): v is number => v !== null)
  if (finite.length === 0) return values.map(() => false)
  const target = preferHigher ? Math.max(...finite) : Math.min(...finite)
  return values.map((v) => v !== null && v === target)
}

/** TVL shown from the DB record, falling back to the on-chain-style total. */
function tvlOf(pool: ComparisonPoolRecord): number {
  return pool.total_saved ?? 0
}

/** Deposit amount shown per pool type. */
function depositOf(pool: ComparisonPoolRecord): number | null {
  if (pool.type === "target") return pool.target_amount ?? null
  if (pool.type === "flexible") return pool.minimum_deposit ?? pool.contribution_amount ?? null
  return pool.contribution_amount ?? null
}

interface ComparisonTableProps {
  pools: ComparisonPool[]
  /** Called when the user removes a pool from the comparison. */
  onRemove?: (key: string) => void
  /** Called when the user clears the whole comparison. */
  onClear?: () => void
}

/**
 * Side-by-side comparison table.
 *
 * The first column (metric labels) is sticky so it stays visible while the
 * pool columns scroll horizontally on narrow screens.
 */
export function ComparisonTable({ pools, onRemove, onClear }: ComparisonTableProps) {
  const t = useTranslations("explore.comparisonTable")
  const tPool = useTranslations("pool")

  const typeLabel = (type: string) => tPool(`type.${type}` as "type.rotational")
  const statusLabel = (status: string) =>
    ["active", "completed", "paused"].includes(status)
      ? tPool(`status.${status}` as "status.active")
      : status

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds || seconds <= 0) return "—"
    const days = seconds / 86400
    if (days >= 30) return t("durationMonths", { count: Math.round(days / 30) })
    if (days >= 1) return t("durationDays", { count: Math.round(days) })
    const hours = seconds / 3600
    if (hours >= 1) return t("durationHours", { count: Math.round(hours) })
    return t("durationMinutes", { count: Math.round(seconds / 60) })
  }

  const memberCountOf = (pool: ComparisonPoolRecord): { count: number; max: string } => {
    const count = pool.members_count ?? 0
    if (pool.type === "flexible") return { count, max: t("open") }
    return { count, max: String(Math.max(count, 1)) }
  }

  const healthLabel = (pool: ComparisonPool): { label: string; color: string } => {
    if (!pool.health) return { label: "…", color: "text-muted-foreground" }
    if (pool.health.state === "new" || pool.health.score === null) {
      return { label: t("newPool"), color: "text-muted-foreground" }
    }
    if (pool.health.band === "healthy")
      return { label: `${pool.health.score}%`, color: "text-emerald-600 dark:text-emerald-400" }
    if (pool.health.band === "fair")
      return { label: `${pool.health.score}%`, color: "text-amber-600 dark:text-amber-400" }
    return { label: `${pool.health.score}%`, color: "text-destructive" }
  }

  const resolved = pools.filter((p) => p.pool !== null && !p.error)

  const bestTvl = isBest(resolved, (p) => (p.pool ? tvlOf(p.pool) : null), true)
  const bestDeposit = isBest(resolved, (p) => (p.pool ? depositOf(p.pool) : null), false)
  const bestMembers = isBest(resolved, (p) => (p.pool ? p.pool.members_count : null), true)
  const bestHealth = isBest(resolved, (p) => p.health?.score ?? null, true)
  const bestReputation = isBest(resolved, (p) => p.avgReputation ?? null, true)

  const tokenSymbolOf = (pool: ComparisonPoolRecord) => pool.token_symbol ?? "XLM"

  const renderColumnValue = (pool: ComparisonPool) => {
    if (pool.loading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      )
    }
    if (pool.error || !pool.pool) {
      return (
        <div className="flex flex-col items-start gap-2 text-destructive" role="alert">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <AlertCircle className="h-4 w-4" />
            {t("invalidPool")}
          </span>
          <span className="text-xs text-muted-foreground break-all font-mono">{pool.key}</span>
          <span className="text-xs">{pool.error || t("couldNotBeLoaded")}</span>
        </div>
      )
    }

    const record = pool.pool

    return (
      <div className="space-y-4 min-w-0">
        {/* Pool name + type + status */}
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-snug break-words">{record.name}</h3>
            {onRemove && (
              <button
                onClick={() => onRemove(pool.key)}
                aria-label={t("removeFromComparisonAria", { name: record.name })}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Badge variant="secondary">{typeLabel(record.type)}</Badge>
            <Badge
              className={
                record.status === "active"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : record.status === "paused"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
              }
            >
              {statusLabel(record.status)}
            </Badge>
          </div>
        </div>

        {/* Join Pool CTA */}
        <Button size="sm" variant="default" asChild className="w-full sm:w-auto">
          <Link
            href={
              record.contract_address && record.contract_address !== "pending_deployment"
                ? `/join/${record.contract_address}`
                : `/dashboard/group/${record.id}`
            }
          >
            {t("joinPool")}
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="relative w-full">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm" aria-label={t("tableAria")}>
          <tbody>
            {/* Pool name header row */}
            <tr className="border-b border-border">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-background p-4 text-left align-top font-medium text-muted-foreground w-40 min-w-40 max-w-52"
              >
                {t("pool")}
              </th>
              {pools.map((pool) => (
                <td
                  key={pool.key}
                  className="border-l border-border/60 p-4 align-top min-w-56 max-w-72"
                >
                  {renderColumnValue(pool)}
                </td>
              ))}
              {pools.length === 0 && (
                <td className="p-4 text-muted-foreground">{t("selectPoolsToCompare")}</td>
              )}
            </tr>

            {pools.length > 0 && (
              <>
                {/* Pool Type */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("poolType")}
                  </th>
                  {pools.map((pool) => (
                    <td key={pool.key} className="border-l border-border/60 p-3">
                      {pool.pool ? typeLabel(pool.pool.type) : pool.error ? "—" : "…"}
                    </td>
                  ))}
                </tr>

                {/* TVL */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("tvl")}
                  </th>
                  {resolved.map((pool, i) => (
                    <td key={pool.key} className="border-l border-border/60 p-3">
                      <BestValueCell best={bestTvl[i]}>
                        {tvlOf(pool.pool as ComparisonPoolRecord).toFixed(2)}{" "}
                        {tokenSymbolOf(pool.pool as ComparisonPoolRecord)}
                      </BestValueCell>
                    </td>
                  ))}
                  {pools.some((p) => p.error) && (
                    <td className="border-l border-border/60 p-3 text-muted-foreground">—</td>
                  )}
                </tr>

                {/* Member Count/Max */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("members")}
                  </th>
                  {resolved.map((pool, i) => {
                    const record = pool.pool as ComparisonPoolRecord
                    const { count, max } = memberCountOf(record)
                    return (
                      <td key={pool.key} className="border-l border-border/60 p-3">
                        <BestValueCell best={bestMembers[i]}>
                          {count} / {max}
                        </BestValueCell>
                      </td>
                    )
                  })}
                  {pools.some((p) => p.error) && (
                    <td className="border-l border-border/60 p-3 text-muted-foreground">—</td>
                  )}
                </tr>

                {/* Deposit Amount */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("depositAmount")}
                  </th>
                  {resolved.map((pool, i) => {
                    const record = pool.pool as ComparisonPoolRecord
                    const deposit = depositOf(record)
                    return (
                      <td key={pool.key} className="border-l border-border/60 p-3">
                        {deposit === null ? (
                          "—"
                        ) : (
                          <BestValueCell best={bestDeposit[i]} badgeLabel={t("lowest")}>
                            {deposit.toFixed(2)} {tokenSymbolOf(record)}
                          </BestValueCell>
                        )}
                      </td>
                    )
                  })}
                  {pools.some((p) => p.error) && (
                    <td className="border-l border-border/60 p-3 text-muted-foreground">—</td>
                  )}
                </tr>

                {/* Token */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("token")}
                  </th>
                  {pools.map((pool) => (
                    <td key={pool.key} className="border-l border-border/60 p-3">
                      {pool.pool ? (pool.pool.token_symbol ?? "XLM") : pool.error ? "—" : "…"}
                    </td>
                  ))}
                </tr>

                {/* Round Duration */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("roundDuration")}
                  </th>
                  {pools.map((pool) => (
                    <td key={pool.key} className="border-l border-border/60 p-3">
                      {pool.pool
                        ? pool.pool.frequency
                          ? pool.pool.frequency
                          : formatDuration(pool.pool.round_duration)
                        : pool.error
                          ? "—"
                          : "…"}
                    </td>
                  ))}
                </tr>

                {/* Health Score */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("healthScore")}
                  </th>
                  {resolved.map((pool, i) => (
                    <td key={pool.key} className="border-l border-border/60 p-3">
                      <BestValueCell best={bestHealth[i]}>
                        <span className={healthLabel(pool).color}>{healthLabel(pool).label}</span>
                      </BestValueCell>
                    </td>
                  ))}
                  {pools.some((p) => p.error) && (
                    <td className="border-l border-border/60 p-3 text-muted-foreground">—</td>
                  )}
                </tr>

                {/* Avg Member Reputation */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("avgMemberReputation")}
                  </th>
                  {resolved.map((pool, i) => (
                    <td key={pool.key} className="border-l border-border/60 p-3">
                      {pool.avgReputation === null ? (
                        "—"
                      ) : (
                        <BestValueCell best={bestReputation[i]}>
                          {pool.avgReputation}%
                        </BestValueCell>
                      )}
                    </td>
                  ))}
                  {pools.some((p) => p.error) && (
                    <td className="border-l border-border/60 p-3 text-muted-foreground">—</td>
                  )}
                </tr>

                {/* Created Date */}
                <tr className="border-b border-border/60">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground"
                  >
                    {t("created")}
                  </th>
                  {pools.map((pool) => (
                    <td key={pool.key} className="border-l border-border/60 p-3">
                      {pool.pool ? formatDate(pool.pool.created_at) : pool.error ? "—" : "…"}
                    </td>
                  ))}
                </tr>

                {/* Description */}
                <tr>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left font-medium text-muted-foreground align-top"
                  >
                    {t("description")}
                  </th>
                  {pools.map((pool) => (
                    <td key={pool.key} className="border-l border-border/60 p-3 align-top">
                      {pool.pool ? (
                        <span className="text-muted-foreground leading-relaxed">
                          {pool.pool.description || t("noDescriptionProvided")}
                        </span>
                      ) : pool.error ? (
                        "—"
                      ) : (
                        "…"
                      )}
                    </td>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {onClear && pools.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={onClear}>
            {t("clearComparison")}
          </Button>
        </div>
      )}
    </div>
  )
}
