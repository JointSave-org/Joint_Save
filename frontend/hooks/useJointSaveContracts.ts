"use client"

import { useState } from "react"
import {
  Contract,
  TransactionBuilder,
  Transaction,
  BASE_FEE,
  nativeToScVal,
  Address,
  Account,
  xdr,
  rpc,
  Operation,
  StrKey,
} from "@stellar/stellar-sdk"
import {
  useStellar,
  STELLAR_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
} from "@/components/web3-provider"

// ── Constants ─────────────────────────────────────────────────────────────────

const FACTORY_ID = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID!
// Optional — the reputation system is additive, so an unconfigured tracker
// degrades to default scores instead of breaking pool creation/use.
const REPUTATION_ID = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID || ""
const XLM_STROOPS = 10_000_000
// 5 minutes — enough time for the user to review and sign in their wallet
const TX_TIMEOUT = 300

const WASM_HASHES: Record<string, string> = {
  rotational: process.env.NEXT_PUBLIC_ROTATIONAL_WASM_HASH!,
  target: process.env.NEXT_PUBLIC_TARGET_WASM_HASH!,
  flexible: process.env.NEXT_PUBLIC_FLEXIBLE_WASM_HASH!,
}

// ── E2E test seam ─────────────────────────────────────────────────────────────
// When NEXT_PUBLIC_E2E=true the contract layer is short-circuited so Playwright
// can exercise create/deposit/read flows deterministically without a live
// Soroban network or wallet. All branches below are dead code in production
// (the flag is unset), so there is zero runtime impact on real users.
const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"
// A real, checksum-valid contract strkey so StrKey.decodeContract() (used by the
// factory-register flow) accepts the canned id returned from a stubbed deploy.
const E2E_CONTRACT_ID = "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"
const E2E_TX_HASH =
  "e2e0000000000000000000000000000000000000000000000000000000000e2e"
const E2E_DEFAULT_ADDRESS =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"

/** Per-test on-chain overrides injected via `window.__E2E_STATE__`. */
function e2eState(): Record<string, any> {
  if (typeof window === "undefined") return {}
  return (window as any).__E2E_STATE__ ?? {}
}

/** Build the ScVal a given read method would return, from the injected state. */
function e2eViewResult(method: string): xdr.ScVal {
  const s = e2eState()
  switch (method) {
    case "is_active":
      return boolVal(s.isActive ?? true)
    case "is_paused":
      return boolVal(s.isPaused ?? false)
    case "is_unlocked":
      return boolVal(s.isUnlocked ?? false)
    case "current_round":
      return u32Val(s.currentRound ?? 0)
    case "members":
      return vecVal(s.members ?? [])
    case "next_payout_time":
      return u64Val(BigInt(s.nextPayoutTime ?? 0))
    case "has_deposited":
      return boolVal(s.hasDeposited ?? false)
    case "admin":
      return addressVal(s.admin ?? E2E_DEFAULT_ADDRESS)
    case "total_deposited":
      return i128Val(BigInt(s.totalDeposited ?? 0))
    case "target_amount":
      return i128Val(BigInt(s.targetAmount ?? 0))
    case "total_balance":
      return i128Val(BigInt(s.totalBalance ?? 0))
    case "balance_of":
      return i128Val(BigInt(s.balanceOf ?? 0))
    default:
      return boolVal(false)
  }
}

/** Minimal stub of the bits of rpc.Server our write/poll paths still touch. */
function makeE2EServer(): rpc.Server {
  return {
    getAccount: async (addr: string) => new Account(addr, "0"),
    getTransaction: async () => ({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      returnValue: addressVal(E2E_CONTRACT_ID),
    }),
    getLatestLedger: async () => ({ sequence: 1_000_000 }),
  } as unknown as rpc.Server
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getRpc() {
  if (IS_E2E) return makeE2EServer()
  return new rpc.Server(STELLAR_RPC_URL)
}

// Stellar strkeys are case-insensitive but the SDK requires uppercase
const normalizeId = (id: string) => id.toUpperCase()

const toStroops = (xlm: string): bigint =>
  BigInt(Math.round(parseFloat(xlm) * XLM_STROOPS))

// Works for both G... account and C... contract addresses
function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(addr.toUpperCase(), { type: "address" })
}

