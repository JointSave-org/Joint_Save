import { useRouter, useSearchParams } from "next/navigation"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
export function MyGroups({ onCreateClick }: MyGroupsProps) {
  const { address } = useStellar()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pools, setPools] = useState<Pool[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10))
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const setPage = useCallback((p: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", String(p))
    router.push(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

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

      const res = await fetch(
        `/api/pools?creator=${address?.toLowerCase()}&page=${currentPage}`
      )

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

  if (loading)
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">My Groups</h2>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    )

  if (error)
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

      {pools.length === 0 ? (
        <EmptyState onCreateClick={onCreateClick} />
      ) : (
        <>
          <FirstPoolTooltip poolCount={pools.length} />

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
                Showing {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, total)} of {total} pools
              </p>

              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage(page - 1)}
                      aria-disabled={page === 0}
                      className={
                        page === 0
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
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
    </div>
  )
}