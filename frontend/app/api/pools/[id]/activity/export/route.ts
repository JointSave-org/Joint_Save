/**
 * GET /api/pools/[id]/activity/export — downloadable export of a pool's
 * activity history (issue #210).
 *
 * Accepts the same filter params as /activity (search, date_from, date_to,
 * activity_type, sort — page is ignored) plus `format=csv|json` (default csv)
 * and a required `wallet` param. Rate limited to EXPORT_RATE_LIMIT (5) exports
 * per hour per wallet.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { exportLimiter } from "@/lib/rate-limit"
import { ACTIVITY_EXPORT_MAX_ROWS } from "@/lib/constants"
import {
  ACTIVITY_CSV_HEADERS,
  ACTIVITY_SELECT_COLUMNS,
  activityToCsvRow,
  buildSearchOrClause,
  exportFilename,
  isActivityQueryError,
  parseActivityQuery,
  type ActivityExportRow,
} from "@/lib/activity-query"
import { buildCsv } from "@/lib/csv-export"

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sp = req.nextUrl.searchParams

  // Wallet first: the limiter keys off it, so an anonymous caller must not be
  // able to consume (or dodge) another key's export budget.
  const wallet = sp.get("wallet")
  if (!wallet) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 })
  }

  const limited = exportLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  const format = sp.get("format") ?? "csv"
  if (format !== "csv" && format !== "json") {
    return NextResponse.json({ error: "format must be 'csv' or 'json'" }, { status: 400 })
  }

  const query = parseActivityQuery({
    search: sp.get("search"),
    date_from: sp.get("date_from"),
    date_to: sp.get("date_to"),
    activity_type: sp.get("activity_type"),
    sort: sp.get("sort"),
    // Exports always cover all matching records, not a page.
    page: null,
  })
  if (isActivityQueryError(query)) {
    return NextResponse.json({ error: query.error }, { status: 400 })
  }

  try {
    let q = getAdminClient().from("pool_activity").select(ACTIVITY_SELECT_COLUMNS).eq("pool_id", id)

    if (query.search) {
      const orClause = buildSearchOrClause(query.search)
      if (orClause) q = q.or(orClause)
    }
    if (query.activityType) q = q.eq("activity_type", query.activityType)
    if (query.dateFromIso) q = q.gte("created_at", query.dateFromIso)
    if (query.dateToExclusiveIso) q = q.lt("created_at", query.dateToExclusiveIso)

    const { data, error } = await q
      .order("created_at", { ascending: query.ascending })
      .limit(ACTIVITY_EXPORT_MAX_ROWS)

    if (error) throw error

    const rows = (data ?? []) as unknown as ActivityExportRow[]
    const filename = exportFilename(id, format, new Date())

    if (format === "json") {
      return new NextResponse(JSON.stringify(rows, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      })
    }

    const csv = buildCsv(ACTIVITY_CSV_HEADERS, rows.map(activityToCsvRow))
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error("Activity export error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export activity" },
      { status: 500 }
    )
  }
}
