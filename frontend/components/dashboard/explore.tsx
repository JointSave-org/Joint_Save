"use client"

import { Card } from "@/components/ui/card"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Compass } from "lucide-react"
import { motion } from "framer-motion"
import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PoolCard, PoolCardSkeleton, type Pool } from "@/components/dashboard/pool-card"

const PAGE_SIZE = 6

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

export function Explore() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pools, setPools] = useState<Pool[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Use a dedicated query param so it doesn't collide with My Groups pagination.
  const page = Math.max(0, parseInt(searchParams.get("explorePage") || "0", 10))
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("explorePage", String(p))
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  useEffect(() => {
    loadPools(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const loadPools = async (currentPage: number) => {
    try {
      setLoading(true)
      setError("")
      const res = await fetch(`/api/pools?explore=true&page=${currentPage}`)
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">Explore Pools</h2>
          <p className="text-muted-foreground mt-1">
            Browse savings circles and see how reliably their members participate
          </p>
        </div>
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          aria-label="Loading pools"
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
          <h2 className="text-3xl font-bold">Explore Pools</h2>
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
      >
        <h2 className="text-3xl font-bold">Explore Pools</h2>
        <p className="text-muted-foreground mt-1">
          {total === 0
            ? "No pools to explore yet"
            : `Browse ${total} pool${total !== 1 ? "s" : ""} — the health badge shows how reliably members have been depositing`}
        </p>
      </motion.div>

      {pools.length === 0 ? (
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="rounded-full bg-muted p-3">
            <Compass className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="font-medium">Nothing to explore just yet</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Once people start creating savings pools, they&apos;ll show up here for you to browse.
          </p>
        </Card>
      ) : (
        <>
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {pools.map((pool) => (
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
