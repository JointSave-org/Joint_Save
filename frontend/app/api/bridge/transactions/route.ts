import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"
import { getCctpChainById } from "@/lib/cctp-bridge"

const VALID_STATUSES = ["pending", "attested", "received", "deposited", "failed"] as const

/**
 * GET /api/bridge/transactions?user=<addr>&id=<id>
 * Return bridge transactions for a user (optionally a single one by `id`);
 * used to resume progress across page refreshes.
 *
 * POST /api/bridge/transactions
 * Upsert a bridge transaction by its (client-generated) `id` — survive
 * refreshes and advance `status` as the attestation/deposit progresses.
 */
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const id = req.nextUrl.searchParams.get("id")
  const user = req.nextUrl.searchParams.get("user")

  try {
    if (id) {
      const { data, error } = await supabase
        .from("bridge_transactions")
        .select("*")
        .eq("id", id)
        .maybeSingle()
      if (error) throw error
      return NextResponse.json({ transaction: data ?? null })
    }

    if (!user) {
      return NextResponse.json({ error: "user is required" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("bridge_transactions")
      .select("*")
      .eq("user_address", user.toLowerCase())
      .order("created_at", { ascending: false })
    if (error) throw error
    return NextResponse.json({ transactions: data ?? [] })
  } catch (error) {
    console.error("Failed to fetch bridge transactions:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  try {
    const body = await req.json()
    const {
      id,
      userAddress,
      sourceChain,
      amountBaseUnits,
      status,
      sourceTxHash,
      messageHash,
      redemptionTxHash,
      poolId,
      error,
    } = body

    if (!id || !userAddress || !sourceChain) {
      return NextResponse.json(
        { error: "Missing required fields: id, userAddress, sourceChain" },
        { status: 400 }
      )
    }
    if (!getCctpChainById(sourceChain)) {
      return NextResponse.json({ error: `Unknown source chain: ${sourceChain}` }, { status: 400 })
    }
    const nextStatus = VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])
      ? (status as string)
      : "pending"

    const amount =
      typeof amountBaseUnits === "bigint"
        ? amountBaseUnits.toString()
        : typeof amountBaseUnits === "number"
          ? BigInt(Math.round(amountBaseUnits)).toString()
          : typeof amountBaseUnits === "string" && /^\d+$/.test(amountBaseUnits)
            ? amountBaseUnits
            : null

    const payload = {
      id,
      user_address: userAddress.toLowerCase(),
      source_chain: sourceChain,
      amount_base_units: amount,
      status: nextStatus,
      source_tx_hash: sourceTxHash || null,
      message_hash: messageHash || null,
      redemption_tx_hash: redemptionTxHash || null,
      pool_id: poolId || null,
      error: error || null,
      updated_at: new Date().toISOString(),
    }

    const { data, error: upsertError } = await supabase
      .from("bridge_transactions")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single()

    if (upsertError) {
      console.error("Failed to save bridge transaction:", upsertError)
      return NextResponse.json({ error: "Failed to save bridge transaction" }, { status: 500 })
    }
    return NextResponse.json({ transaction: data }, { status: 201 })
  } catch (error) {
    console.error("Failed to save bridge transaction:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save" },
      { status: 500 }
    )
  }
}
