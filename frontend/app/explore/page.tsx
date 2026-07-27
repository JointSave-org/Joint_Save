"use client"

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Suspense,
  type KeyboardEvent,
  type MouseEvent,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, Users, TrendingUp, Calendar, Loader2, Send, AlertCircle } from "lucide-react"
import { motion } from "framer-motion"
import { useStellar } from "@/components/web3-provider"
import { fetchFactoryPools } from "@/hooks/useJointSaveContracts"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { ErrorBoundary } from "@/components/error-boundary"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pool {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: "active" | "completed" | "paused"
  creator_address: string
  contract_address: string
  members_count: number
  total_saved: number
  target_amount: number | null
  contribution_amount: number | null
  frequency: string | null
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
}
const itemAnim = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }

function timeAgo(date: string) {
  const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (secs < 60) return "just now"
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function PoolCardSkeleton() {
  return (
    <Card className="p-6 h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-3 mb-4 flex-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
    </Card>
  )
}

// ── Pool Card ─────────────────────────────────────────────────────────────────

function PoolCard({
  pool,
  onRequestJoin,
  isJoining,
  tabIndex,
  cardRef,
  onFocus,
  onClick,
  onKeyDown,
}: {
  pool: Pool
  onRequestJoin: (poolId: string) => void
  isJoining: boolean
  tabIndex: number
  cardRef: (node: HTMLDivElement | null) => void
  onFocus: () => void
  onClick: (event: MouseEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const typeLabel = pool.type.charAt(0).toUpperCase() + pool.type.slice(1)
  const statusLabel =
    pool.status === "active" ? "Active" : pool.status === "completed" ? "Completed" : "Paused"

  return (
    <motion.div
      ref={cardRef}
      variants={itemAnim}
      tabIndex={tabIndex}
      role="link"
      aria-label={`View details for ${pool.name}`}
      onFocus={onFocus}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="h-full cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="p-6 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 h-full flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold truncate mb-1">{pool.name}</h3>
            <Badge variant="secondary">{typeLabel}</Badge>
          </div>
          <Badge
            className={
              pool.status === "active"
                ? "bg-emerald-500/10 text-emerald-500"
                : pool.status === "completed"
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-500/10 text-amber-500"
            }
          >
            {statusLabel}
          </Badge>
        </div>

        <div className="space-y-3 mb-4 flex-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Members
            </span>
            <span className="font-medium">{pool.members_count}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Total Saved
            </span>
            <span className="font-medium">{pool.total_saved?.toFixed(2) ?? "0.00"} XLM</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {pool.type === "rotational" ? "Frequency" : "Created"}
            </span>
            <span className="font-medium">{pool.frequency || timeAgo(pool.created_at)}</span>
          </div>
          {pool.type === "target" && pool.target_amount != null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Target</span>
              <span className="font-medium">{pool.target_amount.toFixed(2)} XLM</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={(event) => {
              event.stopPropagation()
              onRequestJoin(pool.id)
            }}
            disabled={isJoining || pool.status !== "active"}
          >
            {isJoining ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1" />
            )}
            Request to Join
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/group/${pool.id}`} onClick={(event) => event.stopPropagation()}>
              View
            </Link>
          </Button>
        </div>
      </Card>
    </motion.div>
  )
}

// ── Explore Page ──────────────────────────────────────────────────────────────

function ExploreContent() {
  const { address } = useStellar()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const gridRef = useRef<HTMLDivElement | null>(null)
  const poolCardRefs = useRef<Array<HTMLDivElement | null>>([])

  const [pools, setPools] = useState<Pool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [joining, setJoining] = useState<string | null>(null)
  const [focusedPoolIndex, setFocusedPoolIndex] = useState(0)

  // Filter state is derived from the URL so it survives refresh and can be shared.
  const search = searchParams.get("search") || ""
  const filterType = searchParams.get("type") || ""
  const filterStatus = searchParams.get("status") || ""
  const [searchInput, setSearchInput] = useState(search)
  const debouncedSearchInput = useDebouncedValue(searchInput, 300)

  // Sync a single filter to the URL query string. router.replace (not push)
  // keeps the back button from stepping through every individual filter toggle.
  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : "?", { scroll: false })
    },
    [router, searchParams]
  )

  const setSearch = useCallback((v: string) => updateParam("search", v), [updateParam])
  const setFilterType = useCallback((v: string) => updateParam("type", v), [updateParam])
  const setFilterStatus = useCallback((v: string) => updateParam("status", v), [updateParam])

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  useEffect(() => {
    if (debouncedSearchInput !== search) {
      setSearch(debouncedSearchInput)
    }
  }, [debouncedSearchInput, search, setSearch])

  // Fetch pools from DB + factory
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        setError("")

        const [dbRes, factoryPools] = await Promise.all([
          fetch("/api/pools"),
          fetchFactoryPools().catch(() => ({ rotational: [], target: [], flexible: [] })),
        ])

        if (!dbRes.ok) throw new Error("Failed to fetch pools")

        let dbPools: Pool[] = await dbRes.json()
        if (!Array.isArray(dbPools)) dbPools = []

        // Cross-reference factory contract IDs with DB
        const allFactoryIds = new Set([
          ...factoryPools.rotational.map((a: string) => a.toLowerCase()),
          ...factoryPools.target.map((a: string) => a.toLowerCase()),
          ...factoryPools.flexible.map((a: string) => a.toLowerCase()),
        ])

        // Show DB pools + any factory pools not yet in DB
        const dbAddresses = new Set(dbPools.map((p) => p.contract_address?.toLowerCase()))
        const missingFromDb = Array.from(allFactoryIds).filter((a) => !dbAddresses.has(a))

        setPools(dbPools)
        if (missingFromDb.length > 0) {
          console.info(`${missingFromDb.length} pool(s) from factory not yet in database`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load pools")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Filtering
  const filteredPools = useMemo(() => {
    return pools.filter((pool) => {
      if (filterType && pool.type !== filterType) return false
      if (filterStatus === "active" && pool.status !== "active") return false
      if (filterStatus === "completed" && pool.status !== "completed") return false
      if (search && !pool.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [pools, search, filterType, filterStatus])

  const activePoolIndex =
    filteredPools.length > 0 ? Math.min(focusedPoolIndex, filteredPools.length - 1) : 0

  useEffect(() => {
    poolCardRefs.current = poolCardRefs.current.slice(0, filteredPools.length)
    setFocusedPoolIndex((index) => Math.min(index, Math.max(filteredPools.length - 1, 0)))
  }, [filteredPools.length])

  const getGridColumnCount = useCallback(() => {
    if (!gridRef.current) return 1

    const columns = window
      .getComputedStyle(gridRef.current)
      .gridTemplateColumns.split(" ")
      .filter(Boolean).length

    return Math.max(columns, 1)
  }, [])

  const focusPoolCard = useCallback((index: number) => {
    poolCardRefs.current[index]?.focus()
  }, [])

  const handleViewPool = useCallback(
    (poolId: string) => {
      router.push(`/dashboard/group/${poolId}`)
    },
    [router]
  )

  const handlePoolCardClick = useCallback(
    (event: MouseEvent<HTMLDivElement>, poolId: string) => {
      if ((event.target as HTMLElement).closest("a,button")) return
      handleViewPool(poolId)
    },
    [handleViewPool]
  )

  const handlePoolCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number, poolId: string) => {
      if (event.target !== event.currentTarget) return

      const columnCount = getGridColumnCount()
      const columnIndex = index % columnCount
      let nextIndex = index

      if (event.key === "ArrowLeft") {
        event.preventDefault()
        if (columnIndex > 0) nextIndex = index - 1
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        if (columnIndex < columnCount - 1 && index < filteredPools.length - 1) {
          nextIndex = index + 1
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        if (index - columnCount >= 0) nextIndex = index - columnCount
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        if (index + columnCount < filteredPools.length) {
          nextIndex = index + columnCount
        }
      } else if (event.key === "Enter") {
        handleViewPool(poolId)
        return
      } else if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault()
        handleViewPool(poolId)
        return
      } else {
        return
      }

      if (nextIndex !== index) {
        setFocusedPoolIndex(nextIndex)
        focusPoolCard(nextIndex)
      }
    },
    [filteredPools.length, focusPoolCard, getGridColumnCount, handleViewPool]
  )

  // Join request handler
  const handleRequestJoin = useCallback(
    async (poolId: string) => {
      if (!address) {
        toast({
          title: "Connect Wallet",
          description: "Please connect your wallet to request joining a pool.",
        })
        return
      }
      setJoining(poolId)
      try {
        const res = await fetch("/api/join-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ poolId, requesterAddress: address }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || "Failed to send request")
        }
        toast({ title: "Request Sent", description: "The pool creator will review your request." })
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Something went wrong",
          variant: "error",
        })
      } finally {
        setJoining(null)
      }
    },
    [address, toast]
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Explore Pools</h1>
          <p className="text-muted-foreground">
            Discover savings pools on Stellar, filter by type, and request to join.
          </p>
        </motion.div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by pool name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Types</SelectItem>
              <SelectItem value="rotational">Rotational</SelectItem>
              <SelectItem value="target">Target</SelectItem>
              <SelectItem value="flexible">Flexible</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <PoolCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <Card className="p-8 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-medium mb-2">Failed to load pools</p>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </Card>
        )}

        {/* Empty State */}
        {!loading && !error && filteredPools.length === 0 && (
          <div className="text-center py-16">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">No pools found</h3>
            <p className="text-sm text-muted-foreground">
              {search || filterType || filterStatus
                ? "Try adjusting your search or filters."
                : "No pools have been created yet. Be the first!"}
            </p>
          </div>
        )}

        {/* Pool Grid */}
        {!loading && filteredPools.length > 0 && (
          <motion.div
            ref={gridRef}
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredPools.map((pool, index) => (
              <PoolCard
                key={pool.id}
                pool={pool}
                onRequestJoin={handleRequestJoin}
                isJoining={joining === pool.id}
                tabIndex={index === activePoolIndex ? 0 : -1}
                cardRef={(node) => {
                  poolCardRefs.current[index] = node
                }}
                onFocus={() => setFocusedPoolIndex(index)}
                onClick={(event) => handlePoolCardClick(event, pool.id)}
                onKeyDown={(event) => handlePoolCardKeyDown(event, index, pool.id)}
              />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}

// Loading fallback shown while useSearchParams resolves on the client.
function ExploreFallback() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <PoolCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

// useSearchParams requires a Suspense boundary at the page level.
export default function ExplorePage() {
  return (
    <Suspense fallback={<ExploreFallback />}>
      <ErrorBoundary sectionName="Explore Pools">
        <ExploreContent />
      </ErrorBoundary>
    </Suspense>
  )
}
