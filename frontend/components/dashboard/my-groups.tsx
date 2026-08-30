"use client"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LayoutGrid, Search, CalendarDays, Archive } from "lucide-react"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"
import { useState, useEffect, useCallback } from "react"
import { useRouter } from "@/i18n/navigation"
import { useSearchParams } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FirstPoolTooltip } from "@/components/dashboard/first-pool-tooltip"
import { PoolCard, PoolCardSkeleton, type Pool } from "@/components/dashboard/pool-card"
import { BatchDepositPanel } from "@/components/dashboard/batch-deposit-panel"
import { DepositCalendar } from "@/components/dashboard/deposit-calendar/DepositCalendar"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { ArchivedPoolCard, type ArchivedPool } from "@/components/shared/archived-pool-card"

const PAGE_SIZE = 6

interface MyGroupsProps {
  onCreateClick?: () => void
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

// ── Main MyGroups component ───────────────────────────────────────────────────
export function MyGroups({ onCreateClick }: MyGroupsProps) {
  const t = useTranslations("dashboard.myGroups")
  const tArchived = useTranslations("dashboard.archived")
  const { address } = useStellar()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pools, setPools] = useState<Pool[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [view, setView] = useState<"grid" | "calendar">("grid")

  const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10))
  const searchTerm = searchParams.get("search") || ""
  const [searchInput, setSearchInput] = useState(searchTerm)
  const debouncedSearchInput = useDebouncedValue(searchInput, 300)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Tab lives in the URL so an archived view survives a refresh or a back
  // navigation from a pool's history page.
  const tab = searchParams.get("groupsTab") === "archived" ? "archived" : "active"

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("page", String(p))
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const setTab = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === "archived") params.set("groupsTab", "archived")
      else params.delete("groupsTab")
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const setSearchTerm = useCallback(
    (term: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (term) {
        params.set("search", term)
      } else {
        params.delete("search")
      }
      // Reset to first page when searching
      params.set("page", "0")
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  useEffect(() => {
    setSearchInput(searchTerm)
  }, [searchTerm])

  useEffect(() => {
    if (debouncedSearchInput !== searchTerm) {
      setSearchTerm(debouncedSearchInput)
    }
  }, [debouncedSearchInput, searchTerm, setSearchTerm])

  useEffect(() => {
    if (!address) {
      setLoading(false)
      return
    }
    loadPools(page)
  }, [address, page])

  const loadPools = async (currentPage: number) => {
    try {
      setLoading(true)
      setError("")
      // No `archived` param — archived pools are excluded by default and live
      // in their own tab below.
      const res = await fetch(`/api/pools?creator=${address?.toLowerCase()}&page=${currentPage}`)
      if (!res.ok) throw new Error(t("fetchError"))
      const json = await res.json()
      const data: Pool[] = Array.isArray(json) ? json : (json.data ?? [])
      setPools(data)
      setTotal(json.total ?? data.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fetchError"))
      setPools([])
    } finally {
      setLoading(false)
    }
  }

  // Client-side filtering by pool name
  // Note: This filters only the currently loaded page (6 pools max).
  // For a full cross-page search, we would need backend API support.
  const filteredPools = searchTerm
    ? pools.filter((pool) => pool.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : pools

  const activeContent = loading ? (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      aria-label={t("loadingLabel")}
    >
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <PoolCardSkeleton key={i} />
      ))}
    </div>
  ) : error ? (
    <Card className="p-6 bg-destructive/10 text-destructive">
      <p>{error}</p>
    </Card>
  ) : (
    <div className="space-y-6">
      {/* Deposits owed across every pool the wallet belongs to. Renders
          nothing when there is nothing outstanding. */}
      <BatchDepositPanel onDepositsComplete={() => loadPools(page)} />

      {view === "calendar" ? (
        <DepositCalendar />
      ) : (
        <>
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          {pools.length === 0 ? (
            <EmptyState onCreateClick={onCreateClick} />
          ) : filteredPools.length === 0 ? (
            <Card className="p-12 flex flex-col items-center text-center gap-3">
              <div className="rounded-full bg-muted p-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium">{t("noSearchResultsTitle")}</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                {t.rich("noSearchResultsHint", {
                  clear: (chunks) => (
                    <button
                      onClick={() => setSearchInput("")}
                      className="text-primary hover:underline"
                    >
                      {chunks}
                    </button>
                  ),
                })}
              </p>
            </Card>
          ) : (
            <>
              <FirstPoolTooltip poolCount={pools.length} />

              <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              >
                {filteredPools.map((pool) => (
                  <PoolCard key={pool.id} pool={pool} />
                ))}
              </motion.div>

              {totalPages > 1 && (
                <div className="flex flex-col items-center gap-3 mt-4">
                  <p className="text-sm text-muted-foreground">
                    {t("showingRange", {
                      from: page * PAGE_SIZE + 1,
                      to: Math.min((page + 1) * PAGE_SIZE, total),
                      total,
                    })}
                  </p>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setPage(page - 1)}
                          aria-disabled={page === 0}
                          className={
                            page === 0 ? "pointer-events-none opacity-50" : "cursor-pointer"
                          }
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => setPage(page + 1)}
                          aria-disabled={page >= totalPages - 1}
                          className={
                            page >= totalPages - 1
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <h2 className="text-3xl font-bold">{t("title")}</h2>
          {loading ? (
            <Skeleton className="h-4 w-40 mt-2" />
          ) : (
            <p className="text-muted-foreground mt-1">{t("activeGroupsCount", { count: total })}</p>
          )}
        </div>

        {/* Grid/calendar only applies to active groups — archived pools have no
            upcoming deposits to put on a calendar. */}
        {tab === "active" && (
          <ToggleGroup
            type="single"
            variant="outline"
            value={view}
            onValueChange={(next) => next && setView(next as "grid" | "calendar")}
            aria-label={t("viewToggle.label")}
          >
            <ToggleGroupItem
              value="grid"
              aria-label={t("viewToggle.grid")}
              data-testid="my-groups-view-grid"
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("viewToggle.grid")}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="calendar"
              aria-label={t("viewToggle.calendar")}
              data-testid="my-groups-view-calendar"
            >
              <CalendarDays className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("viewToggle.calendar")}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </motion.div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="active" data-testid="my-groups-tab-active">
            {tArchived("tabActive")}
          </TabsTrigger>
          <TabsTrigger value="archived" className="gap-1.5" data-testid="my-groups-tab-archived">
            <Archive className="size-3.5" aria-hidden="true" />
            {tArchived("tabArchived")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">{activeContent}</TabsContent>

        <TabsContent value="archived">
          <ArchivedGroups address={address} enabled={tab === "archived"} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Archived tab ──────────────────────────────────────────────────────────────

/**
 * Compact list of the wallet's archived pools (issue #212).
 *
 * Fetched lazily — the request only fires once the tab is opened, so the
 * common case of never looking at archived pools costs nothing. Uses its own
 * `archivedPage` param so paging here does not disturb the active tab.
 */
function ArchivedGroups({ address, enabled }: { address: string | null; enabled: boolean }) {
  const t = useTranslations("dashboard.archived")
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pools, setPools] = useState<ArchivedPool[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const page = Math.max(0, parseInt(searchParams.get("archivedPage") || "0", 10))
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("archivedPage", String(p))
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  useEffect(() => {
    if (!enabled) return
    if (!address) {
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setError("")
        const res = await fetch(
          `/api/pools?creator=${address.toLowerCase()}&page=${page}&archived=only`
        )
        if (!res.ok) throw new Error(t("fetchError"))
        const json = await res.json()
        if (cancelled) return
        const data: ArchivedPool[] = Array.isArray(json) ? json : (json.data ?? [])
        setPools(data)
        setTotal(json.total ?? data.length)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t("fetchError"))
        setPools([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [address, page, enabled, t])

  if (loading) {
    return (
      <div className="space-y-3" aria-label={t("loadingLabel")}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-6 bg-destructive/10 text-destructive">
        <p>{error}</p>
      </Card>
    )
  }

  if (pools.length === 0) {
    return (
      <Card className="p-12 flex flex-col items-center text-center gap-3">
        <div className="rounded-full bg-muted p-3">
          <Archive className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="font-medium">{t("empty")}</p>
        <p className="text-sm text-muted-foreground max-w-sm">{t("emptyHint")}</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>

      <div className="space-y-3">
        {pools.map((pool) => (
          <ArchivedPoolCard key={pool.id} pool={pool} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-3 mt-4">
          <p className="text-sm text-muted-foreground">
            {t("showingRange", {
              from: page * PAGE_SIZE + 1,
              to: Math.min((page + 1) * PAGE_SIZE, total),
              total,
            })}
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage(page - 1)}
                  aria-disabled={page === 0}
                  className={page === 0 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage(page + 1)}
                  aria-disabled={page >= totalPages - 1}
                  className={
                    page >= totalPages - 1 ? "pointer-events-none opacity-50" : "cursor-pointer"
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
}
