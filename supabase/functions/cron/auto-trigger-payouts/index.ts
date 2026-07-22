// Supabase Edge Function: cron/auto-trigger-payouts
//
// Scheduled via pg_cron every 15 minutes (see
// supabase/migrations/20260722120100_schedule_auto_trigger_payouts.sql).
// Finds active rotational pools whose on-chain round deadline has passed and
// submits `trigger_payout` on their behalf, signed by a dedicated relayer
// keypair, so rounds don't stall waiting for a human to notice and click the
// button.
//
// Required env vars (Edge Function secrets — never plaintext env vars):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - auto-injected by Supabase
//   RELAYER_SECRET_KEY                      - Stellar secret key (S...) for the
//                                              relayer account. Set via:
//                                                supabase secrets set RELAYER_SECRET_KEY=...
//                                              See supabase/README.md for how
//                                              to generate and fund it.
// Optional env vars:
//   STELLAR_RPC_URL             - defaults to the public testnet RPC
//   STELLAR_HORIZON_URL         - defaults to the public testnet Horizon
//   STELLAR_NETWORK_PASSPHRASE  - defaults to the testnet passphrase
//   MAX_TRIGGERS_PER_RUN        - defaults to 10 (relayer fee-saturation guard)
//   MIN_RELAYER_BALANCE_XLM     - defaults to 10 (low-balance warning threshold)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import {
  Account,
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  rpc,
} from "https://esm.sh/@stellar/stellar-sdk@15.0.1?target=deno"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const RELAYER_SECRET_KEY = Deno.env.get("RELAYER_SECRET_KEY") ?? ""
const STELLAR_RPC_URL = Deno.env.get("STELLAR_RPC_URL") ?? "https://soroban-testnet.stellar.org"
const STELLAR_HORIZON_URL =
  Deno.env.get("STELLAR_HORIZON_URL") ?? "https://horizon-testnet.stellar.org"
const STELLAR_NETWORK_PASSPHRASE =
  Deno.env.get("STELLAR_NETWORK_PASSPHRASE") ?? "Test SDF Network ; September 2015"
const MAX_TRIGGERS_PER_RUN = Number(Deno.env.get("MAX_TRIGGERS_PER_RUN") ?? "10")
const MIN_RELAYER_BALANCE_XLM = Number(Deno.env.get("MIN_RELAYER_BALANCE_XLM") ?? "10")

const JOB_NAME = "auto-trigger-payouts"
const TX_TIMEOUT = 300
// Cron runs every 15 minutes, so these backoff windows are enforced across
// runs (a "retry" row's next_retry_at gates re-attempts), not via in-process
// sleeps — an Edge Function invocation can't block for 15 minutes.
const RETRY_BACKOFF_MINUTES = [1, 5, 15]
const MAX_RETRIES = RETRY_BACKOFF_MINUTES.length
// Placeholder read-only account used only to build simulation transactions —
// never funded, never signs anything. Same technique the frontend's
// `viewCall` helper uses for on-chain reads.
const DUMMY_READ_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface RotationalPool {
  id: string
  contract_address: string
}

interface RetryState {
  status: "success" | "failed" | "retry" | "warning"
  retry_count: number
  next_retry_at: string | null
  created_at: string
}

interface CronLogFields {
  pool_id?: string | null
  status: "success" | "failed" | "retry" | "warning"
  error_message?: string | null
  tx_hash?: string | null
  retry_count?: number
  next_retry_at?: string | null
}

const normalizeId = (id: string) => id.toUpperCase()
const addressVal = (addr: string) => nativeToScVal(addr.toUpperCase(), { type: "address" })

// deno-lint-ignore no-explicit-any
function scValToBigInt(val: any): bigint {
  const name = val.switch().name
  if (name === "scvU64") return BigInt(val.u64().toString())
  if (name === "scvI64") return BigInt(val.i64().toString())
  return 0n
}

async function logCronEvent(fields: CronLogFields): Promise<void> {
  const { error } = await sb.from("cron_job_logs").insert({
    job_name: JOB_NAME,
    pool_id: fields.pool_id ?? null,
    status: fields.status,
    error_message: fields.error_message ?? null,
    tx_hash: fields.tx_hash ?? null,
    retry_count: fields.retry_count ?? 0,
    next_retry_at: fields.next_retry_at ?? null,
  })
  if (error) console.error("Failed to write cron_job_logs row:", error)
}

