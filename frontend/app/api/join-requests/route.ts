import { supabase } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited
    const body = await req.json()
    const { poolId, requesterAddress } = body

    if (!poolId || !requesterAddress) {
      return NextResponse.json(
        { error: "poolId and requesterAddress are required" },
        { status: 400 }
      )
    }

    // Check if request already exists
    const { data: existing } = await supabase
      .from("join_requests")
      .select("id, status")
      .eq("pool_id", poolId)
      .eq("requester_address", requesterAddress.toLowerCase())
      .single()

    if (existing) {
      if (existing.status === "pending") {
        return NextResponse.json({ error: "Join request already pending" }, { status: 409 })
      }
      // Allow re-requesting if previously declined
      await supabase.from("join_requests").delete().eq("id", existing.id)
    }

    const { data, error } = await supabase
      .from("join_requests")
      .insert({
        pool_id: poolId,
        requester_address: requesterAddress.toLowerCase(),
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("Join request error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create join request" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited
    const poolId = req.nextUrl.searchParams.get("poolId")
    const requesterAddress = req.nextUrl.searchParams.get("requester")

    let query = supabase.from("join_requests").select("*")

    if (poolId) {
      query = query.eq("pool_id", poolId)
    }
    if (requesterAddress) {
      query = query.eq("requester_address", requesterAddress.toLowerCase())
    }

    const { data, error } = await query.order("created_at", { ascending: false })

    if (error) throw error

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Fetch join requests error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch join requests" },
      { status: 500 }
    )
  }
}
