/**
 * Server-only Stellar helpers for the on-chain event indexer
 * (POST /api/pools/[id]/index-events, issue #210).
 *
 * Lives under lib/server/ because it must never be imported from client code —
 * the client equivalents in hooks/useJointSaveContracts.ts drag in wallet-kit
 * and React, which cannot load in a route handler.
 */

import { rpc } from "@stellar/stellar-sdk"
import { mapSorobanEvent, type MappedSorobanEvent } from "@/lib/soroban-event-mapping"

const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL
const HORIZON_URL = process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL

/** How many events to request per getEvents page (RPC max is 10000, be modest). */
const EVENTS_PAGE_LIMIT = 100
/** Safety valve: never pull more than this many pages in one indexing run. */
const MAX_EVENT_PAGES = 20
/**
 * Fallback clamp when the requested startLedger predates the RPC's retention
 * window and the error message doesn't tell us the oldest available ledger.
 * ~100k ledgers ≈ 7 days at ~6s per ledger, matching typical RPC retention.
 */
const RETENTION_FALLBACK_LEDGERS = 100_000

export function getServerRpc(): rpc.Server {
  if (!RPC_URL) throw new Error("NEXT_PUBLIC_STELLAR_RPC_URL is not configured")
  return new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") })
}

export interface FetchEventsResult {
  events: MappedSorobanEvent[]
  /** Latest ledger known to the RPC — becomes the new last_indexed_ledger. */
  latestLedger: number
  /** Set when the requested range was clamped or could not be read. */
  warning?: string
}

interface GetEventsPage {
  events: unknown[]
  latestLedger: number
  cursor?: string
}

async function getEventsPage(
  server: rpc.Server,
  contractId: string,
  startLedger: number | undefined,
  cursor: string | undefined
): Promise<GetEventsPage> {
  const response = await server.getEvents({
    // getEvents takes either startLedger or cursor, never both.
    ...(cursor ? { cursor } : { startLedger: startLedger ?? 1 }),
    filters: [{ type: "contract", contractIds: [contractId] }],
    limit: EVENTS_PAGE_LIMIT,
  } as Parameters<rpc.Server["getEvents"]>[0])
  return {
    events: response.events,
    latestLedger: response.latestLedger,
    cursor: (response as unknown as { cursor?: string }).cursor,
  }
}

/**
 * Read every trackable contract event for `contractId` from `startLedger`
 * onward, cursor-paginating past the per-request event cap.
 *
 * Never throws for range problems: when `startLedger` predates the RPC's
 * retention window the range is clamped (parsed from the error when possible)
 * and retried once; if events still can't be read, an empty result with a
 * `warning` is returned so one flaky RPC call doesn't fail the whole indexing
 * request.
 */
export async function fetchEventsSince(
  contractId: string,
  startLedger: number
): Promise<FetchEventsResult> {
  const server = getServerRpc()
  const events: MappedSorobanEvent[] = []
  let latestLedger = 0
  let warning: string | undefined
  let cursor: string | undefined
  let start: number | undefined = Math.max(1, startLedger)

  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    let result: GetEventsPage
    try {
      result = await getEventsPage(server, contractId, start, cursor)
    } catch (err) {
      if (page > 0) {
        // Mid-pagination failure: keep what we have.
        warning = `Event pagination stopped early: ${(err as Error)?.message ?? "unknown error"}`
        break
      }
      // First request failed — likely a startLedger outside the retention
      // window. Clamp and retry once.
      const clamped = await clampStartLedger(server, err, start ?? 1)
      if (clamped === null) {
        return {
          events: [],
          latestLedger: await safeLatestLedger(server),
          warning: `Could not read events: ${(err as Error)?.message ?? "unknown error"}`,
        }
      }
      warning = `Requested ledger range was outside the RPC retention window; indexed from ledger ${clamped} instead`
      try {
        result = await getEventsPage(server, contractId, clamped, undefined)
      } catch (retryErr) {
        return {
          events: [],
          latestLedger: await safeLatestLedger(server),
          warning: `Could not read events: ${(retryErr as Error)?.message ?? "unknown error"}`,
        }
      }
    }

    latestLedger = result.latestLedger || latestLedger
    for (const ev of result.events) {
      const mapped = mapSorobanEvent(ev as Parameters<typeof mapSorobanEvent>[0])
      if (mapped) events.push(mapped)
    }

    if (result.events.length < EVENTS_PAGE_LIMIT || !result.cursor) break
    cursor = result.cursor
    start = undefined
  }

  return { events, latestLedger, warning }
}

/**
 * Work out a usable startLedger after a range error. RPC errors of the form
 * "startLedger must be within the ledger range: 123456 - 223456" carry the
 * oldest retained ledger — use it when present, otherwise back off to
 * latest - RETENTION_FALLBACK_LEDGERS. Returns null when no clamp would help
 * (e.g. network failure).
 */
async function clampStartLedger(
  server: rpc.Server,
  err: unknown,
  requested: number
): Promise<number | null> {
  const message = (err as Error)?.message ?? ""
  const rangeMatch = message.match(/(\d{2,})\s*-\s*(\d{2,})/)
  if (rangeMatch) {
    const oldest = parseInt(rangeMatch[1], 10)
    if (Number.isFinite(oldest) && oldest > requested) return oldest
  }
  if (!/ledger|range/i.test(message)) return null
  try {
    const latest = await server.getLatestLedger()
    return Math.max(1, latest.sequence - RETENTION_FALLBACK_LEDGERS)
  } catch {
    return null
  }
}

async function safeLatestLedger(server: rpc.Server): Promise<number> {
  try {
    return (await server.getLatestLedger()).sequence
  } catch {
    return 0
  }
}

// ── Horizon enrichment ────────────────────────────────────────────────────────

export interface HorizonTxInfo {
  /** Ledger sequence the transaction was included in. */
  ledger: number
  /** Ledger close time (ISO). */
  createdAt: string
  /** Fee actually charged, in stroops. */
  feeCharged: number
}

/**
 * Fetch a transaction's on-chain details from Horizon.
 * Returns null on 404 or any failure — Horizon history can lag or be pruned,
 * and a missing transaction must never abort an indexing run.
 */
export async function fetchHorizonTx(txHash: string): Promise<HorizonTxInfo | null> {
  if (!HORIZON_URL) return null
  try {
    const res = await fetch(`${HORIZON_URL.replace(/\/$/, "")}/transactions/${txHash}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) return null
    const tx = (await res.json()) as {
      ledger?: number
      created_at?: string
      fee_charged?: string | number
    }
    if (tx.ledger == null || !tx.created_at) return null
    return {
      ledger: tx.ledger,
      createdAt: tx.created_at,
      feeCharged: Number(tx.fee_charged ?? 0),
    }
  } catch {
    return null
  }
}

/** Enrich many tx hashes with small parallelism so Horizon isn't hammered. */
export async function fetchHorizonTxBatch(
  txHashes: string[],
  chunkSize = 5
): Promise<Map<string, HorizonTxInfo>> {
  const out = new Map<string, HorizonTxInfo>()
  const unique = Array.from(new Set(txHashes))
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const results = await Promise.all(chunk.map((h) => fetchHorizonTx(h)))
    results.forEach((info, idx) => {
      if (info) out.set(chunk[idx], info)
    })
  }
  return out
}
