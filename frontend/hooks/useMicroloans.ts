"use client"

/**
 * useMicroloans — React hook for the JointSave P2P microloan contract.
 *
 * Provides:
 *  - Loan data fetching (pool loans, member loans, single loan)
 *  - Mutations: createLoanRequest, acceptLoan, repayLoan,
 *               cancelLoanRequest, defaultLoan
 *  - Loading / error state for each operation
 *  - Reputation side-effect awareness (default –200, repay +10)
 *
 * All contract interactions are performed via the Stellar SDK using the
 * same pattern as useJointSaveContracts.ts.
 */

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  rpc,
} from "@stellar/stellar-sdk"
import { useStellar, STELLAR_RPC_URL, STELLAR_NETWORK_PASSPHRASE } from "@/components/web3-provider"
import { enqueueSign } from "@/lib/tx-queue"
import { toastManager } from "@/lib/toast"
import { TX_TIMEOUT } from "@/lib/constants"

// ── Contract configuration ────────────────────────────────────────────────────

const MICROLOAN_CONTRACT_ID = process.env.NEXT_PUBLIC_MICROLOAN_CONTRACT_ID || ""
const MICROLOAN_CONFIGURED = !!MICROLOAN_CONTRACT_ID

// ── Types ─────────────────────────────────────────────────────────────────────

export type LoanStatus = "Pending" | "Active" | "Repaid" | "Defaulted" | "Cancelled"

export interface Loan {
  id: string
  lender: string | null
  borrower: string
  amount: bigint
  interestRateBps: number
  termDays: number
  dueDate: number
  status: LoanStatus
  repaidAmount: bigint
  poolId: string
  createdAt: number
  updatedAt: number
}

export interface CreateLoanParams {
  poolId: string
  amount: bigint
  interestRateBps: number
  termDays: number
  poolMembers: string[]
}

export interface AcceptLoanParams {
  loanId: string
  tokenAddress: string
  poolMembers: string[]
}

export interface RepayLoanParams {
  loanId: string
  repayAmount: bigint
  tokenAddress: string
}

// ── ScVal helpers (mirrors patterns in useJointSaveContracts.ts) ──────────────

function addressVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal()
}

function bytesN32Val(hexId: string): xdr.ScVal {
  // Loan IDs come back as 32-byte hex strings
  const bytes = Buffer.from(hexId, "hex")
  return xdr.ScVal.scvBytes(bytes)
}

function i128Val(val: bigint): xdr.ScVal {
  return nativeToScVal(val, { type: "i128" })
}

function u32Val(val: number): xdr.ScVal {
  return nativeToScVal(val, { type: "u32" })
}

function u64Val(val: bigint): xdr.ScVal {
  return nativeToScVal(val, { type: "u64" })
}

function vecAddressVal(env_: unknown, addrs: string[]): xdr.ScVal {
  return xdr.ScVal.scvVec(addrs.map((a) => addressVal(a)))
}

// ── ScVal decoders ────────────────────────────────────────────────────────────

function decodeOptionalAddress(scVal: xdr.ScVal): string | null {
  try {
    if (scVal.switch() === xdr.ScValType.scvVoid()) return null
    // Option<Address> is encoded as a Vec with one element or empty
    if (scVal.switch() === xdr.ScValType.scvVec()) {
      const vec = scVal.vec()
      if (!vec || vec.length === 0) return null
      return Address.fromScVal(vec[0]).toString()
    }
    return Address.fromScVal(scVal).toString()
  } catch {
    return null
  }
}

function decodeLoanStatus(scVal: xdr.ScVal): LoanStatus {
  try {
    // Enum variants are encoded as ScvVec([discriminant_u32, ...]) or ScvMap
    const arm = scVal.switch().name
    if (arm === "scvVec") {
      const vec = scVal.vec()!
      const discriminant = vec[0].u32()
      const statuses: LoanStatus[] = ["Pending", "Active", "Repaid", "Defaulted", "Cancelled"]
      return statuses[discriminant] ?? "Pending"
    }
    // Fallback: try name matching
    if (arm.includes("Pending")) return "Pending"
    if (arm.includes("Active")) return "Active"
    if (arm.includes("Repaid")) return "Repaid"
    if (arm.includes("Defaulted")) return "Defaulted"
    if (arm.includes("Cancelled")) return "Cancelled"
  } catch {}
  return "Pending"
}

