import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"

/**
 * POST /api/admin/actions
 * Logs an administrative action if the transaction hash hasn't been logged yet.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const body = await req.json()
    const { poolId, adminAddress, actionType, targetAddress, metadata, txHash } = body

    if (!poolId || !adminAddress || !actionType) {
      return NextResponse.json(
        { error: "Missing required fields: poolId, adminAddress, actionType" },
        { status: 400 }
      )
    }

    // De-duplication check: avoid double-logging a confirmed transaction
    if (txHash) {
      const { data: existing } = await supabase
        .from("admin_actions")
        .select("id")
        .eq("tx_hash", txHash)
        .maybeSingle()

      if (existing) {
        return NextResponse.json({ success: true, message: "Action already logged", id: existing.id })
      }
    }

    const { data, error } = await supabase
      .from("admin_actions")
      .insert({
        pool_id: poolId,
        admin_address: adminAddress.toLowerCase(),
        action_type: actionType,
        target_address: targetAddress ? targetAddress.toLowerCase() : null,
        metadata: metadata || {},
        tx_hash: txHash || null,
      })
      .select()
      .single()

    if (error) {
      // Handle race condition where two inserts for same tx_hash happen simultaneously
      if (error.code === "23505") {
        return NextResponse.json({ success: true, message: "Action already logged (race condition)" })
      }
      throw error
    }

    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    console.error("Failed to log admin action:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to log admin action" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/actions?poolId=<poolId>&callerAddress=<callerAddress>
 * Returns all admin actions for the given pool.
 * Only readable by the pool creator or any member of the pool.
 */
export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited

    const poolId = req.nextUrl.searchParams.get("poolId")
    if (!poolId) {
      return NextResponse.json({ error: "poolId is required" }, { status: 400 })
    }

    const callerAddress = req.nextUrl.searchParams.get("callerAddress")
    if (!callerAddress) {
      return NextResponse.json({ error: "callerAddress is required" }, { status: 400 })
    }

    const { data: pool, error: poolErr } = await supabase
      .from("pools")
      .select("id, creator_address")
      .eq("id", poolId)
      .single()

    if (poolErr || !pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 })
    }

    const isCreator = pool.creator_address.toLowerCase() === callerAddress.toLowerCase()

    const { data: member, error: memberErr } = await supabase
      .from("pool_members")
      .select("id")
      .eq("pool_id", poolId)
      .eq("member_address", callerAddress.toLowerCase())
      .maybeSingle()

    if (!isCreator && !member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: actions, error: actErr } = await supabase
      .from("admin_actions")
      .select("*")
      .eq("pool_id", poolId)
      .order("created_at", { ascending: false })

    if (actErr) {
      return NextResponse.json({ error: "Failed to fetch admin actions" }, { status: 500 })
    }

    return NextResponse.json({ actions: actions ?? [] })
  } catch (error) {
    console.error("Failed to fetch admin actions:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch admin actions" },
      { status: 500 }
    )
  }
}
