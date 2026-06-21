"use client"

import { useState, useEffect, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingUp, Zap, AlertTriangle, RefreshCw } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import {
  Contract, TransactionBuilder, BASE_FEE, nativeToScVal, xdr,
  Address,
  rpc,
} from "@stellar/stellar-sdk"
import { STELLAR_RPC_URL } from "@/components/web3-provider"
import { STELLAR_NETWORK_PASSPHRASE } from "@/components/web3-provider"
import { getRpc } from "@/hooks/useJointSaveContracts"

const TX_TIMEOUT = 300

function addressVal(addr: string): xdr.ScVal {
  return nativeToScVal(addr.toUpperCase(), { type: "address" })
}
function i128Val(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" })
}
const toStroops = (xlm: string) => BigInt(Math.round(parseFloat(xlm) * 10_000_000))
function scValToBigInt(val: xdr.ScVal): bigint {
  if (val.switch().name === "scvI128") {
    const p = val.i128()
    return (BigInt(p.hi().toString()) << 64n) | BigInt(p.lo().toString())
  }
  return 0n
}

async function viewCall(contractId: string, method: string, ...args: xdr.ScVal[]) {
  const { rpc } = await import("@stellar/stellar-sdk")
  const server = getRpc()
  const dummy = {
    accountId: () => "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  } as any
  const tx = new TransactionBuilder(dummy, { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId.toUpperCase()).call(method, ...args))
    .setTimeout(TX_TIMEOUT).build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  return (sim as rpc.Api.SimulateTransactionSuccessResponse).result!.retval
}

interface YieldDashboardProps {
  poolAddress: string
}

interface YieldState {
  strategyAddress: string | null
  deployedAmount: bigint
  totalHarvested: bigint
}

export function YieldDashboard({ poolAddress }: YieldDashboardProps) {
  const { kit, address } = useStellar()
  const [state, setState] = useState<YieldState | null>(null)
  const [loading, setLoading] = useState(false)
  const [strategyInput, setStrategyInput] = useState("")
  const [deployAmount, setDeployAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const isPending = !poolAddress || poolAddress === "pending_deployment"

  const loadState = useCallback(async () => {
    if (isPending) return
    setLoading(true)
    try {
      const { rpc } = await import("@stellar/stellar-sdk")

      // Fetch yield_strategy (optional — returns None if not set)
      let strategyAddress: string | null = null
      let deployedAmount = 0n
      let totalHarvested = 0n

      try {
        const stratVal = await viewCall(poolAddress, "yield_strategy")
        if (stratVal.switch().name === "scvVoid" || stratVal.switch().name === "scvBool") {
          strategyAddress = null
        } else {
          // scvOption wrapping an address
          const kind = stratVal.switch().name;

        let inner: xdr.ScVal;

        if (kind === "scvAddress") {
          inner = stratVal;
        } else {
          const value = stratVal.value();

          if (!(value instanceof xdr.ScVal)) {
            throw new Error("Expected ScVal");
          }

          inner = value;
        }
          strategyAddress = Address.fromScVal(inner).toString()
        }
      } catch {}

      try {
        const depVal = await viewCall(poolAddress, "deployed_to_yield")
        deployedAmount = scValToBigInt(depVal)
      } catch {}

      if (strategyAddress) {
        try {
          const harvVal = await viewCall(strategyAddress, "total_harvested")
          totalHarvested = scValToBigInt(harvVal)
        } catch {}
      }

      setState({ strategyAddress, deployedAmount, totalHarvested })
    } catch (e: any) {
      setMsg({ type: "error", text: e.message })
    } finally {
      setLoading(false)
    }
  }, [poolAddress, isPending])

  useEffect(() => { loadState() }, [loadState])

  async function submitTx(buildOp: (account: any) => any) {
    const { rpc, Transaction } = await import("@stellar/stellar-sdk")
    const server = getRpc()
    const account = await server.getAccount(address!)
    const tx = buildOp(account)
    const sim = await server.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation: ${sim.error}`)
    const prepared = rpc.assembleTransaction(tx, sim).build()
    const { signedTxXdr } = await kit!.signTransaction(prepared.toXDR(), {
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
    const result = await server.sendTransaction(new Transaction(signedTxXdr, STELLAR_NETWORK_PASSPHRASE))
    if (result.status === "ERROR") throw new Error("Transaction failed")
    // Poll
    let poll = await server.getTransaction(result.hash)
    for (let i = 0; poll.status === rpc.Api.GetTransactionStatus.NOT_FOUND && i < 30; i++) {
      await new Promise(r => setTimeout(r, 1500))
      poll = await server.getTransaction(result.hash)
    }
    if (poll.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error("On-chain failure")
    return result.hash
  }

  const handleSetStrategy = async () => {
    if (!kit || !address || !strategyInput) return
    setBusy(true); setMsg(null)
    try {
      await submitTx(account =>
        new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE })
          .addOperation(new Contract(poolAddress.toUpperCase()).call(
            "set_yield_strategy", addressVal(address), addressVal(strategyInput)
          ))
          .setTimeout(TX_TIMEOUT).build()
      )
      setMsg({ type: "success", text: "Yield strategy set!" })
      setStrategyInput("")
      loadState()
    } catch (e: any) {
      setMsg({ type: "error", text: e.message })
    } finally { setBusy(false) }
  }

  const handleDeploy = async () => {
    if (!kit || !address || !deployAmount) return
    setBusy(true); setMsg(null)
    try {
      await submitTx(account =>
        new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE })
          .addOperation(new Contract(poolAddress.toUpperCase()).call(
            "deploy_to_yield", addressVal(address), i128Val(toStroops(deployAmount))
          ))
          .setTimeout(TX_TIMEOUT).build()
      )
      setMsg({ type: "success", text: `Deployed ${deployAmount} XLM to yield strategy!` })
      setDeployAmount("")
      loadState()
    } catch (e: any) {
      setMsg({ type: "error", text: e.message })
    } finally { setBusy(false) }
  }

  const handleHarvest = async () => {
    if (!kit || !address) return
    setBusy(true); setMsg(null)
    try {
      await submitTx(account =>
        new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: STELLAR_NETWORK_PASSPHRASE })
          .addOperation(new Contract(poolAddress.toUpperCase()).call(
            "harvest_yield", addressVal(address)
          ))
          .setTimeout(TX_TIMEOUT).build()
      )
      setMsg({ type: "success", text: "Yield harvested and distributed!" })
      loadState()
    } catch (e: any) {
      setMsg({ type: "error", text: e.message })
    } finally { setBusy(false) }
  }

  if (isPending) return null

  const fmtXlm = (stroops: bigint) => (Number(stroops) / 10_000_000).toFixed(4)

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Yield Strategy</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={loadState} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {msg && (
        <div className={`flex gap-2 p-3 rounded-lg text-sm ${
          msg.type === "success" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
        }`}>
          {msg.type === "error" && <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
          {msg.text}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground mb-1">Deployed to Yield</p>
          <p className="text-xl font-bold">{state ? fmtXlm(state.deployedAmount) : "—"} XLM</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground mb-1">Total Harvested</p>
          <p className="text-xl font-bold">{state ? fmtXlm(state.totalHarvested) : "—"} XLM</p>
        </div>
      </div>

      {/* Current strategy */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">Active Strategy</p>
        {state?.strategyAddress ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs font-mono truncate max-w-[200px]">
              {state.strategyAddress}
            </Badge>
            <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 text-xs">Active</Badge>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No strategy configured</p>
        )}
      </div>

      {/* Set strategy */}
      <div className="border-t border-border pt-4 space-y-3">
        <Label htmlFor="strategy-addr">Set Yield Strategy Contract</Label>
        <div className="flex gap-2">
          <Input
            id="strategy-addr"
            placeholder="C... contract address"
            value={strategyInput}
            onChange={e => setStrategyInput(e.target.value)}
            disabled={busy}
            className="font-mono text-xs"
          />
          <Button onClick={handleSetStrategy} disabled={busy || !strategyInput || !address}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Soroswap or Stellar AMM strategy contract. Only callable by pool admin.
        </p>
      </div>

      {/* Deploy to yield */}
      {state?.strategyAddress && (
        <div className="border-t border-border pt-4 space-y-3">
          <Label htmlFor="deploy-amount">Deploy Funds to Protocol</Label>
          <div className="flex gap-2">
            <Input
              id="deploy-amount"
              type="number"
              step="0.01"
              placeholder="Amount (XLM)"
              value={deployAmount}
              onChange={e => setDeployAmount(e.target.value)}
              disabled={busy}
            />
            <Button onClick={handleDeploy} disabled={busy || !deployAmount || !address}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" />Deploy</>}
            </Button>
          </div>
        </div>
      )}

      {/* Harvest */}
      {state?.strategyAddress && (
        <div className="border-t border-border pt-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleHarvest}
            disabled={busy || !address}
          >
            {busy
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
              : <><TrendingUp className="mr-2 h-4 w-4" />Harvest & Distribute Yield</>}
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Harvests accumulated yield from the protocol and distributes proportionally to all members.
          </p>
        </div>
      )}
    </Card>
  )
}