async function getRetryState(poolId: string): Promise<RetryState | null> {
  const { data, error } = await sb
    .from("cron_job_logs")
    .select("status, retry_count, next_retry_at, created_at")
    .eq("job_name", JOB_NAME)
    .eq("pool_id", poolId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as RetryState | null
}

async function getRelayerXlmBalance(publicKey: string): Promise<number> {
  const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${publicKey}`)
  if (!res.ok) throw new Error(`Horizon account lookup failed: ${res.status}`)
  const data = await res.json()
  const balances = (data.balances ?? []) as { asset_type: string; balance: string }[]
  const native = balances.find((b) => b.asset_type === "native")
  return native ? parseFloat(native.balance) : 0
}

/** Fire-and-forget read call — no signing, no fee. Mirrors the frontend's viewCall. */
// deno-lint-ignore no-explicit-any
async function viewCall(server: any, contractId: string, method: string): Promise<any> {
  const dummyAccount = new Account(DUMMY_READ_ACCOUNT, "0")
  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(normalizeId(contractId)).call(method))
    .setTimeout(TX_TIMEOUT)
    .build()

  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`View call failed (${method}): ${sim.error}`)
  }
  return sim.result.retval
}

interface DueState {
  isActive: boolean
  isPaused: boolean
  nextPayoutTime: number
}

// deno-lint-ignore no-explicit-any
async function fetchDueState(server: any, contractId: string): Promise<DueState> {
  const [activeVal, pausedVal, payoutVal] = await Promise.all([
    viewCall(server, contractId, "is_active"),
    viewCall(server, contractId, "is_paused"),
    viewCall(server, contractId, "next_payout_time"),
  ])
  return {
    isActive: activeVal.switch().name === "scvBool" ? activeVal.b() : false,
    isPaused: pausedVal.switch().name === "scvBool" ? pausedVal.b() : false,
    nextPayoutTime: Number(scValToBigInt(payoutVal)),
  }
}

/** Simulate → assemble → sign with the relayer keypair → send → poll. Returns tx hash. */
async function submitTriggerPayout(
  // deno-lint-ignore no-explicit-any
  server: any,
  // deno-lint-ignore no-explicit-any
  relayerKeypair: any,
  contractId: string
): Promise<string> {
  const relayerPublicKey = relayerKeypair.publicKey()
  const account = await server.getAccount(relayerPublicKey)

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(normalizeId(contractId)).call("trigger_payout", addressVal(relayerPublicKey))
    )
    .setTimeout(TX_TIMEOUT)
    .build()

  const simResult = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`)
  }

  const prepared = rpc.assembleTransaction(tx, simResult).build()
  prepared.sign(relayerKeypair)

  const sendResult = await server.sendTransaction(prepared)
  if (sendResult.status === "ERROR") {
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`)
  }

  let getResult = await server.getTransaction(sendResult.hash)
  let attempts = 0
  while (getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
    await new Promise((r) => setTimeout(r, 1500))
    getResult = await server.getTransaction(sendResult.hash)
    attempts++
  }

  if (getResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction did not succeed on-chain (status: ${getResult.status})`)
  }

  return sendResult.hash
}

interface ProcessOutcome {
  attempted: boolean
  skipped?: string
}

