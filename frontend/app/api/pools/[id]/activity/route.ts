/**
 * GET /api/pools/[id]/activity — filterable, paginated pool activity feed
 * (issue #210).
 *
 * Query params:
 *   search        — case-insensitive match over activity_type, description,
 *                   user_address, tx_hash
 *   date_from     — YYYY-MM-DD, inclusive
 *   date_to       — YYYY-MM-DD, inclusive of the whole day
 *   activity_type — one of ACTIVITY_TYPES
 *   sort          — "newest" (default) | "oldest"
 *   page          — 1-based, ACTIVITY_PAGE_SIZE rows per page
 *
 * Rows are public reads (same as the pool_activity SELECT RLS policy and the
 * embedded feed in GET /api/pools?id=). The response also carries the pool's
 * indexing state from event_index_log so the UI can show "Last indexed".
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { readLimiter } from "@/lib/rate-limit"
import { ACTIVITY_PAGE_SIZE } from "@/lib/constants"
import {
  ACTIVITY_SELECT_COLUMNS,
  buildSearchOrClause,
  isActivityQueryError,
  parseActivityQuery,
} from "@/lib/activity-query"

/** Supabase error code for a .range() that starts past the last row. */
const PGRST_RANGE_NOT_SATISFIABLE = "PGRST103"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = readLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params
  const sp = req.nextUrl.searchParams
  const query = parseActivityQuery({
    search: sp.get("search"),
    date_from: sp.get("date_from"),
    date_to: sp.get("date_to"),
    activity_type: sp.get("activity_type"),
    sort: sp.get("sort"),
    page: sp.get("page"),
  })
  if (isActivityQueryError(query)) {
    return NextResponse.json({ error: query.error }, { status: 400 })
  }

  try {
    const admin = getAdminClient()

    let q = admin
      .from("pool_activity")
      .select(ACTIVITY_SELECT_COLUMNS, { count: "exact" })
      .eq("pool_id", id)

    if (query.search) {
      const orClause = buildSearchOrClause(query.search)
      if (orClause) q = q.or(orClause)
    }
    if (query.activityType) q = q.eq("activity_type", query.activityType)
    if (query.dateFromIso) q = q.gte("created_at", query.dateFromIso)
    if (query.dateToExclusiveIso) q = q.lt("created_at", query.dateToExclusiveIso)

    const [activityRes, indexLogRes] = await Promise.all([
      q
        .order("created_at", { ascending: query.ascending })
        .range(query.rangeFrom, query.rangeTo),
      admin
        .from("event_index_log")
        .select("last_indexed_ledger, indexed_at")
        .eq("pool_id", id)
        .maybeSingle(),
    ])

    // A page past the end of the result set is an empty page, not an error.
    if (activityRes.error && activityRes.error.code !== PGRST_RANGE_NOT_SATISFIABLE) {
      throw activityRes.error
    }

    const total = activityRes.count ?? 0
    const activities = activityRes.data ?? []

    return NextResponse.json({
      activities,
      page: query.page,
      pageSize: ACTIVITY_PAGE_SIZE,
      total,
      hasMore: query.rangeFrom + activities.length < total,
      lastIndexed: indexLogRes.data
        ? {
            ledger: indexLogRes.data.last_indexed_ledger,
            indexedAt: indexLogRes.data.indexed_at,
          }
        : null,
    })
  } catch (error) {
    console.error("Activity fetch error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load activity" },
      { status: 500 }
    )
  }
}
