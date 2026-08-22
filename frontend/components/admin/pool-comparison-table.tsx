"use client"

import { useState, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminPoolData } from "@/app/api/admin/pools/route"
import { formatRelativeTime } from "@/lib/utils"
import Link from "next/link"

type SortKey =
  | "name"
  | "type"
  | "total_saved"
  | "members_count"
  | "health_score"
  | "status"
  | "updated_at"

type SortDirection = "asc" | "desc"

const BAND_BADGE: Record<string, string> = {
  healthy: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  fair: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  "at-risk": "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  new: "bg-muted text-muted-foreground border-border",
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDirection,
  onSort,
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  currentDirection: SortDirection
  onSort: (key: SortKey) => void
}) {
  const isActive = currentSort === sortKey
  const Icon = isActive
    ? currentDirection === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown

  return (
    <TableHead
      className="cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <Icon
          className={cn("h-3.5 w-3.5", isActive ? "text-foreground" : "text-muted-foreground/50")}
        />
      </div>
    </TableHead>
  )
}

export function PoolComparisonTable({ pools }: { pools: AdminPoolData[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("health_score")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDirection(key === "name" || key === "type" || key === "status" ? "asc" : "desc")
    }
  }

  const sorted = useMemo(() => {
    return [...pools].sort((a, b) => {
      let aVal: number | string
      let bVal: number | string

      switch (sortKey) {
        case "name":
          aVal = a.name.toLowerCase()
          bVal = b.name.toLowerCase()
          break
        case "type":
          aVal = a.type
          bVal = b.type
          break
        case "total_saved":
          aVal = a.total_saved
          bVal = b.total_saved
          break
        case "members_count":
          aVal = a.pool_members?.length ?? a.members_count
          bVal = b.pool_members?.length ?? b.members_count
          break
        case "health_score":
          aVal = a.health_score
          bVal = b.health_score
          break
        case "status":
          aVal = a.status
          bVal = b.status
          break
        case "updated_at":
          aVal = new Date(a.updated_at).getTime()
          bVal = new Date(b.updated_at).getTime()
          break
        default:
          return 0
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })
  }, [pools, sortKey, sortDirection])

  if (pools.length === 0) return null

  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader label="Pool Name" sortKey="name" currentSort={sortKey} currentDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Type" sortKey="type" currentSort={sortKey} currentDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="TVL" sortKey="total_saved" currentSort={sortKey} currentDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Members" sortKey="members_count" currentSort={sortKey} currentDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Health" sortKey="health_score" currentSort={sortKey} currentDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Status" sortKey="status" currentSort={sortKey} currentDirection={sortDirection} onSort={handleSort} />
            <SortableHeader label="Last Activity" sortKey="updated_at" currentSort={sortKey} currentDirection={sortDirection} onSort={handleSort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((pool) => (
            <TableRow key={pool.id}>
              <TableCell>
                <Link href={`/dashboard/group/${pool.id}`} className="font-medium hover:underline">
                  {pool.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="capitalize text-xs">
                  {pool.type}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">
                {pool.total_saved} {pool.token_symbol}
              </TableCell>
              <TableCell className="text-sm">
                {pool.pool_members?.length ?? pool.members_count}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={cn("text-xs", BAND_BADGE[pool.health_band])}>
                  {pool.health_band === "new" ? "New" : `${pool.health_score}%`}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize text-xs">
                  {pool.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatRelativeTime(new Date(pool.updated_at))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
