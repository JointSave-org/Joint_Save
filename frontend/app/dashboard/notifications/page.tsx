"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { useStellar } from "@/components/web3-provider"
import { ArrowLeft, Bell } from "lucide-react"
import { formatRelativeTime } from "@/lib/utils"
import type { AppNotification } from "@/hooks/useNotifications"

const PAGE_SIZE = 10

export default function NotificationsPage() {
  const { address, isInitializing } = useStellar()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const page = Math.max(0, parseInt(searchParams.get("page") || "0", 10))
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("page", String(p))
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  const loadNotifications = useCallback(
    async (currentPage: number) => {
      if (!address) {
        setLoading(false)
        return
      }
      try {
        setLoading(true)
        setError("")
        const res = await fetch(
          `/api/notifications?wallet=${encodeURIComponent(address.toLowerCase())}&page=${currentPage}`
        )
        if (!res.ok) throw new Error("Failed to fetch notifications")
        const json = await res.json()
        setNotifications(json.data ?? [])
        setTotal(json.total ?? 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch notifications")
        setNotifications([])
      } finally {
        setLoading(false)
      }
    },
    [address]
  )

  useEffect(() => {
    loadNotifications(page)
  }, [page, loadNotifications])

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-3xl">
        <Button variant="ghost" className="mb-6" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>

        <div className="mb-6">
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground mt-1">
            {isInitializing || loading
              ? "Loading your notifications…"
              : total === 0
                ? "You're all caught up"
                : `${total} notification${total !== 1 ? "s" : ""}`}
          </p>
        </div>

        {!address && !isInitializing ? (
          <Card className="p-6 text-center text-muted-foreground">
            Connect your wallet to view notifications.
          </Card>
        ) : error ? (
          <Card className="p-6 bg-destructive/10 text-destructive">
            <p>{error}</p>
          </Card>
        ) : loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-24" />
              </Card>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <Bell className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground">No notifications yet</p>
          </Card>
        ) : (
          <>
            <div className="space-y-2">
              {notifications.map((n) => {
                const content = (
                  <>
                    <span
                      className={`block text-sm leading-snug ${!n.read ? "font-medium" : "text-muted-foreground"}`}
                    >
                      {n.message}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(new Date(n.created_at))}
                    </span>
                  </>
                )
                return (
                  <Card key={n.id} className="p-4 transition-colors hover:bg-muted/50">
                    {n.pool_id ? (
                      <Link href={`/dashboard/group/${n.pool_id}`} className="block">
                        {content}
                      </Link>
                    ) : (
                      <div>{content}</div>
                    )}
                  </Card>
                )
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex flex-col items-center gap-3 mt-6">
                <p className="text-sm text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{" "}
                  {total} notifications
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
      </main>
    </div>
  )
}