function decodeLoan(scVal: xdr.ScVal): Loan {
  try {
    // Struct fields come back as ScvMap with string keys
    const map = scVal.map()!
    const get = (key: string): xdr.ScVal | undefined =>
      map
        .find((entry) => {
          try {
            return entry.key().sym() === key || entry.key().str()?.toString() === key
          } catch {
            return false
          }
        })
        ?.val()

    const idVal = get("id")
    const id = idVal ? Buffer.from(idVal.bytes()).toString("hex") : ""

    const lenderVal = get("lender")
    const lender = lenderVal ? decodeOptionalAddress(lenderVal) : null

    const borrowerVal = get("borrower")
    const borrower = borrowerVal ? Address.fromScVal(borrowerVal).toString() : ""

    const amountVal = get("amount")
    const amount = amountVal ? BigInt(amountVal.i128().toString()) : 0n

    const rateBpsVal = get("interest_rate_bps")
    const interestRateBps = rateBpsVal ? rateBpsVal.u32() : 0

    const termVal = get("term_days")
    const termDays = termVal ? Number(termVal.u64().toString()) : 0

    const dueDateVal = get("due_date")
    const dueDate = dueDateVal ? Number(dueDateVal.u64().toString()) : 0

    const statusVal = get("status")
    const status = statusVal ? decodeLoanStatus(statusVal) : "Pending"

    const repaidVal = get("repaid_amount")
    const repaidAmount = repaidVal ? BigInt(repaidVal.i128().toString()) : 0n

    const poolIdVal = get("pool_id")
    const poolId = poolIdVal ? Address.fromScVal(poolIdVal).toString() : ""

    const createdAtVal = get("created_at")
    const createdAt = createdAtVal ? Number(createdAtVal.u64().toString()) : 0

    const updatedAtVal = get("updated_at")
    const updatedAt = updatedAtVal ? Number(updatedAtVal.u64().toString()) : 0

    return {
      id,
      lender,
      borrower,
      amount,
      interestRateBps,
      termDays,
      dueDate,
      status,
      repaidAmount,
      poolId,
      createdAt,
      updatedAt,
    }
  } catch {
    throw new Error("Failed to decode Loan from ScVal")
  }
}

function decodeLoanIdList(scVal: xdr.ScVal): string[] {
  try {
    const vec = scVal.vec()!
    return vec.map((v) => Buffer.from(v.bytes()).toString("hex"))
  } catch {
    return []
  }
}

// ── RPC helpers ───────────────────────────────────────────────────────────────

async function submitTransaction(
  server: rpc.Server,
  walletAddress: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  kitSignFn: (xdr: string) => Promise<string>
): Promise<string> {
  const account = await server.getAccount(walletAddress)
  const contract = new Contract(contractId)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build()

  const simResult = await server.simulateTransaction(tx)
  if (!rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error(`Simulation failed: ${JSON.stringify(simResult)}`)
  }

  const preparedTx = rpc.assembleTransaction(tx, simResult).build()
  const signedXdr = await enqueueSign(preparedTx.toXDR(), kitSignFn)
  const signedTx = TransactionBuilder.fromXDR(signedXdr, STELLAR_NETWORK_PASSPHRASE)

  const sendResult = await server.sendTransaction(signedTx)
  if (sendResult.status === "ERROR") {
    throw new Error(`Send failed: ${sendResult.errorResult?.toXDR("base64")}`)
  }

  // Poll for completion
  let attempts = 0
  while (attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000))
    const status = await server.getTransaction(sendResult.hash)
    if (status.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return sendResult.hash
    }
    if (status.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error("Transaction failed on-chain")
    }
    attempts++
  }
  throw new Error("Transaction confirmation timed out")
}

// ── View call helper ──────────────────────────────────────────────────────────

async function viewCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  walletAddress?: string
): Promise<xdr.ScVal> {
  const server = new rpc.Server(STELLAR_RPC_URL)
  const fakeAddress = walletAddress ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"
  const account = await server.getAccount(fakeAddress)
  const contract = new Contract(contractId)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`View call failed: ${method}`)
  }
  return sim.result.retval
}

// ── Main hook ─────────────────────────────────────────────────────────────────

