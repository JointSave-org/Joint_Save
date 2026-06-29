"use client"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Search } from "lucide-react"
import { motion } from "framer-motion"
import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import { EmptyState } from "@/components/dashboard/empty-state"
import { FirstPoolTooltip } from "@/components/dashboard/first-pool-tooltip"
import { PoolCard, PoolCardSkeleton, type Pool } from "@/components/dashboard/pool-card"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

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
  const { address } = useStellar()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pools, setPools] = useState<Pool[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10))
  const searchTerm = searchParams.get("search") || ""
  const [searchInput, setSearchInput] = useState(searchTerm)
  const debouncedSearchInput = useDebouncedValue(searchInput, 300)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("page", String(p))
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
      const res = await fetch(`/api/pools?creator=${address?.toLowerCase()}&page=${currentPage}`)
      if (!res.ok) throw new Error("Failed to fetch pools")
      const json = await res.json()
      const data: Pool[] = Array.isArray(json) ? json : (json.data ?? [])
      setPools(data)
      setTotal(json.total ?? data.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch pools")
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">My Groups</h2>
          <Skeleton className="h-4 w-40 mt-2" />
        </div>
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          aria-label="Loading groups"
        >
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <PoolCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">My Groups</h2>
        </div>
        <Card className="p-6 bg-destructive/10 text-destructive">
          <p>{error}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-3xl font-bold">My Groups</h2>
          <p className="text-muted-foreground mt-1">
            {total === 0
              ? "Manage your savings circles"
              : `${total} active group${total !== 1 ? "s" : ""}`}
          </p>
        </div>
      </motion.div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search pools by name..."
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
          <p className="font-medium">No pools match your search</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Try adjusting your search term or{" "}
            <button onClick={() => setSearchInput("")} className="text-primary hover:underline">
              clear the search
            </button>
            .
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
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}{" "}
                pools
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
        </>
      )}
    </div>
  )
}
