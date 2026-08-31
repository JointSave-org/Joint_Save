import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { writeLimiter } from "@/lib/rate-limit"

const isValidTokenId = (id: string) => id === "native" || /^C[A-Z2-7]{55}$/.test(id)

/**
 * POST /api/pools/tokens
 * Persist a pool's supported-token allowlist in Supabase so the deposit UI
 * knows which SEP-41 assets to offer. Mirrors the contract's
 * `set_supported_tokens` (replace semantics); the on-chain call is made
 * separately by the wallet (via `useSetSupportedTokens`).
 *
 * Admin-only: the caller must be the pool creator. When the on-chain tx has
 * already been broadcast, pass `txHash` so the row is marked atomically.
 *
 * Body: { poolId, callerAddress, supportedTokens: string[], txHash? }
 */
export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const body = await req.json()
    const { poolId, callerAddress, supportedTokens, txHash } = body

    if (!poolId || !callerAddress || !Array.isArray(supportedTokens)) {
      return NextResponse.json(
        { error: "Missing required fields: poolId, callerAddress, supportedTokens" },
        { status: 400 }
      )
    }

    // Validate every token id is "native" or a well-formed C… contract id.
    const invalid = supportedTokens.find((t) => typeof t !== "string" || !isValidTokenId(t))
    if (invalid) {
      return NextResponse.json({ error: `Invalid token id: ${String(invalid)}` }, { status: 400 })
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
    if (!isCreator) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { error: updateErr } = await supabase
      .from("pools")
      .update({ supported_tokens: supportedTokens })
      .eq("id", poolId)

    if (updateErr) {
      console.error("Failed to persist supported tokens:", updateErr)
      return NextResponse.json({ error: "Failed to save supported tokens" }, { status: 500 })
    }

    // Record the admin action for the audit trail.
    if (txHash) {
      await supabase.from("admin_actions").insert({
        pool_id: poolId,
        admin_address: callerAddress.toLowerCase(),
        action_type: "set_supported_tokens",
        metadata: { supportedTokens, tokenCount: supportedTokens.length },
        tx_hash: txHash || null,
      })
    }

    return NextResponse.json({ success: true, supportedTokens })
  } catch (error) {
    console.error("Failed to update supported tokens:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
