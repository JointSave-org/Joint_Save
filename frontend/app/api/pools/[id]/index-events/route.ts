/**
 * POST /api/pools/[id]/index-events — on-chain event indexing (issue #210).
 *
 * Body: { wallet_address } — any pool member can trigger a run.
 *
 * Reads contract events from Soroban RPC since the pool's last indexed ledger,
 * enriches matching pool_activity rows with tx_hash / on_chain_timestamp /
 * block_number / fee_charged (block time and fee from Horizon), inserts rows
 * for on-chain events the database never recorded, backfills older rows that
 * have a tx_hash but no on-chain data yet, and advances event_index_log.
 *
 * Idempotent: re-running updates the same rows to the same values, and the
 * unique(pool_id) upsert keeps a single log row per pool.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"
import { fetchEventsSince, fetchHorizonTxBatch } from "@/lib/server/stellar-events"

/** How many un-enriched historical rows to backfill from Horizon per run. */
const BACKFILL_BATCH_SIZE = 25

async function isMember(poolId: string, wallet: string): Promise<boolean> {
  const { data } = await getAdminClient()
    .from("pool_members")
    .select("id")
    .eq("pool_id", poolId)
    .eq("member_address", wallet.toLowerCase())
    .maybeSingle()
  return data !== null
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let wallet: string
  try {
    const body = await req.json()
    wallet = typeof body?.wallet_address === "string" ? body.wallet_address.trim() : ""
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!wallet) {
    return NextResponse.json({ error: "wallet_address required" }, { status: 400 })
  }

  try {
    const admin = getAdminClient()

    // Any member may trigger indexing (server-enforced, mirrors pool chat).
    const member = await isMember(id, wallet)
    if (!member) {
      return NextResponse.json({ error: "Not a member of this pool" }, { status: 403 })
    }

    const { data: pool, error: poolErr } = await admin
      .from("pools")
      .select("id, contract_address")
      .eq("id", id)
      .maybeSingle()
    if (poolErr) throw poolErr
    if (!pool) {
      return NextResponse.json({ error: "Pool not found" }, { status: 404 })
    }
    const contractAddress = (pool as { contract_address?: string }).contract_address ?? ""
    if (!contractAddress || contractAddress === "pending_deployment") {
      return NextResponse.json({ error: "Pool contract not deployed yet" }, { status: 422 })
    }

    const { data: indexLog } = await admin
      .from("event_index_log")
      .select("last_indexed_ledger")
      .eq("pool_id", id)
      .maybeSingle()
    const startLedger = (indexLog?.last_indexed_ledger ?? 0) + 1

    // ── 1. Pull new events from the RPC and enrich via Horizon ───────────────
    const { events, latestLedger, warning } = await fetchEventsSince(contractAddress, startLedger)
    const horizonByHash = await fetchHorizonTxBatch(events.map((ev) => ev.tx_hash))

    let updated = 0
    let inserted = 0

    for (const ev of events) {
      const horizon = horizonByHash.get(ev.tx_hash) ?? null
      const enrichment = {
        on_chain_timestamp: horizon?.createdAt ?? ev.ledgerClosedAt,
        block_number: horizon?.ledger ?? ev.ledger,
        fee_charged: horizon?.feeCharged ?? null,
      }

      // Match the off-chain row logged for the same transaction. activity_type
      // disambiguates txs that emit several tracked events; fall back to
      // hash-only when the logged type doesn't line up with the topic map.
      const { data: byType } = await admin
        .from("pool_activity")
        .select("id")
        .eq("pool_id", id)
        .eq("tx_hash", ev.tx_hash)
        .eq("activity_type", ev.activity_type)
      let matches = byType ?? []
      if (matches.length === 0) {
        const { data: byHash } = await admin
          .from("pool_activity")
          .select("id")
          .eq("pool_id", id)
          .eq("tx_hash", ev.tx_hash)
        matches = byHash ?? []
      }

      if (matches.length > 0) {
        const { error: updErr } = await admin
          .from("pool_activity")
          .update(enrichment)
          .in(
            "id",
            matches.map((m) => m.id)
          )
        if (updErr) throw updErr
        updated += matches.length
      } else {
        const { error: insErr } = await admin.from("pool_activity").insert([
          {
            pool_id: id,
            activity_type: ev.activity_type,
            user_address: ev.user_address?.toLowerCase() ?? null,
            amount: ev.amount,
            description: `${ev.activity_type} (indexed from chain)`,
            tx_hash: ev.tx_hash,
            ...enrichment,
          },
        ])
        if (insErr) throw insErr
        inserted++
      }
    }

    // ── 2. Backfill older rows that have a tx_hash but no on-chain data ─────
    const { data: pending } = await admin
      .from("pool_activity")
      .select("id, tx_hash")
      .eq("pool_id", id)
      .not("tx_hash", "is", null)
      .is("on_chain_timestamp", null)
      .order("created_at", { ascending: false })
      .limit(BACKFILL_BATCH_SIZE)

    let backfilled = 0
    const pendingRows = (pending ?? []).filter((r) => r.tx_hash)
    const backfillInfo = await fetchHorizonTxBatch(pendingRows.map((r) => r.tx_hash as string))
    for (const row of pendingRows) {
      const info = backfillInfo.get(row.tx_hash as string)
      if (!info) continue // pruned/lagging history — retried on the next run
      const { error: bfErr } = await admin
        .from("pool_activity")
        .update({
          on_chain_timestamp: info.createdAt,
          block_number: info.ledger,
          fee_charged: info.feeCharged,
        })
        .eq("id", row.id)
      if (bfErr) throw bfErr
      backfilled++
    }

    // ── 3. Advance the index log ─────────────────────────────────────────────
    const indexedAt = new Date().toISOString()
    const newLastLedger = Math.max(latestLedger, indexLog?.last_indexed_ledger ?? 0)
    const { error: logErr } = await admin.from("event_index_log").upsert(
      {
        pool_id: id,
        last_indexed_ledger: newLastLedger,
        indexed_at: indexedAt,
      },
      { onConflict: "pool_id" }
    )
    if (logErr) throw logErr

    return NextResponse.json({
      eventsFound: events.length,
      updated,
      inserted,
      backfilled,
      lastIndexedLedger: newLastLedger,
      indexedAt,
      ...(warning ? { warning } : {}),
    })
  } catch (error) {
    console.error("Event indexing error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to index events" },
      { status: 500 }
    )
  }
}