async function processPool(
  // deno-lint-ignore no-explicit-any
  server: any,
  // deno-lint-ignore no-explicit-any
  relayerKeypair: any,
  pool: RotationalPool
): Promise<ProcessOutcome> {
  const retryState = await getRetryState(pool.id)
  let attemptNumber = 0
  if (retryState?.status === "retry") {
    if (retryState.next_retry_at && new Date(retryState.next_retry_at) > new Date()) {
      return { attempted: false, skipped: "backoff" }
    }
    attemptNumber = retryState.retry_count
  }

  let state: DueState
  try {
    state = await fetchDueState(server, pool.contract_address)
  } catch (err) {
    await logCronEvent({
      pool_id: pool.id,
      status: "failed",
      error_message: `Failed to read on-chain state: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { attempted: false, skipped: "state_read_error" }
  }

  if (!state.isActive || state.isPaused) {
    return { attempted: false, skipped: "inactive_or_paused" }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  if (state.nextPayoutTime === 0 || nowSec < state.nextPayoutTime) {
    return { attempted: false, skipped: "not_due" }
  }

  try {
    const txHash = await submitTriggerPayout(server, relayerKeypair, pool.contract_address)
    const relayerPublicKey = relayerKeypair.publicKey()

    await Promise.all([
      sb.from("pool_activity").insert({
        pool_id: pool.id,
        activity_type: "payout",
        user_address: relayerPublicKey,
        tx_hash: txHash,
        description: "Auto-triggered payout by scheduled relayer (auto_trigger_payout)",
      }),
      sb.from("admin_actions").insert({
        pool_id: pool.id,
        admin_address: relayerPublicKey,
        action_type: "auto_trigger_payout",
        tx_hash: txHash,
        metadata: { job_name: JOB_NAME, source: "cron" },
      }),
      logCronEvent({ pool_id: pool.id, status: "success", tx_hash: txHash, retry_count: 0 }),
    ])

    return { attempted: true }
  } catch (err) {
    const nextAttempt = attemptNumber + 1
    const message = err instanceof Error ? err.message : String(err)

    if (nextAttempt > MAX_RETRIES) {
      await logCronEvent({
        pool_id: pool.id,
        status: "failed",
        error_message: message,
        retry_count: nextAttempt,
      })
    } else {
      const backoffMin = RETRY_BACKOFF_MINUTES[nextAttempt - 1]
      const nextRetryAt = new Date(Date.now() + backoffMin * 60_000)
      await logCronEvent({
        pool_id: pool.id,
        status: "retry",
        error_message: message,
        retry_count: nextAttempt,
        next_retry_at: nextRetryAt.toISOString(),
      })
    }
    return { attempted: true }
  }
}

serve(async () => {
  if (!RELAYER_SECRET_KEY) {
    console.error("RELAYER_SECRET_KEY is not configured")
    await logCronEvent({ status: "failed", error_message: "RELAYER_SECRET_KEY not configured" })
    return new Response("relayer not configured", { status: 500 })
  }

  const relayerKeypair = Keypair.fromSecret(RELAYER_SECRET_KEY)
  const server = new rpc.Server(STELLAR_RPC_URL)

  try {
    const balance = await getRelayerXlmBalance(relayerKeypair.publicKey())
    if (balance < MIN_RELAYER_BALANCE_XLM) {
      await logCronEvent({
        status: "warning",
        error_message: `Relayer balance low: ${balance} XLM (threshold ${MIN_RELAYER_BALANCE_XLM} XLM)`,
      })
    }
  } catch (err) {
    console.error("Relayer balance check failed:", err)
  }

  try {
    const { data: pools, error } = await sb
      .from("pools")
      .select("id, contract_address")
      .eq("type", "rotational")
      .eq("status", "active")
      .not("contract_address", "is", null)
      .neq("contract_address", "pending_deployment")

    if (error) throw error

    let triggered = 0
    let rateLimited = 0
    const errors: string[] = []

    for (const pool of (pools ?? []) as RotationalPool[]) {
      if (triggered >= MAX_TRIGGERS_PER_RUN) {
        rateLimited++
        continue
      }
      try {
        const outcome = await processPool(server, relayerKeypair, pool)
        if (outcome.attempted) triggered++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`${pool.id}: ${message}`)
        await logCronEvent({ pool_id: pool.id, status: "failed", error_message: message })
      }
    }

    if (rateLimited > 0) {
      console.warn(`Rate limit hit: ${rateLimited} due pool(s) deferred to the next run`)
    }

    await logCronEvent({ status: "success" })

    return new Response(
      JSON.stringify({
        ok: true,
        checked_pools: (pools ?? []).length,
        triggered,
        deferred_rate_limit: rateLimited,
        errors,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("auto-trigger-payouts error:", err)
    await logCronEvent({ status: "failed", error_message: message })
    return new Response("internal error", { status: 500 })
  }
})
