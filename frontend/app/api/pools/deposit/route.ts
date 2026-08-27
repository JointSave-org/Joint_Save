import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { writeLimiter } from "@/lib/rate-limit"
import { normalizeDecimals, humanToBaseUnits, trimHumanAmount } from "@/lib/deposit-token"

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org"

/**
 * Verify a deposit transaction against Horizon before recording it as
 * complete in Supabase. Prevents off-chain activity rows for deposits that
 * never landed on-chain (e.g. lost confirmations, dropped transactions).
 *
 * POST { poolId, userAddress, txHash, amount?, tokenSymbol?, tokenDecimals? }
 *  - 200 { verified: true } — tx confirmed on-chain (and logged, unless the
 *    hash was already recorded).
 *  - 200 { verified: true, alreadyLogged: true } — previously recorded.
 *  - 422 { verified: false } — tx not found on Horizon or failed on-chain.
 *  - 502 — Horizon unreachable (caller should not mark the deposit complete).
 *
 * Multi-token (SEP-41) support: when `tokenSymbol`/`tokenDecimals` are
 * supplied, the activity row records a `token_amount` (the human deposit
 * amount denominated in that token) alongside the existing numeric `amount`.
 * `tokenDecimals` defaults to 7 (native XLM / SAC-wrapped assets); callers
 * pass a different value for custom tokens. `tokenAmount` is interpreted as a
 * human amount and converted to base units only for validation — the stored
 * value stays in human units for display consistency with `token_amount`.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const body = await req.json()
    const { poolId, userAddress, txHash, amount, tokenSymbol, tokenDecimals, tokenAmount } = body

    if (!poolId || !userAddress || !txHash) {
      return NextResponse.json(
        { error: "Missing required fields: poolId, userAddress, txHash" },
        { status: 400 }
      )
    }

    // 1. Verify the transaction exists and succeeded on Horizon.
    let tx: { successful?: boolean }
    try {
      const res = await fetch(`${HORIZON_URL}/transactions/${txHash}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
      if (res.status === 404) {
        return NextResponse.json(
          { verified: false, error: "Transaction not found on the network" },
          { status: 422 }
        )
      }
      if (!res.ok) {
        return NextResponse.json(
          { verified: false, error: "Horizon unavailable — deposit not recorded" },
          { status: 502 }
        )
      }
      tx = (await res.json()) as { successful?: boolean }
    } catch {
      return NextResponse.json(
        { verified: false, error: "Horizon unavailable — deposit not recorded" },
        { status: 502 }
      )
    }

    if (!tx.successful) {
      return NextResponse.json(
        { verified: false, error: "Transaction failed on-chain" },
        { status: 422 }
      )
    }

    // 2. Idempotency: never record the same tx hash twice.
    const { data: existing } = await supabase
      .from("pool_activity")
      .select("id")
      .eq("tx_hash", txHash)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ verified: true, alreadyLogged: true })
    }

    // 3. Resolve the per-token amount so the activity row can be broken out
    //    by currency (issue #255). `tokenAmount` is a human number; we keep
    //    it in human units for `token_amount`, but validate it converts to a
    //    whole number of base units at the given decimals (rejecting values
    //    with more precision than the asset supports).
    const decimals = normalizeDecimals(tokenDecimals)
    const tokenAmountHuman =
      tokenAmount !== undefined && tokenAmount !== null
        ? trimHumanAmount(String(tokenAmount))
        : undefined
    let tokenBaseUnits: bigint | null = null
    if (tokenAmountHuman !== undefined) {
      tokenBaseUnits = humanToBaseUnits(tokenAmountHuman, decimals)
      if (tokenBaseUnits === null) {
        return NextResponse.json(
          {
            error: `tokenAmount has more precision than ${tokenSymbol ?? "asset"} supports (max ${decimals} decimals)`,
          },
          { status: 400 }
        )
      }
    }

    // 4. Mark the deposit complete in Supabase.
    const { error } = await supabase.from("pool_activity").insert([
      {
        pool_id: poolId,
        activity_type: "deposit",
        user_address: userAddress.toLowerCase(),
        amount: typeof amount === "number" ? amount : null,
        token_amount: tokenAmountHuman !== undefined ? Number(tokenAmountHuman) : null,
        tx_hash: txHash,
        description:
          tokenSymbol && tokenSymbol !== "XLM"
            ? `Deposit transaction (${tokenSymbol})`
            : "Deposit transaction",
      },
    ])

    if (error) {
      console.error("Deposit activity log error:", error)
      return NextResponse.json({ error: "Failed to record deposit" }, { status: 500 })
    }

    return NextResponse.json({ verified: true })
  } catch (error) {
    console.error("Deposit verification error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
