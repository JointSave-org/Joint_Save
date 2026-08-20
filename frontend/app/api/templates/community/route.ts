import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { readLimiter } from "@/lib/rate-limit"
import { jsonPrivate } from "@/lib/cache-headers"
import { isTemplatePoolType } from "@/lib/templates"

const COMMUNITY_PAGE_SIZE = 12

/**
 * GET /api/templates/community?pool_type=X&sort=popular|recent&page=N
 * Public community feed of shared pool templates, optionally filtered by pool
 * type and ordered by popularity (use_count) or recency.
 */
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const poolType = req.nextUrl.searchParams.get("pool_type")
  const sort = req.nextUrl.searchParams.get("sort") || "popular"
  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get("page") || "0", 10))
  const from = page * COMMUNITY_PAGE_SIZE
  const to = from + COMMUNITY_PAGE_SIZE - 1

  try {
    const admin = getAdminClient()
    let query = admin.from("pool_templates").select("*", { count: "exact" }).eq("is_public", true)

    if (poolType) {
      if (!isTemplatePoolType(poolType)) {
        return NextResponse.json({ error: "Invalid pool_type" }, { status: 400 })
      }
      query = query.eq("pool_type", poolType)
    }

    const orderColumn = sort === "recent" ? "created_at" : "use_count"
    const { data, error, count } = await query
      .order(orderColumn, { ascending: false })
      .range(from, to)

    if (error) throw error
    return jsonPrivate({ data: data || [], total: count ?? 0, page, pageSize: COMMUNITY_PAGE_SIZE })
  } catch (error) {
    console.error("Template community fetch error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch templates" },
      { status: 500 }
    )
  }
}
