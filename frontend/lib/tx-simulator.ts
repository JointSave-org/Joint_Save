/**
 * Transaction simulation engine.
 *
 * Wraps the Stellar Soroban RPC `simulateTransaction` endpoint with a
 * short-lived in-memory cache (keyed by XDR hash, 30 s TTL) and a
 * configurable timeout so the UI can show a preview before signing.
 */

import type { Transaction } from "@stellar/stellar-sdk"
import { rpc } from "@stellar/stellar-sdk"
import { getRpc } from "@/hooks/useJointSaveContracts"
import { SIMULATION_CACHE_TTL_MS, SIMULATION_TIMEOUT_MS } from "@/lib/constants"
import { mapContractError, type ContractErrorCode } from "@/lib/contract-errors"

// ── Types ────────────────────────────────────────────────────────────────────

export interface SimulationCost {
  /** Soroban resource fee in stroops (already converted). */
  feeStroops: number
  /** Estimated CPU instructions consumed. */
  cpuInstructions: number
  /** Estimated persistent/read/write ledger entries. */
  readEntries: number
  writeEntries: number
}

export interface SimulationOutcome {
  /** Whether the simulation indicates the transaction would succeed. */
  success: boolean
  /** Raw error string from the contract (if failed). */
  error?: string
  /** Typed error code for UI mapping (if failed with known contract error). */
  errorKey?: ContractErrorCode
  /** Friendly error message suitable for display. */
  friendlyMessage?: string
  /** Estimated resource cost (only present on success). */
  cost?: SimulationCost
  /** Whether the RPC endpoint was unreachable (graceful degradation). */
  unavailable?: boolean
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  outcome: SimulationOutcome
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

function hashXdr(xdr: string): string {
  // Simple djb2 hash — fast, no crypto dependency.
  let hash = 5381
  for (let i = 0; i < xdr.length; i++) {
    hash = ((hash << 5) + hash + xdr.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

function getCached(xdr: string): SimulationOutcome | null {
  const entry = cache.get(hashXdr(xdr))
  if (!entry) return null
  if (Date.now() - entry.timestamp > SIMULATION_CACHE_TTL_MS) {
    cache.delete(hashXdr(xdr))
    return null
  }
  return entry.outcome
}

function setCache(xdr: string, outcome: SimulationOutcome): void {
  cache.set(hashXdr(xdr), { outcome, timestamp: Date.now() })
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Simulate a transaction against the Soroban RPC without submitting it.
 *
 * Returns a structured `SimulationOutcome` that the UI can render directly.
 * Results are cached for 30 seconds per unique XDR to avoid duplicate RPC
 * calls when the user re-triggers the same action.
 *
 * On network errors or timeouts the result is marked `unavailable: true`
 * so the caller can degrade gracefully (show a warning instead of blocking).
 */
export async function simulateTransaction(tx: Transaction): Promise<SimulationOutcome> {
  const xdr = tx.toXDR()

  const cached = getCached(xdr)
  if (cached) return cached

  let simResult: rpc.Api.SimulateTransactionResponse
  try {
    const server = getRpc()
    simResult = await Promise.race([
      server.simulateTransaction(tx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("simulation timeout")), SIMULATION_TIMEOUT_MS)
      ),
    ])
  } catch {
    const outcome: SimulationOutcome = {
      success: false,
      unavailable: true,
      error: "Network error",
      friendlyMessage: "Simulation unavailable. Transaction may fail on-chain.",
    }
    setCache(xdr, outcome)
    return outcome
  }

  if (rpc.Api.isSimulationError(simResult)) {
    const rawError = simResult.error
    const mapped = mapContractError(rawError)
    const outcome: SimulationOutcome = {
      success: false,
      error: rawError,
      errorKey: mapped.code,
      friendlyMessage: mapped.message,
    }
    setCache(xdr, outcome)
    return outcome
  }

  const successResult = simResult as rpc.Api.SimulateTransactionSuccessResponse
  const cost: SimulationCost = {
    feeStroops: parseInt(successResult.minResourceFee ?? "0", 10),
    cpuInstructions: 0,
    readEntries: 0,
    writeEntries: 0,
  }

  const outcome: SimulationOutcome = { success: true, cost }
  setCache(xdr, outcome)
  return outcome
}

/**
 * Convert a stroop fee to a human-readable XLM string.
 * 1 XLM = 10_000_000 stroops.
 */
export function stroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(7)
}
