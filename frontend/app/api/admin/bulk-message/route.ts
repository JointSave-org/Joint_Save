import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"
import { CHAT_MESSAGE_MAX_LENGTH } from "@/lib/constants"

export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const body = await req.json()
    const { poolIds, wallet, message } = body

    if (!poolIds || !Array.isArray(poolIds) || poolIds.length === 0) {
      return NextResponse.json({ error: "poolIds array is required" }, { status: 400 })
    }

    if (!wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 })
    }

    if (!message || message.trim().length === 0) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    if (message.length > CHAT_MESSAGE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Message exceeds ${CHAT_MESSAGE_MAX_LENGTH} character limit` },
        { status: 422 }
      )
    }

    const admin = getAdminClient()

    // Verify the wallet is the creator of all requested pools
    const { data: pools, error: poolsError } = await admin
      .from("pools")
      .select("id, creator_address")
      .in("id", poolIds)

    if (poolsError) throw poolsError

    const unauthorized = pools?.filter(
      (p) => p.creator_address.toLowerCase() !== wallet.toLowerCase()
    )
    if (unauthorized && unauthorized.length > 0) {
      return NextResponse.json(
        { error: "Not authorized to send messages to one or more pools" },
        { status: 403 }
      )
    }

    // Send message to each pool's chat
    const results = await Promise.allSettled(
      poolIds.map(async (poolId: string) => {
        const { error } = await admin.from("pool_messages").insert({
          pool_id: poolId,
          sender_address: wallet.toLowerCase(),
          message: message.trim(),
        })
        if (error) throw error
        return poolId
      })
    )

    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    return NextResponse.json({
      success: true,
      sent: succeeded,
      failed,
      total: poolIds.length,
    })
  } catch (error) {
    console.error("Bulk message error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send messages" },
      { status: 500 }
    )
  }
}