interface UseMicroloansResult {
  /** All pending/active loan requests for the pool */
  poolLoans: Loan[]
  /** Loans the current user is involved in (as borrower or lender) */
  myLoans: Loan[]
  isLoading: boolean
  isMutating: boolean
  error: string | null
  /** Create a new pending loan request */
  createLoanRequest: (params: CreateLoanParams) => Promise<string | null>
  /** Accept a pending loan request as lender */
  acceptLoan: (params: AcceptLoanParams) => Promise<boolean>
  /** Repay part or all of an active loan */
  repayLoan: (params: RepayLoanParams) => Promise<boolean>
  /** Cancel a pending loan request */
  cancelLoanRequest: (loanId: string) => Promise<boolean>
  /** Admin: mark an overdue loan as defaulted */
  defaultLoan: (loanId: string) => Promise<boolean>
  /** Manually refresh loan data */
  refetch: () => Promise<void>
}

export function useMicroloans(poolId: string | null | undefined): UseMicroloansResult {
  const t = useTranslations("lending.hook")
  const { address, kit } = useStellar()

  const [poolLoans, setPoolLoans] = useState<Loan[]>([])
  const [myLoans, setMyLoans] = useState<Loan[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Data fetching ───────────────────────────────────────────────────────

  const fetchLoans = useCallback(async () => {
    if (!poolId || !MICROLOAN_CONFIGURED) return

    setIsLoading(true)
    setError(null)

    try {
      // Fetch all pool loan IDs
      const poolLoanIdsVal = await viewCall(
        MICROLOAN_CONTRACT_ID,
        "get_pool_loans",
        [addressVal(poolId)],
        address ?? undefined
      )
      const poolLoanIds = decodeLoanIdList(poolLoanIdsVal)

      // Fetch individual loan records in parallel
      const loanResults = await Promise.allSettled(
        poolLoanIds.map((id) =>
          viewCall(MICROLOAN_CONTRACT_ID, "get_loan", [bytesN32Val(id)], address ?? undefined).then(
            decodeLoan
          )
        )
      )
      const loans = loanResults
        .filter((r): r is PromiseFulfilledResult<Loan> => r.status === "fulfilled")
        .map((r) => r.value)
      setPoolLoans(loans)

      // Filter to current user's loans
      if (address) {
        const mine = loans.filter(
          (l) =>
            l.borrower.toLowerCase() === address.toLowerCase() ||
            l.lender?.toLowerCase() === address.toLowerCase()
        )
        setMyLoans(mine)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("loadFailed")
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }, [poolId, address, t])

  useEffect(() => {
    fetchLoans()
  }, [fetchLoans])

  // ── Mutation helpers ────────────────────────────────────────────────────

  const kitSign = useCallback(
    async (xdrStr: string): Promise<string> => {
      if (!kit) throw new Error(t("walletNotConnected"))
      const { signedTxXdr } = await kit.signTransaction(xdrStr, {
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
      return signedTxXdr
    },
    [kit, t]
  )

  // ── createLoanRequest ───────────────────────────────────────────────────

  const createLoanRequest = useCallback(
    async (params: CreateLoanParams): Promise<string | null> => {
      if (!address || !MICROLOAN_CONFIGURED) {
        toastManager.error(t("walletNotConfigured"))
        return null
      }
      setIsMutating(true)
      try {
        const server = new rpc.Server(STELLAR_RPC_URL)
        const txHash = await submitTransaction(
          server,
          address,
          MICROLOAN_CONTRACT_ID,
          "create_loan_request",
          [
            addressVal(params.poolId),
            addressVal(address),
            i128Val(params.amount),
            u32Val(params.interestRateBps),
            u64Val(BigInt(params.termDays)),
            vecAddressVal(null, params.poolMembers),
          ],
          kitSign
        )
        toastManager.success(t("requestCreated"), 5000, txHash)
        await fetchLoans()
        return txHash
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("createFailed")
        toastManager.error(msg)
        return null
      } finally {
        setIsMutating(false)
      }
    },
    [address, kitSign, fetchLoans, t]
  )

  // ── acceptLoan ──────────────────────────────────────────────────────────

  const acceptLoan = useCallback(
    async (params: AcceptLoanParams): Promise<boolean> => {
      if (!address || !MICROLOAN_CONFIGURED) {
        toastManager.error(t("walletNotConfigured"))
        return false
      }
      setIsMutating(true)
      try {
        const server = new rpc.Server(STELLAR_RPC_URL)
        const txHash = await submitTransaction(
          server,
          address,
          MICROLOAN_CONTRACT_ID,
          "accept_loan",
          [
            bytesN32Val(params.loanId),
            addressVal(address),
            addressVal(params.tokenAddress),
            vecAddressVal(null, params.poolMembers),
          ],
          kitSign
        )
        toastManager.success(t("loanAccepted"), 5000, txHash)
        await fetchLoans()
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("acceptFailed")
        toastManager.error(msg)
        return false
      } finally {
        setIsMutating(false)
      }
    },
    [address, kitSign, fetchLoans, t]
  )

  // ── repayLoan ───────────────────────────────────────────────────────────

  const repayLoan = useCallback(
    async (params: RepayLoanParams): Promise<boolean> => {
      if (!address || !MICROLOAN_CONFIGURED) {
        toastManager.error(t("walletNotConfigured"))
        return false
      }
      setIsMutating(true)
      try {
        const server = new rpc.Server(STELLAR_RPC_URL)
        const txHash = await submitTransaction(
          server,
          address,
          MICROLOAN_CONTRACT_ID,
          "repay_loan",
          [
            bytesN32Val(params.loanId),
            addressVal(address),
            i128Val(params.repayAmount),
            addressVal(params.tokenAddress),
          ],
          kitSign
        )
        toastManager.success(t("repaymentSubmitted"), 5000, txHash)
        await fetchLoans()
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("repayFailed")
        toastManager.error(msg)
        return false
      } finally {
        setIsMutating(false)
      }
    },
    [address, kitSign, fetchLoans, t]
  )

  // ── cancelLoanRequest ───────────────────────────────────────────────────

  const cancelLoanRequest = useCallback(
    async (loanId: string): Promise<boolean> => {
      if (!address || !MICROLOAN_CONFIGURED) {
        toastManager.error(t("walletNotConfigured"))
        return false
      }
      setIsMutating(true)
      try {
        const server = new rpc.Server(STELLAR_RPC_URL)
        const txHash = await submitTransaction(
          server,
          address,
          MICROLOAN_CONTRACT_ID,
          "cancel_loan_request",
          [bytesN32Val(loanId), addressVal(address)],
          kitSign
        )
        toastManager.success(t("requestCancelled"), 5000, txHash)
        await fetchLoans()
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("cancelFailed")
        toastManager.error(msg)
        return false
      } finally {
        setIsMutating(false)
      }
    },
    [address, kitSign, fetchLoans, t]
  )

  // ── defaultLoan ─────────────────────────────────────────────────────────

  const defaultLoan = useCallback(
    async (loanId: string): Promise<boolean> => {
      if (!address || !MICROLOAN_CONFIGURED) {
        toastManager.error(t("walletNotConfigured"))
        return false
      }
      setIsMutating(true)
      try {
        const server = new rpc.Server(STELLAR_RPC_URL)
        const txHash = await submitTransaction(
          server,
          address,
          MICROLOAN_CONTRACT_ID,
          "default_loan",
          [bytesN32Val(loanId)],
          kitSign
        )
        toastManager.success(t("markedDefaulted"), 5000, txHash)
        await fetchLoans()
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("defaultFailed")
        toastManager.error(msg)
        return false
      } finally {
        setIsMutating(false)
      }
    },
    [address, kitSign, fetchLoans, t]
  )

  return {
    poolLoans,
    myLoans,
    isLoading,
    isMutating,
    error,
    createLoanRequest,
    acceptLoan,
    repayLoan,
    cancelLoanRequest,
    defaultLoan,
    refetch: fetchLoans,
  }
}

// ── Utility helpers (exported for use in components) ──────────────────────────

/** Total amount owed = principal + interest */
export function computeTotalOwed(loan: Loan): bigint {
  const interest = (loan.amount * BigInt(loan.interestRateBps)) / 10_000n
  return loan.amount + interest
}

/** Remaining balance to repay */
export function computeRemaining(loan: Loan): bigint {
  const owed = computeTotalOwed(loan)
  return loan.repaidAmount >= owed ? 0n : owed - loan.repaidAmount
}

/** Repayment progress as a percentage (0–100) */
export function computeRepaymentProgress(loan: Loan): number {
  const owed = computeTotalOwed(loan)
  if (owed === 0n) return 100
  const pct = Number((loan.repaidAmount * 10000n) / owed) / 100
  return Math.min(100, Math.max(0, pct))
}

/** Whether the loan is past its due date */
export function isOverdue(loan: Loan): boolean {
  if (loan.status !== "Active" || loan.dueDate === 0) return false
  return Date.now() / 1000 > loan.dueDate
}

/** Format a Unix timestamp as a human-readable date string */
export function formatDueDate(unixSecs: number, locale?: string): string {
  if (!unixSecs) return "—"
  return new Date(unixSecs * 1000).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/** Shorten a Stellar address for display */
export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return "—"
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
