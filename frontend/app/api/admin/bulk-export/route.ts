import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const body = await req.json()
    const { poolIds, wallet } = body

    if (!poolIds || !Array.isArray(poolIds) || poolIds.length === 0) {
      return NextResponse.json({ error: "poolIds array is required" }, { status: 400 })
    }

    if (!wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 })
    }

    const admin = getAdminClient()

    // Verify the wallet is the creator of all requested pools
    const { data: pools, error: poolsError } = await admin
      .from("pools")
      .select("id, name, creator_address")
      .in("id", poolIds)

    if (poolsError) throw poolsError

    const unauthorized = pools?.filter(
      (p) => p.creator_address.toLowerCase() !== wallet.toLowerCase()
    )
    if (unauthorized && unauthorized.length > 0) {
      return NextResponse.json(
        { error: "Not authorized to export data for one or more pools" },
        { status: 403 }
      )
    }

    // Fetch activity for all selected pools
    const { data: activities, error: actError } = await admin
      .from("pool_activity")
      .select("pool_id, activity_type, user_address, amount, token_amount, description, created_at, tx_hash")
      .in("pool_id", poolIds)
      .order("created_at", { ascending: false })
      .limit(5000)

    if (actError) throw actError

    // Build CSV
    const headers = [
      "Pool ID",
      "Pool Name",
      "Activity Type",
      "User Address",
      "Amount",
      "Token Amount",
      "Description",
      "TX Hash",
      "Timestamp",
    ]

    const poolMap = new Map((pools ?? []).map((p) => [p.id, p.name]))

    const rows = (activities ?? []).map((a) => [
      a.pool_id,
      poolMap.get(a.pool_id) ?? "",
      a.activity_type,
      a.user_address ?? "",
      a.amount?.toString() ?? "",
      a.token_amount?.toString() ?? "",
      a.description ?? "",
      a.tx_hash ?? "",
      a.created_at,
    ])

    // CSV generation inline (avoids importing csv-export which is client-side)
    function escapeCell(value: unknown): string {
      const str = value == null ? "" : String(value)
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const csvLines = [headers, ...rows].map((row) => row.map(escapeCell).join(","))
    const csv = csvLines.join("\n")

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv;charset=utf-8;",
        "Content-Disposition": `attachment; filename="jointsave-export-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error("Bulk export error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to export data" },
      { status: 500 }
    )
  }
}
