"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import Image from "next/image"
import { useStellar } from "@/components/web3-provider"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { Copy, Check, ExternalLink, LogOut, ChevronDown, Clock, Bell } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useRecentPools } from "@/hooks/useRecentPools"
import { useNotifications } from "@/hooks/useNotifications"
import { formatRelativeTime } from "@/lib/utils"

export function DashboardHeader() {
  const { address, disconnect } = useStellar()
  const router = useRouter()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const { recentPools } = useRecentPools(address)
  const { notifications, initialLoading, unreadCount, markAllRead } = useNotifications(address)

  const truncatedAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ""

  const explorerUrl = address ? `https://stellar.expert/explorer/testnet/account/${address}` : "#"

  const handleDisconnect = () => {
    disconnect()
    router.push("/")
  }

  const handleCopyAddress = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    toast({ title: "Address copied", description: "Wallet address copied to clipboard." })
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-2">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden">
              <Image
                src="/joint-save.jpg"
                alt="JointSave Logo"
                width={40}
                height={40}
                className="object-cover"
              />
            </div>
            <span className="hidden text-xl font-bold sm:inline">JointSave</span>
          </Link>

          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <span className="text-xs text-muted-foreground hidden md:block">
              Press{" "}
              <kbd className="rounded-sm border border-border bg-muted px-1 font-sans text-[10px] font-medium">
                ?
              </kbd>{" "}
              for shortcuts
            </span>
            <Button variant="ghost" size="sm" asChild className="hidden sm:flex">
              <Link href="/explore">Explore</Link>
            </Button>
            <ThemeToggle />

            {/* Notification bell — only shown when wallet is connected */}
            {address && (
              <DropdownMenu
                onOpenChange={(open) => {
                  if (open && unreadCount > 0) markAllRead()
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label="Notifications"
                  >
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {initialLoading ? (
                    [0, 1, 2].map((i) => (
                      <div key={i} className="flex flex-col gap-1.5 px-3 py-2.5">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    ))
                  ) : notifications.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No notifications yet
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <DropdownMenuItem
                        key={n.id}
                        className="flex flex-col items-start gap-0.5 py-2.5"
                        asChild={!!n.pool_id}
                      >
                        {n.pool_id ? (
                          <Link
                            href={`/dashboard/group/${n.pool_id}`}
                            className="w-full cursor-pointer"
                          >
                            <span
                              className={`block text-sm leading-snug ${!n.read ? "font-medium" : "text-muted-foreground"}`}
                            >
                              {n.message}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatRelativeTime(new Date(n.created_at))}
                            </span>
                          </Link>
                        ) : (
                          <>
                            <span
                              className={`text-sm leading-snug ${!n.read ? "font-medium" : "text-muted-foreground"}`}
                            >
                              {n.message}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatRelativeTime(new Date(n.created_at))}
                            </span>
                          </>
                        )}
                      </DropdownMenuItem>
                    ))
                  )}
                  {!initialLoading && notifications.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        asChild
                        className="justify-center text-sm font-medium text-primary cursor-pointer"
                      >
                        <Link href="/dashboard/notifications">View all notifications</Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {address && recentPools.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Clock className="h-4 w-4" />
                    <span className="hidden sm:inline">Recent</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Recent Pools</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {recentPools.map((pool) => (
                    <DropdownMenuItem key={pool.contract_address || pool.id} asChild>
                      <Link
                        href={`/dashboard/group/${pool.id}`}
                        className="flex w-full cursor-pointer items-center justify-between gap-2"
                      >
                        <span className="flex-1 truncate text-sm">{pool.name}</span>
                        <span className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize">
                            {pool.type}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {formatRelativeTime(new Date(pool.visitedAt))}
                          </span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {address ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <span>{truncatedAddress}</span>
                    <ChevronDown className="h-4 w-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem className="cursor-default font-mono text-xs">
                    {address}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleCopyAddress}>
                    {copied ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {copied ? "Copied" : "Copy Address"}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full cursor-pointer items-center"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View on Explorer
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDisconnect} variant="destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    Disconnect Wallet
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild variant="outline">
                <Link href="/">Back to Home</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
