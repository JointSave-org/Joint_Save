"use client"

import { useCallback, useRef, useState } from "react"
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Transaction,
  nativeToScVal,
} from "@stellar/stellar-sdk"
import { useStellar, STELLAR_NETWORK_PASSPHRASE } from "@/components/web3-provider"
import {
  fetchRotationalState,
  fetchIsPaused,
  getRpc,
  submitContractTx,
} from "@/hooks/useJointSaveContracts"
import { TX_TIMEOUT } from "@/lib/constants"
import {
  chunk,
  computeProgress,
  describeSplit,
  sortByUrgency,
  type BatchDepositItem,
  type BatchDepositPool,
  type BatchItemStatus,
} from "@/lib/batch-deposit"

/**
 * Batch deposits across every rotational pool that still owes a contribution
 * this round.
 *
 * ── One transaction per pool, on purpose ────────────────────────────────────
 * Soroban permits a single `InvokeHostFunction` operation per transaction, so
 * N pool deposits are N transactions — they cannot be fused into one atomic
 * multi-operation transaction the way classic Stellar payments can. What is
 * batched here is the *workflow*: one place to see what is owed, one selection,
 * one run. Signing is serialized through the app-wide tx-queue (`enqueueSign`)
 * so the wallet shows one prompt at a time rather than N racing popups.
 *
 * The upside of independent transactions is that a partial failure is
 * recoverable: confirmed deposits stay confirmed and `retryFailed()` re-runs
 * only the pools that did not go through.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** The subset of the `/api/pools` row this feature reads. */
interface MemberPoolRecord {
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: string
  contract_address: string | null
  contribution_amount: number | null
  token_symbol: string | null
}

/** One planned deposit: the pool, plus a thunk that builds its transaction. */
export interface PlannedDeposit {
  pool: BatchDepositPool
  /**
   * Builds the unsigned deposit transaction for this pool.
   *
   * Deferred rather than pre-built because every Soroban transaction consumes
   * the source account's next sequence number. Building at submit time — after
   * the previous deposit has settled — means a skipped or failed deposit can
   * never leave the rest of the run holding invalid sequence numbers.
   */
  buildTx: () => Promise<Transaction>
}

export interface BatchDepositPlan {
  /** Planned deposits split into runs of at most `MAX_TX_PER_BATCH`. */
  batches: PlannedDeposit[][]
  /** Total transactions the run will submit. */
  totalTransactions: number
  /** Set when the selection is split across more than one batch. */
  splitMessage: string | null
}

export interface BatchDepositResult {
  confirmed: string[]
  failed: string[]
  cancelled: string[]
}

/** Stellar contract ids are `C` followed by 55 base32 characters. */
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/

/** How many pools are inspected concurrently when scanning for what's owed. */
const SCAN_CONCURRENCY = 4

function isDeployed(address: string | null | undefined): address is string {
  return !!address && CONTRACT_ADDRESS_RE.test(address.toUpperCase())
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === "string" ? err : "Unknown error"
}

