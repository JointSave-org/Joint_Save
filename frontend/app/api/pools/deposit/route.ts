import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { writeLimiter } from "@/lib/rate-limit"
import { humanToBaseUnits } from "@/lib/deposit-token"

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org"

/**
 * Verify a deposit transaction against Horizon before recording it as
 * complete in Supabase. Prevents off-chain activity rows for deposits that
 * never landed on-chain (e.g. lost confirmations, dropped transactions).
 *
 * POST { poolId, userAddress, txHash, amount?, tokenSymbol?, tokenDecimals?,
 *        tokenAmount?, treasuryFeeBps?, relayerFeeBps? }
 *  - 200 { verified: true } — tx confirmed on-chain (and logged, unless the
 *    hash was already recorded).
 *  - 200 { verified: true, alreadyLogged: true } — previously recorded.
 *  - 422 { verified: false } — tx not found on Horizon, failed on-chain, or
 *    the token amount exceeds the asset's supported precision.
 *  - 502 — Horizon unreachable (caller should not mark the deposit complete).
 */
export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const body = await req.json()
    const {
      poolId,
      userAddress,
      txHash,
      amount,
      tokenSymbol,
      tokenDecimals,
      tokenAmount,
      treasuryFeeBps,
      relayerFeeBps,
    } = body

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

    // 1b. When a token-denominated amount is supplied, validate it against
    // the asset's supported precision before persisting it.
    let tokenAmountBase: bigint | null = null
    if (tokenAmount != null && tokenSymbol) {
      const decimals = typeof tokenDecimals === "number" ? tokenDecimals : 7
      try {
        tokenAmountBase = humanToBaseUnits(String(tokenAmount), decimals)
      } catch {
        return NextResponse.json(
          {
            verified: false,
            error: `Amount exceeds the ${decimals}-decimal precision for ${tokenSymbol}`,
          },
          { status: 422 }
        )
      }
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

    // 3. Mark the deposit complete in Supabase. `amount` always carries the
    // numeric value (settlement workspace), while `token_amount` keeps the
    // token-denominated amount so history can be broken out by currency.
    const feeBps =
      (typeof treasuryFeeBps === "number" ? treasuryFeeBps : 0) +
      (typeof relayerFeeBps === "number" ? relayerFeeBps : 0)

    // Fee (if any) computed in the token's own unit, in base units (stroops).
    let feeBase: bigint | null = null
    let tokenAmountValue: number | null = null
    if (tokenAmountBase != null) {
      tokenAmountValue = Number(tokenAmountBase)
      if (feeBps > 0) {
        feeBase = (tokenAmountBase * BigInt(feeBps) + 5000n) / 10000n
      }
    }

    const { error } = await supabase.from("pool_activity").insert([
      {
        pool_id: poolId,
        activity_type: "deposit",
        user_address: userAddress.toLowerCase(),
        amount: typeof amount === "number" ? amount : null,
        token_amount: tokenAmountValue,
        tx_hash: txHash,
        fee_charged: feeBase != null ? Number(feeBase) : null,
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
