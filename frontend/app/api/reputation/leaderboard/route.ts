import { NextRequest, NextResponse } from "next/server"
import { readLimiter } from "@/lib/rate-limit"
import {
  Address,
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  xdr,
  rpc,
} from "@stellar/stellar-sdk"

// ── Constants ─────────────────────────────────────────────────────────────────

const REPUTATION_ID = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID || ""
const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org"
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"

const MAX_TOP = 100
const DEFAULT_TOP = 10

// ── Soroban helpers (server-side, no wallet required) ─────────────────────────

function scValToU32(val?: xdr.ScVal): number {
  return val && val.switch().name === "scvU32" ? val.u32() : 0
}

function scValToU64(val?: xdr.ScVal): number {
  if (!val) return 0
  const name = val.switch().name
  if (name === "scvU64") return Number(val.u64().toBigInt())
  if (name === "scvU32") return val.u32()
  return 0
}

function structField(val: xdr.ScVal, field: string): xdr.ScVal | undefined {
  return val
    .map()
    ?.find((entry) => entry.key().sym().toString() === field)
    ?.val()
}

async function viewCall(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal> {
  const server = new rpc.Server(RPC_URL, { allowHttp: false })
  const DUMMY_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"
  const account = new Account(DUMMY_ACCOUNT, "0")
  const contract = new Contract(REPUTATION_ID)

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build()

  const result = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error: ${result.error}`)
  }
  const sim = result as rpc.Api.SimulateTransactionSuccessResponse
  if (!sim.result?.retval) throw new Error("No return value")
  return sim.result.retval
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  address: string
  totalScore: number
  depositReliability: number
  poolsCompleted: number
  poolsJoined: number
  totalDeposits: number
  missedDeposits: number
  lastActivity: number
  scoreUpdatedAt: number
  isProvisional: boolean
  rank: number
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/reputation/leaderboard?top=10
 *
 * Returns the top N members by reputation score, sorted descending.
 * Query params:
 *   top  — number of entries to return (default 10, max 100)
 */
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  if (!REPUTATION_ID) {
    return NextResponse.json({ error: "Reputation contract not configured" }, { status: 503 })
  }

  const topParam = req.nextUrl.searchParams.get("top")
  const topN = Math.min(
    MAX_TOP,
    Math.max(1, parseInt(topParam || String(DEFAULT_TOP), 10) || DEFAULT_TOP)
  )

  try {
    const topArg = nativeToScVal(topN, { type: "u32" })
    const resultVal = await viewCall("get_score_leaderboard", topArg)

    // Result is Vec<(Address, ReputationData)> serialized as ScVec of ScVec pairs
    const entries: LeaderboardEntry[] = []
    const vec = resultVal.vec() ?? []

    for (let i = 0; i < vec.length; i++) {
      const pair = vec[i]
      const pairVec = pair.vec()
      if (!pairVec || pairVec.length < 2) continue

      const addrVal = pairVec[0]
      const dataVal = pairVec[1]

      let address: string
      try {
        address = Address.fromScVal(addrVal).toString()
      } catch {
        continue
      }

      const totalDeposits = scValToU32(structField(dataVal, "total_deposits"))

      entries.push({
        address,
        totalScore: scValToU32(structField(dataVal, "total_score")),
        depositReliability: scValToU32(structField(dataVal, "deposit_reliability")),
        poolsCompleted: scValToU32(structField(dataVal, "pools_completed")),
        poolsJoined: scValToU32(structField(dataVal, "pools_joined")),
        totalDeposits,
        missedDeposits: scValToU32(structField(dataVal, "missed_deposits")),
        lastActivity: scValToU64(structField(dataVal, "last_activity")),
        scoreUpdatedAt: scValToU64(structField(dataVal, "score_updated_at")),
        isProvisional: totalDeposits < 10,
        rank: i + 1,
      })
    }

    return NextResponse.json({ data: entries, total: entries.length, topN })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch leaderboard"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
