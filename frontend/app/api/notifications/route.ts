import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"

// GET /api/notifications?wallet=<address>
// GET /api/notifications?wallet=<address>&page=<n>  — paginated full history
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase()
  const limited = readLimiter(req)
  if (limited) return limited
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 })

  const pageParam = req.nextUrl.searchParams.get("page")

  // Paginated mode (used by /dashboard/notifications): returns
  // { data, total, page, pageSize } so the page can render the same
  // Pagination UI used by My Groups.
  if (pageParam !== null) {
    const PAGE_SIZE = 10
    const page = Math.max(0, parseInt(pageParam || "0", 10))
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const { data, error, count } = await getAdminClient()
      .from("notifications")
      .select("id, pool_id, activity_type, message, read, created_at", { count: "exact" })
      .eq("wallet_address", wallet)
      .order("created_at", { ascending: false })
      .range(from, to)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE })
  }

  // Default mode (used by the notification bell dropdown): most recent 10.
  const { data, error } = await getAdminClient()
    .from("notifications")
    .select("id, pool_id, activity_type, message, read, created_at")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/notifications  { wallet_address }  — mark all read
export async function POST(req: NextRequest) {
  const { wallet_address } = await req.json()
  const limited = writeLimiter(req)
  if (limited) return limited
  if (!wallet_address)
    return NextResponse.json({ error: "wallet_address required" }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (getAdminClient() as any)
    .from("notifications")
    .update({ read: true })
    .eq("wallet_address", wallet_address.toLowerCase())
    .eq("read", false)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
