"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ArrowLeft, Columns3, Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBoundary } from "@/components/error-boundary"
import { ComparisonTable } from "@/components/explore/comparison-table"
import {
  usePoolComparison,
  getPoolComparisonKey,
  MAX_COMPARISON_POOLS,
} from "@/hooks/usePoolComparison"
import { useToast } from "@/hooks/use-toast"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

interface ExplorePool {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  contract_address?: string | null
}

function CompareContent() {
  const t = useTranslations("explore.compare")
  const tPool = useTranslations("pool")
  const { toast } = useToast()
  const { selectedKeys, pools, togglePool, removePool, clearSelection, canAddMore, isAtMax } =
    usePoolComparison()

  const [available, setAvailable] = useState<ExplorePool[]>([])
  const [loadingPools, setLoadingPools] = useState(true)
  const [searchInput, setSearchInput] = useState("")
  const debouncedSearch = useDebouncedValue(searchInput, 250)

  useEffect(() => {
    let cancelled = false
    fetch("/api/pools")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ExplorePool[]) => {
        if (!cancelled) setAvailable(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setAvailable([])
      })
      .finally(() => {
        if (!cancelled) setLoadingPools(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const addablePools = useMemo(() => {
    const selected = new Set(selectedKeys)
    const term = debouncedSearch.trim().toLowerCase()
    return available
      .filter((pool) => {
        if (selected.has(getPoolComparisonKey(pool))) return false
        if (!term) return true
        return pool.name.toLowerCase().includes(term)
      })
      .slice(0, 30)
  }, [available, selectedKeys, debouncedSearch])

  const handleAdd = useCallback(
    (pool: ExplorePool) => {
      if (isAtMax) {
        toast({
          title: t("comparisonLimitTitle"),
          description: t("comparisonLimitDescription", { max: MAX_COMPARISON_POOLS }),
          variant: "error",
        })
        return
      }
      togglePool(getPoolComparisonKey(pool))
    },
    [isAtMax, togglePool, toast, t]
  )

  const allLoaded = pools.length > 0 && pools.every((p) => !p.loading)

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Button variant="ghost" className="mb-4" asChild>
            <Link href="/explore">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("backToExplore")}
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <Columns3 className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold">{t("title")}</h1>
              <p className="text-muted-foreground mt-1">
                {t("sideBySideView", { count: selectedKeys.length })}
              </p>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {pools.length > 0 && !allLoaded && (
          <Card className="p-6">
            <div className="space-y-3" aria-label={t("loadingComparisonAria")}>
              <Skeleton className="h-5 w-40" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {Array.from({ length: Math.min(pools.length, MAX_COMPARISON_POOLS) * 3 }).map(
                  (_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  )
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Empty state */}
        {pools.length === 0 && (
          <Card className="p-12 text-center">
            <Columns3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">{t("noPoolsToCompare")}</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              {t("noPoolsToCompareHint")}
            </p>
            <Button asChild>
              <Link href="/explore">{t("browsePools")}</Link>
            </Button>
          </Card>
        )}

        {/* Comparison table */}
        {pools.length > 0 && (
          <ComparisonTable pools={pools} onRemove={removePool} onClear={clearSelection} />
        )}

        {/* Add / manage pools */}
        <Card className="mt-8 p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold">{t("addPools")}</h2>
              <p className="text-sm text-muted-foreground">
                {canAddMore
                  ? t("selectUpToPools", { max: MAX_COMPARISON_POOLS })
                  : t("maxPoolsReached", { max: MAX_COMPARISON_POOLS })}
              </p>
            </div>
            {selectedKeys.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearSelection}>
                {t("clearCount", { count: selectedKeys.length })}
              </Button>
            )}
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("searchPoolsPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
              aria-label={t("searchPoolsAria")}
            />
          </div>

          {loadingPools ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loadingPools")}
            </div>
          ) : addablePools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {debouncedSearch
                ? t("noPoolsMatchSearch")
                : canAddMore
                  ? t("noMorePoolsAvailable")
                  : t("maximumPoolsAdded")}
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {addablePools.map((pool) => {
                const key = getPoolComparisonKey(pool)
                const checked = selectedKeys.includes(key)
                return (
                  <li key={key}>
                    <label
                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        checked
                          ? "border-primary/60 bg-primary/5"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!checked && isAtMax}
                        onCheckedChange={() => handleAdd(pool)}
                        aria-label={t("addToComparisonAria", { name: pool.name })}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{pool.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("poolTypeSuffix", {
                            type: tPool(`type.${pool.type}` as "type.rotational"),
                          })}
                        </p>
                      </div>
                      <Plus
                        className={`ml-auto h-4 w-4 shrink-0 ${checked ? "text-primary" : "text-muted-foreground"}`}
                      />
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Share hint */}
        {pools.length > 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">{t("shareHint")}</p>
        )}
      </div>
    </div>
  )
}

function CompareFallback() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-4 w-32 mb-6" />
        <Skeleton className="h-10 w-64 mb-2" />
        <Skeleton className="h-4 w-96 mb-8" />
        <Card className="p-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function ComparePage() {
  const t = useTranslations("explore.compare")
  return (
    <Suspense fallback={<CompareFallback />}>
      <ErrorBoundary sectionName={t("sectionName")}>
        <CompareContent />
      </ErrorBoundary>
    </Suspense>
  )
}