function i128Val(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" })
}

function u32Val(n: number): xdr.ScVal {
  return nativeToScVal(n, { type: "u32" })
}

function u64Val(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "u64" })
}

function boolVal(b: boolean): xdr.ScVal {
  return nativeToScVal(b, { type: "bool" })
}

function vecVal(addrs: string[]): xdr.ScVal {
  return nativeToScVal(addrs.map((a) => nativeToScVal(a, { type: "address" })))
}

/** Simulate → assemble → sign → send → poll. Returns tx hash. */
async function submitTx(kit: any, tx: any): Promise<string> {
  if (IS_E2E) return E2E_TX_HASH
  const server = getRpc()

  const simResult = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`)
  }

  const preparedTx = rpc.assembleTransaction(tx, simResult).build()

  const { signedTxXdr } = await kit.signTransaction(preparedTx.toXDR(), {
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })

  const result = await server.sendTransaction(
    new Transaction(signedTxXdr, STELLAR_NETWORK_PASSPHRASE)
  )

  if (result.status === "ERROR") {
    throw new Error(`Send failed: ${JSON.stringify(result.errorResult)}`)
  }

  // Poll for confirmation
  let getResult = await server.getTransaction(result.hash)
  let attempts = 0
  while (
    getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < 30
  ) {
    await new Promise((r) => setTimeout(r, 1500))
    getResult = await server.getTransaction(result.hash)
    attempts++
  }

  if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error("Transaction failed on-chain")
  }

  return result.hash
}

// ── Deploy pool from WASM hash ────────────────────────────────────────────────

export function useDeployPool() {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const deploy = async (poolType: "rotational" | "target" | "flexible"): Promise<string> => {
    if (!kit || !address) throw new Error("Wallet not connected")
    if (IS_E2E) return E2E_CONTRACT_ID
    const wasmHash = WASM_HASHES[poolType]
    if (!wasmHash) throw new Error(`No WASM hash configured for ${poolType}`)

    setIsLoading(true)
    try {
      const server = getRpc()
      const account = await server.getAccount(address)
      const salt = crypto.getRandomValues(new Uint8Array(32))

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.createCustomContract({
            wasmHash: Buffer.from(wasmHash, "hex"),
            address: new Address(address),
            salt: Buffer.from(salt),
          })
        )
        .setTimeout(TX_TIMEOUT)
        .build()

      const simResult = await server.simulateTransaction(tx)
      if (rpc.Api.isSimulationError(simResult)) {
        throw new Error(`Deploy simulation failed: ${simResult.error}`)
      }

      const preparedTx = rpc.assembleTransaction(tx, simResult).build()
      const { signedTxXdr } = await kit.signTransaction(preparedTx.toXDR(), {
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })

      const result = await server.sendTransaction(
        new Transaction(signedTxXdr, STELLAR_NETWORK_PASSPHRASE)
      )
      if (result.status === "ERROR") {
        throw new Error(`Deploy failed: ${JSON.stringify(result.errorResult)}`)
      }

      // Poll and extract new contract ID from return value
      let getResult = await server.getTransaction(result.hash)
      let attempts = 0
      while (
        getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
        attempts < 30
      ) {
        await new Promise((r) => setTimeout(r, 1500))
        getResult = await server.getTransaction(result.hash)
        attempts++
      }

      if (getResult.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error("Deploy transaction failed on-chain")
      }

      const success = getResult as rpc.Api.GetSuccessfulTransactionResponse
      if (!success.returnValue) throw new Error("No return value from deploy")
      return Address.fromScVal(success.returnValue).toString()
    } finally {
      setIsLoading(false)
    }
  }

  return { deploy, isLoading }
}

// ── Initialize pool contracts ─────────────────────────────────────────────────

export function useInitializePool() {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const initRotational = async (
    contractId: string,
    params: {
      token: string
      admin: string
      members: string[]
      depositAmount: string
      roundDuration: number
      treasuryFeeBps: number
      relayerFeeBps: number
      treasury: string
    }
  ): Promise<string> => {
    if (!kit || !address) throw new Error("Wallet not connected")
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call(
            "initialize",
            addressVal(params.token),
            addressVal(params.admin),
            vecVal(params.members),
            i128Val(toStroops(params.depositAmount)),
            u64Val(BigInt(params.roundDuration)),
            u32Val(params.treasuryFeeBps),
            u32Val(params.relayerFeeBps),
            addressVal(params.treasury)
          )
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  const initTarget = async (
    contractId: string,
    params: {
      token: string
      admin: string
      members: string[]
      targetAmount: string
      deadlineLedger: number
    }
  ): Promise<string> => {
    if (!kit || !address) throw new Error("Wallet not connected")
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call(
            "initialize",
            addressVal(params.token),
            addressVal(params.admin),
            vecVal(params.members),
            i128Val(toStroops(params.targetAmount)),
            u32Val(params.deadlineLedger)
          )
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  const initFlexible = async (
    contractId: string,
    params: {
      token: string
      admin: string
      members: string[]
      minimumDeposit: string
      withdrawalFeeBps: number
      yieldEnabled: boolean
      treasury: string
      treasuryFeeBps: number
    }
  ): Promise<string> => {
    if (!kit || !address) throw new Error("Wallet not connected")
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call(
            "initialize",
            addressVal(params.token),
            addressVal(params.admin),
            vecVal(params.members),
            i128Val(toStroops(params.minimumDeposit)),
            u32Val(params.withdrawalFeeBps),
            boolVal(params.yieldEnabled),
            addressVal(params.treasury),
            u32Val(params.treasuryFeeBps)
          )
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { initRotational, initTarget, initFlexible, isLoading }
}

// ── Register pool with factory ────────────────────────────────────────────────

export function useRegisterPool(poolType: "rotational" | "target" | "flexible") {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const register = async (caller: string, contractId: string): Promise<string> => {
    if (!kit || !address) throw new Error("Wallet not connected")
    if (!FACTORY_ID) throw new Error("Factory contract ID not configured")
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const methodMap = {
        rotational: "register_rotational",
        target: "register_target",
        flexible: "register_flexible",
      }
      const contractBytes = StrKey.decodeContract(contractId)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(FACTORY_ID)).call(
            methodMap[poolType],
            addressVal(caller),
            xdr.ScVal.scvBytes(Buffer.from(contractBytes))
          )
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { register, isLoading }
}

// ── Reputation tracker wiring ─────────────────────────────────────────────────

/** Point a freshly created pool at the shared ReputationTracker contract. */
export function useSetReputationTracker() {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const setTracker = async (contractId: string): Promise<string | undefined> => {
    if (!kit || !address || !contractId || !REPUTATION_ID) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call(
            "set_reputation_tracker",
            addressVal(address),
            addressVal(REPUTATION_ID)
          )
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { setTracker, isLoading }
}

// ── Rotational Pool actions ───────────────────────────────────────────────────

export function useRotationalDeposit(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const deposit = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(new Contract(normalizeId(contractId)).call("deposit", addressVal(address)))
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { deposit, isLoading }
}

export function useTriggerPayout(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const trigger = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(new Contract(normalizeId(contractId)).call("trigger_payout", addressVal(address)))
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { trigger, isLoading }
}

// ── Target Pool actions ───────────────────────────────────────────────────────

export function useTargetContribute(contractId: string, amount: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const contribute = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId || !amount) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call("deposit", addressVal(address), i128Val(toStroops(amount)))
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { contribute, isLoading }
}

export function useTargetWithdraw(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const withdraw = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(new Contract(normalizeId(contractId)).call("withdraw", addressVal(address)))
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { withdraw, isLoading }
}

export function useTargetRefund(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const refund = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(new Contract(normalizeId(contractId)).call("refund", addressVal(address)))
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { refund, isLoading }
}

// ── Flexible Pool actions ─────────────────────────────────────────────────────

export function useFlexibleDeposit(contractId: string, amount: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const deposit = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId || !amount) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call("deposit", addressVal(address), i128Val(toStroops(amount)))
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { deposit, isLoading }
}

export function useFlexibleWithdraw(contractId: string, amount: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const withdraw = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId || !amount) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call("withdraw", addressVal(address), i128Val(toStroops(amount)))
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { withdraw, isLoading }
}

// ── On-chain state types ──────────────────────────────────────────────────────

export interface RotationalPoolState {
  isActive: boolean
  currentRound: number
  members: string[]
  nextPayoutTime: number   // unix timestamp (seconds)
  hasDeposited: boolean    // for the querying user
  depositCount: number     // number of members who deposited in the current round
  treasuryFeeBps: number | null
  relayerFeeBps: number | null
}

export interface TargetPoolState {
  isUnlocked: boolean
  totalDeposited: bigint
  targetAmount: bigint
  userBalance: bigint
}

export interface FlexiblePoolState {
  isActive: boolean
  totalBalance: bigint
  userBalance: bigint
}

export interface ReputationScore {
  totalDeposits: bigint
  poolsCompleted: number
  missedRounds: number
  onTimeRate: number // basis points: 10000 = 100%
}

const DEFAULT_REPUTATION: ReputationScore = {
  totalDeposits: 0n,
  poolsCompleted: 0,
  missedRounds: 0,
  onTimeRate: 10000,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function stroopsToXlm(stroops: bigint): number {
  return Number(stroops) / 10_000_000
}

/** Fire-and-forget read call — no signing, no fee. */
async function viewCall(contractId: string, method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal> {
  if (IS_E2E) return e2eViewResult(method)
  const server = getRpc()
  // Use a dummy account for simulation — sequence number doesn't matter for reads
  const dummyAccount = {
    accountId: () => "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  } as any

  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(normalizeId(contractId)).call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build()

  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`View call failed (${method}): ${sim.error}`)
  }
  return (sim as rpc.Api.SimulateTransactionSuccessResponse).result!.retval
}

async function fetchContractStorage(contractId: string, keySymbol: string): Promise<xdr.ScVal | null> {
  if (IS_E2E) {
    const s = e2eState()
    if (keySymbol === "TreasuryFeeBps") return u32Val(s.treasuryFeeBps ?? 100)
    if (keySymbol === "RelayerFeeBps") return u32Val(s.relayerFeeBps ?? 50)
    return null
  }
  try {
    const server = getRpc()
    const ledgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(normalizeId(contractId)).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(keySymbol)]),
        durability: xdr.ContractDataDurability.persistent(),
      })
    )
    const response = await server.getLedgerEntries(ledgerKey)
    if (response.entries && response.entries.length > 0) {
      const entry = response.entries[0]
      
      // Type guard for LedgerEntryResult to safely access xdr
      let rawXdr = ""
      
      if (entry && typeof entry === "object") {
        if ("xdr" in entry) {
          rawXdr = entry.xdr as string
        } else if (entry.val && typeof (entry.val as any).toXDR === "function") {
          rawXdr = (entry.val as any).toXDR("base64")
        }
      }
      if (!rawXdr) return null
      const ledgerData = xdr.LedgerEntryData.fromXDR(rawXdr, "base64")
      return ledgerData.contractData().val()
    }
  } catch (err) {
    console.error(`Error fetching contract storage for ${keySymbol}:`, err)
  }
  return null
}

function scValToBigInt(val: xdr.ScVal): bigint {
  // i128 / u128 are stored as hi+lo parts
  if (val.switch().name === "scvI128") {
    const parts = val.i128()
    return (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString())
  }
  if (val.switch().name === "scvU128") {
    const parts = val.u128()
    return (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString())
  }
  if (val.switch().name === "scvU64") return BigInt(val.u64().toString())
  if (val.switch().name === "scvI64") return BigInt(val.i64().toString())
  return 0n
}

function scValToString(val: xdr.ScVal): string {
  if (val.switch().name === "scvAddress") {
    return Address.fromScVal(val).toString()
  }
  return ""
}

function scValToU32(val?: xdr.ScVal): number {
  return val && val.switch().name === "scvU32" ? val.u32() : 0
}

/** Soroban structs serialize as an ScMap keyed by field name (Symbol). */
function structField(val: xdr.ScVal, field: string): xdr.ScVal | undefined {
  return val
    .map()
    ?.find((entry) => entry.key().sym().toString() === field)
    ?.val()
}

// ── Read-only state fetchers ──────────────────────────────────────────────────

export async function fetchRotationalState(
  contractId: string,
  userAddress?: string
): Promise<RotationalPoolState> {
  const [activeVal, roundVal, membersVal, payoutVal, treasurySc, relayerSc] = await Promise.all([
    viewCall(contractId, "is_active"),
    viewCall(contractId, "current_round"),
    viewCall(contractId, "members"),
    viewCall(contractId, "next_payout_time"),
    fetchContractStorage(contractId, "TreasuryFeeBps"),
    fetchContractStorage(contractId, "RelayerFeeBps"),
  ])

  const members = activeVal.switch().name !== "scvBool"
    ? []
    : membersVal.vec()?.map(scValToString) ?? []

  let hasDeposited = false
  if (userAddress) {
    try {
      const depVal = await viewCall(contractId, "has_deposited", addressVal(userAddress))
      hasDeposited = depVal.switch().name === "scvBool" ? depVal.b() : false
    } catch {}
  }

  let depositCount = 0
  if (activeVal.switch().name === "scvBool" && activeVal.b() && members.length > 0) {
    try {
      const depositChecks: boolean[] = []
      const batchSize = 3
      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize)
        const results = await Promise.all(
          batch.map(async (m) => {
            const depVal = await viewCall(contractId, "has_deposited", addressVal(m))
            return depVal.switch().name === "scvBool" ? depVal.b() : false
          })
        )
        depositChecks.push(...results)
      }
      depositCount = depositChecks.filter(Boolean).length
    } catch (e) {
      console.error("Failed to query deposit checks for members:", e)
    }
  }

  const treasuryFeeBps = treasurySc && treasurySc.switch().name === "scvU32" ? treasurySc.u32() : null
  const relayerFeeBps = relayerSc && relayerSc.switch().name === "scvU32" ? relayerSc.u32() : null

  return {
    isActive: activeVal.switch().name === "scvBool" ? activeVal.b() : false,
    currentRound: roundVal.switch().name === "scvU32" ? roundVal.u32() : 0,
    members,
    nextPayoutTime: Number(scValToBigInt(payoutVal)),
    hasDeposited,
    depositCount,
    treasuryFeeBps,
    relayerFeeBps,
  }
}

export async function fetchTargetState(
  contractId: string,
  userAddress?: string
): Promise<TargetPoolState> {
  const [unlockedVal, totalVal, targetVal] = await Promise.all([
    viewCall(contractId, "is_unlocked"),
    viewCall(contractId, "total_deposited"),
    viewCall(contractId, "target_amount"),
  ])

  let userBalance = 0n
  if (userAddress) {
    try {
      const balVal = await viewCall(contractId, "balance_of", addressVal(userAddress))
      userBalance = scValToBigInt(balVal)
    } catch {}
  }

  return {
    isUnlocked: unlockedVal.switch().name === "scvBool" ? unlockedVal.b() : false,
    totalDeposited: scValToBigInt(totalVal),
    targetAmount: scValToBigInt(targetVal),
    userBalance,
  }
}

// ── On-chain event fetching ───────────────────────────────────────────────────

export interface ActivityEvent {
  id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  description: string | null
  created_at: string
  tx_hash: string | null
  source: "onchain" | "offchain"
}

/**
 * Fetch contract events from the RPC and map them to ActivityEvent rows.
 * Topics emitted by contracts: "deposit", "payout", "withdraw", "complete",
 * "unlocked", "refunded", "yield".
 */
export async function fetchContractEvents(
  contractId: string,
  startLedger: number
): Promise<ActivityEvent[]> {
  if (IS_E2E) return (e2eState().events as ActivityEvent[]) ?? []
  const server = getRpc()
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
      },
    ],
    limit: 100,
  })

  const events: ActivityEvent[] = []

  for (const ev of response.events) {
    const topics = ev.topic
    if (!topics.length) continue

    // First topic is always the event name symbol
    const topicName =
      topics[0].switch().name === "scvSymbol"
        ? topics[0].sym().toString()
        : null
    if (!topicName) continue

    // Second topic (optional) is the address
    let userAddress: string | null = null
    if (topics[1]?.switch().name === "scvAddress") {
      try {
        userAddress = Address.fromScVal(topics[1]).toString()
      } catch {}
    }

    // Value is the amount (i128) for deposit/payout/withdraw
    let amount: number | null = null
    try {
      const val = ev.value
      const sw = val.switch().name
      if (sw === "scvI128" || sw === "scvU128" || sw === "scvU64" || sw === "scvI64") {
        amount = Number(scValToBigInt(val)) / 10_000_000
      }
    } catch {}

    const typeMap: Record<string, string> = {
      deposit: "deposit",
      payout: "payout",
      withdraw: "withdraw",
      complete: "complete",
      unlocked: "complete",
      refunded: "withdraw",
      yield: "yield",
    }

    const activity_type = typeMap[topicName]
    if (!activity_type) continue

    // Derive a stable id from txHash + topic
    const id = `${ev.txHash}-${topicName}`

    events.push({
      id,
      activity_type,
      user_address: userAddress,
      amount,
      description: null,
      // Soroban events don't carry a timestamp; use ledger close time if available
      created_at: ev.ledgerClosedAt ?? new Date(0).toISOString(),
      tx_hash: ev.txHash,
      source: "onchain",
    })
  }

  // Most-recent first
  return events.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export async function fetchFlexibleState(
  contractId: string,
  userAddress?: string
): Promise<FlexiblePoolState> {
  const [activeVal, totalVal] = await Promise.all([
    viewCall(contractId, "is_active"),
    viewCall(contractId, "total_balance"),
  ])

  let userBalance = 0n
  if (userAddress) {
    try {
      const balVal = await viewCall(contractId, "balance_of", addressVal(userAddress))
      userBalance = scValToBigInt(balVal)
    } catch {}
  }

  return {
    isActive: activeVal.switch().name === "scvBool" ? activeVal.b() : false,
    totalBalance: scValToBigInt(totalVal),
    userBalance,
  }
}

export async function fetchPoolMembers(contractId: string): Promise<string[]> {
  try {
    const val = await viewCall(contractId, "members")
    return val.vec()?.map(scValToString) ?? []
  } catch {
    return []
  }
}

export async function fetchIsPaused(contractId: string): Promise<boolean> {
  try {
    const val = await viewCall(contractId, "is_paused")
    return val.switch().name === "scvBool" ? val.b() : false
  } catch {
    return false
  }
}

export async function fetchPoolAdmin(contractId: string): Promise<string | null> {
  try {
    const val = await viewCall(contractId, "admin")
    return val.switch().name === "scvAddress" ? Address.fromScVal(val).toString() : null
  } catch {
    return null
  }
}

// ── Admin hooks ───────────────────────────────────────────────────────────────

export function useAddPoolMember(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const addMember = async (newMember: string): Promise<string | undefined> => {
    if (!kit || !address || !contractId || !newMember) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call(
            "add_member",
            addressVal(address),
            addressVal(newMember)
          )
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { addMember, isLoading }
}

export function useRemovePoolMember(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const removeMember = async (member: string): Promise<string | undefined> => {
    if (!kit || !address || !contractId || !member) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(normalizeId(contractId)).call(
            "remove_member",
            addressVal(address),
            addressVal(member)
          )
        )
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { removeMember, isLoading }
}

export function usePausePool(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const pause = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(new Contract(normalizeId(contractId)).call("pause", addressVal(address)))
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { pause, isLoading }
}

export function useUnpausePool(contractId: string) {
  const { kit, address } = useStellar()
  const [isLoading, setIsLoading] = useState(false)

  const unpause = async (): Promise<string | undefined> => {
    if (!kit || !address || !contractId) return
    setIsLoading(true)
    try {
      const account = await getRpc().getAccount(address)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(new Contract(normalizeId(contractId)).call("unpause", addressVal(address)))
        .setTimeout(TX_TIMEOUT)
        .build()
      return await submitTx(kit, tx)
    } finally {
      setIsLoading(false)
    }
  }

  return { unpause, isLoading }
}

/** Read-only, no fees, no signing — safe to call for any address at any time. */
export async function fetchReputation(address: string): Promise<ReputationScore> {
  if (!REPUTATION_ID) return DEFAULT_REPUTATION
  try {
    const val = await viewCall(REPUTATION_ID, "get_reputation", addressVal(address))
    return {
      totalDeposits: scValToBigInt(structField(val, "total_deposits")!),
      poolsCompleted: scValToU32(structField(val, "pools_completed")),
      missedRounds: scValToU32(structField(val, "missed_rounds")),
      onTimeRate: scValToU32(structField(val, "on_time_rate")),
    }
  } catch {
    return DEFAULT_REPUTATION
  }
}