/** Best-effort activity log so the deposit shows up in the Transactions tab. */
async function logDepositActivity(pool: BatchDepositPool, address: string, txHash: string) {
  try {
    await fetch(`/api/pools?id=${pool.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: pool.id,
        activity: {
          activity_type: "deposit",
          user_address: address,
          amount: pool.amount || null,
          tx_hash: txHash,
        },
      }),
    })
  } catch {
    // A failed log must never fail the deposit — the transaction is on-chain.
  }
}

/** Build the unsigned `deposit(member)` transaction for one rotational pool. */
export async function buildDepositTransaction(
  contractAddress: string,
  memberAddress: string
): Promise<Transaction> {
  const account = await getRpc().getAccount(memberAddress)
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(contractAddress.toUpperCase()).call(
        "deposit",
        nativeToScVal(memberAddress.toUpperCase(), { type: "address" })
      )
    )
    .setTimeout(TX_TIMEOUT)
    .build()
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBatchDeposit() {
  const { address, kit } = useStellar()

  const [pools, setPools] = useState<BatchDepositPool[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [hasScanned, setHasScanned] = useState(false)

  const [items, setItems] = useState<BatchDepositItem[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  /** Flipped by `cancel()`; checked between transactions, never mid-flight. */
  const cancelledRef = useRef(false)

  const setItemStatus = useCallback(
    (poolId: string, status: BatchItemStatus, extra: Partial<BatchDepositItem> = {}) => {
      setItems((prev) =>
        prev.map((item) => (item.pool.id === poolId ? { ...item, status, ...extra } : item))
      )
    },
    []
  )

  /**
   * Every rotational pool where `wallet` is a member and `has_deposited` is
   * false for the current round. Paused and inactive pools are excluded — a
   * deposit to either is guaranteed to fail on-chain.
   */
  const getPoolsRequiringDeposit = useCallback(
    async (wallet: string): Promise<BatchDepositPool[]> => {
      const res = await fetch(`/api/pools?member=${encodeURIComponent(wallet.toLowerCase())}`)
      if (!res.ok) throw new Error("Failed to load your pools")

      const json = await res.json()
      const records: MemberPoolRecord[] = Array.isArray(json) ? json : (json.data ?? [])

      const candidates = records.filter(
        (p) => p.type === "rotational" && p.status !== "completed" && isDeployed(p.contract_address)
      )

      const owed: BatchDepositPool[] = []

      for (let i = 0; i < candidates.length; i += SCAN_CONCURRENCY) {
        const slice = candidates.slice(i, i + SCAN_CONCURRENCY)
        const results = await Promise.all(
          slice.map(async (record) => {
            const contractAddress = record.contract_address as string
            try {
              const [state, paused] = await Promise.all([
                fetchRotationalState(contractAddress, wallet),
                fetchIsPaused(contractAddress),
              ])

              if (!state.isActive || paused || state.hasDeposited) return null

              const isMember = state.members.some((m) => m.toUpperCase() === wallet.toUpperCase())
              if (!isMember) return null

              return {
                id: record.id,
                name: record.name,
                contractAddress,
                amount: record.contribution_amount ?? 0,
                tokenSymbol: record.token_symbol || "XLM",
                round: state.currentRound,
                deadline: state.nextPayoutTime > 0 ? state.nextPayoutTime * 1000 : null,
              } satisfies BatchDepositPool
            } catch {
              // A pool whose state can't be read is skipped rather than
              // failing the whole scan — the others are still actionable.
              return null
            }
          })
        )
        owed.push(...results.filter((p): p is BatchDepositPool => p !== null))
      }

      return sortByUrgency(owed)
    },
    []
  )

  /** Run the scan and store the result on the hook. */
  const refresh = useCallback(async () => {
    if (!address) {
      setPools([])
      setHasScanned(true)
      return
    }
    setIsScanning(true)
    setScanError(null)
    try {
      setPools(await getPoolsRequiringDeposit(address))
    } catch (err) {
      setScanError(errorMessage(err))
      setPools([])
    } finally {
      setIsScanning(false)
      setHasScanned(true)
    }
  }, [address, getPoolsRequiringDeposit])

  /**
   * Plan the run: one transaction builder per selected pool, chunked into
   * batches of at most `MAX_TX_PER_BATCH`.
   */
  const buildBatchDepositTx = useCallback(
    (selected: BatchDepositPool[]): BatchDepositPlan => {
      if (!address) throw new Error("Wallet not connected")

      const planned: PlannedDeposit[] = selected.map((pool) => ({
        pool,
        buildTx: () => buildDepositTransaction(pool.contractAddress, address),
      }))

      const batches = chunk(planned)
      return {
        batches,
        totalTransactions: planned.length,
        splitMessage: describeSplit(batches.length),
      }
    },
    [address]
  )

  /**
   * Sign and submit each planned deposit in order, reporting per-pool status
   * as it goes. Resolves once every deposit has reached a terminal state.
   *
   * `retain` keeps earlier results (used by `retryFailed`, so deposits that
   * already confirmed stay on screen while the failed ones are re-attempted).
   */
  const submitBatchDeposit = useCallback(
    async (
      plan: BatchDepositPlan,
      retain: BatchDepositItem[] = []
    ): Promise<BatchDepositResult> => {
      if (!address || !kit) throw new Error("Wallet not connected")

      const ordered = plan.batches.flat()
      cancelledRef.current = false
      setItems([...retain, ...ordered.map(({ pool }) => ({ pool, status: "pending" as const }))])
      setIsSubmitting(true)

      const result: BatchDepositResult = { confirmed: [], failed: [], cancelled: [] }

      try {
        for (const { pool, buildTx } of ordered) {
          if (cancelledRef.current) {
            setItemStatus(pool.id, "cancelled")
            result.cancelled.push(pool.id)
            continue
          }

          try {
            const tx = await buildTx()
            const txHash = await submitContractTx(tx, {
              pendingTx: {
                address,
                type: "deposit",
                poolId: pool.contractAddress,
                amount: pool.amount ? String(pool.amount) : undefined,
              },
              onPhase: (phase, hash) => {
                if (phase === "signing") setItemStatus(pool.id, "signing")
                else if (phase === "submitted")
                  setItemStatus(pool.id, "submitted", { txHash: hash })
              },
            })

            setItemStatus(pool.id, "confirmed", { txHash, error: undefined })
            result.confirmed.push(pool.id)
            await logDepositActivity(pool, address, txHash)
          } catch (err) {
            setItemStatus(pool.id, "failed", { error: errorMessage(err) })
            result.failed.push(pool.id)
          }
        }
      } finally {
        setIsSubmitting(false)
        cancelledRef.current = false
      }

      return result
    },
    [address, kit, setItemStatus]
  )

  /**
   * Re-run only the deposits that failed or were cancelled. Confirmed deposits
   * are already on-chain and are never re-submitted.
   */
  const retryFailed = useCallback(async (): Promise<BatchDepositResult | null> => {
    const retryable = items.filter((i) => i.status === "failed" || i.status === "cancelled")
    if (retryable.length === 0) return null

    const succeeded = items.filter((i) => i.status === "confirmed")
    const plan = buildBatchDepositTx(retryable.map((i) => i.pool))
    return submitBatchDeposit(plan, succeeded)
  }, [items, buildBatchDepositTx, submitBatchDeposit])

  /** Stop before the next transaction; the in-flight one is left to settle. */
  const cancel = useCallback(() => {
    cancelledRef.current = true
  }, [])

  /** Clear the run so the panel returns to its selection state. */
  const reset = useCallback(() => {
    setItems([])
  }, [])

  return {
    // Pools requiring a deposit
    pools,
    isScanning,
    scanError,
    hasScanned,
    refresh,
    getPoolsRequiringDeposit,

    // Planning & submission
    buildBatchDepositTx,
    submitBatchDeposit,
    retryFailed,
    cancel,
    reset,

    // Run state
    items,
    isSubmitting,
    progress: computeProgress(items),
  }
}
