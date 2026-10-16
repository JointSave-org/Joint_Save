"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingUp, Zap, AlertTriangle, RefreshCw } from "lucide-react"
import { useStellar, STELLAR_NETWORK_PASSPHRASE } from "@/components/web3-provider"
import { enqueueSign } from "@/lib/tx-queue"
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  xdr,
  Address,
  rpc,
  Account,
  Transaction,
} from "@stellar/stellar-sdk"
import { getRpc } from "@/hooks/useJointSaveContracts"
import { useYieldAllocation } from "@/hooks/useYieldAllocation"
import { parseAmountToBaseUnits, formatBaseUnits } from "@/lib/governance"
import { formatSharePrice } from "@/lib/yield-allocation"
import { submitWithRetry } from "@/lib/tx-retry"
import { TX_TIMEOUT } from "@/lib/constants"

const YIELD_DECIMALS = 7

function shorten(addr: string, head = 6, tail = 4): string {
  return addr.length > head + tail + 1 ? `${addr.slice(0, head)}…${addr.slice(-tail)}` : addr
}

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
  } as unknown as Account
  const tx = new TransactionBuilder(dummy, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId.toUpperCase()).call(method, ...args))
    .setTimeout(TX_TIMEOUT)
    .build()
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
  const t = useTranslations("group.yield")
  const { kit, address } = useStellar()
  const [state, setState] = useState<YieldState | null>(null)
  const [loading, setLoading] = useState(false)
  const [strategyInput, setStrategyInput] = useState("")
  const [deployAmount, setDeployAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const isPending = !poolAddress || poolAddress === "pending_deployment"

  // Vault-based allocation (share-based, buffer-safe). Distinct from the legacy
  // yield-strategy flow above and only active for flexible pools.
  const allocation = useYieldAllocation(isPending ? null : poolAddress)
  const [vaultInput, setVaultInput] = useState("")
  const [allocAmount, setAllocAmount] = useState("")
  const [deallocAmount, setDeallocAmount] = useState("")
  const [bufferInput, setBufferInput] = useState("")

  const loadState = useCallback(async () => {
    if (isPending) return
    setLoading(true)
    try {
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
          const inner =
            stratVal.switch().name === "scvAddress"
              ? stratVal
              : (stratVal.value() as unknown as xdr.ScVal)
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
    } catch (e: unknown) {
      setMsg({ type: "error", text: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }, [poolAddress, isPending])

  useEffect(() => {
    loadState()
  }, [loadState])

  async function submitTx(buildOp: (account: Account) => Transaction) {
    const server = getRpc()
    const result = await submitWithRetry({
      address: address!,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      sign: async (txXdr: string) =>
        (await enqueueSign(txXdr, { networkPassphrase: STELLAR_NETWORK_PASSPHRASE })).signedTxXdr,
      buildTx: buildOp,
      rpcServer: server,
    })
    if (result.status === "failed") {
      throw new Error(result.error ?? "Transaction failed on-chain")
    }
    return result.hash
  }

  const handleSetStrategy = async () => {
    if (!kit || !address || !strategyInput) return
    setBusy(true)
    setMsg(null)
    try {
      await submitTx((account) =>
        new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        })
          .addOperation(
            new Contract(poolAddress.toUpperCase()).call(
              "set_yield_strategy",
              addressVal(address),
              addressVal(strategyInput)
            )
          )
          .setTimeout(TX_TIMEOUT)
          .build()
      )
      setMsg({ type: "success", text: t("strategySet") })
      setStrategyInput("")
      loadState()
    } catch (e: unknown) {
      setMsg({ type: "error", text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const handleDeploy = async () => {
    if (!kit || !address || !deployAmount) return
    setBusy(true)
    setMsg(null)
    try {
      await submitTx((account) =>
        new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        })
          .addOperation(
            new Contract(poolAddress.toUpperCase()).call(
              "deploy_to_yield",
              addressVal(address),
              i128Val(toStroops(deployAmount))
            )
          )
          .setTimeout(TX_TIMEOUT)
          .build()
      )
      setMsg({ type: "success", text: t("deployedToStrategy", { amount: deployAmount }) })
      setDeployAmount("")
      loadState()
    } catch (e: unknown) {
      setMsg({ type: "error", text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const handleHarvest = async () => {
    if (!kit || !address) return
    setBusy(true)
    setMsg(null)
    try {
      await submitTx((account) =>
        new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        })
          .addOperation(
            new Contract(poolAddress.toUpperCase()).call("harvest_yield", addressVal(address))
          )
          .setTimeout(TX_TIMEOUT)
          .build()
      )
      setMsg({ type: "success", text: t("yieldHarvested") })
      loadState()
    } catch (e: unknown) {
      setMsg({ type: "error", text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (isPending) return null

  const runAllocationAction = async (
    action: () => Promise<boolean>,
    successKey: string,
    onSuccess?: () => void
  ) => {
    setBusy(true)
    setMsg(null)
    try {
      const ok = await action()
      if (ok) {
        setMsg({ type: "success", text: t(successKey) })
        onSuccess?.()
      } else {
        setMsg({ type: "error", text: t("vaultError") })
      }
    } catch (e: unknown) {
      setMsg({ type: "error", text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const handleAllocate = () =>
    runAllocationAction(
      () => allocation.applyAllocation(vaultInput.trim(), parseAmountToBaseUnits(allocAmount, YIELD_DECIMALS)),
      "vaultAllocated",
      () => {
        setAllocAmount("")
      }
    )

  const handleDeallocate = () =>
    runAllocationAction(
      () => allocation.deallocate(parseAmountToBaseUnits(deallocAmount, YIELD_DECIMALS)),
      "vaultDeallocated",
      () => setDeallocAmount("")
    )

  const handleSync = () => runAllocationAction(() => allocation.sync(), "vaultSynced")

  const handleSetBuffer = () =>
    runAllocationAction(
      () => allocation.setBuffer(Math.trunc(Number(bufferInput))),
      "vaultBufferSet",
      () => setBufferInput("")
    )

  const toggleLock = () =>
    runAllocationAction(
      () => allocation.setLocked(!(allocation.state?.locked ?? false)),
      allocation.state?.locked ? "vaultUnlockedSuccess" : "vaultLockedSuccess"
    )

  const fmtXlm = (stroops: bigint) => (Number(stroops) / 10_000_000).toFixed(4)

  const yState = allocation.state
  const sharePriceText = yState ? formatSharePrice(yState.position, yState.shares, 4) : null

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">{t("title")}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={loadState} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {msg && (
        <div
          className={`flex gap-2 p-3 rounded-lg text-sm ${
            msg.type === "success"
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {msg.type === "error" && <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
          {msg.text}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground mb-1">{t("deployedToYield")}</p>
          <p className="text-xl font-bold">{state ? fmtXlm(state.deployedAmount) : "—"} XLM</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground mb-1">{t("totalHarvested")}</p>
          <p className="text-xl font-bold">{state ? fmtXlm(state.totalHarvested) : "—"} XLM</p>
        </div>
      </div>

      {/* Current strategy */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">{t("activeStrategy")}</p>
        {state?.strategyAddress ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs font-mono truncate max-w-[200px]">
              {state.strategyAddress}
            </Badge>
            <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 text-xs">
              {t("active")}
            </Badge>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noStrategyConfigured")}</p>
        )}
      </div>

      {/* Set strategy */}
      <div className="border-t border-border pt-4 space-y-3">
        <Label htmlFor="strategy-addr">{t("setStrategyLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id="strategy-addr"
            placeholder={t("strategyPlaceholder")}
            value={strategyInput}
            onChange={(e) => setStrategyInput(e.target.value)}
            disabled={busy}
            className="font-mono text-xs"
          />
          <Button onClick={handleSetStrategy} disabled={busy || !strategyInput || !address}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("set")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("strategyHint")}</p>
      </div>

      {/* Deploy to yield */}
      {state?.strategyAddress && (
        <div className="border-t border-border pt-4 space-y-3">
          <Label htmlFor="deploy-amount">{t("deployFundsLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="deploy-amount"
              type="number"
              step="0.01"
              placeholder={t("amountPlaceholder")}
              value={deployAmount}
              onChange={(e) => setDeployAmount(e.target.value)}
              disabled={busy}
            />
            <Button onClick={handleDeploy} disabled={busy || !deployAmount || !address}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Zap className="h-4 w-4 mr-1" />
                  {t("deploy")}
                </>
              )}
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
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("processing")}
              </>
            ) : (
              <>
                <TrendingUp className="mr-2 h-4 w-4" />
                {t("harvestAndDistribute")}
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">{t("harvestHint")}</p>
        </div>
      )}

      {/* Vault allocation (share-based, buffer-safe) */}
      <div className="border-t border-border pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t("vaultTitle")}</p>
          {yState?.locked && (
            <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs">
              {t("vaultIlliquid")}
            </Badge>
          )}
        </div>

        {allocation.loading && !yState ? (
          <p className="text-sm text-muted-foreground">{t("processing")}</p>
        ) : allocation.error ? (
          <p className="text-sm text-destructive">{allocation.error}</p>
        ) : !yState?.vault ? (
          <p className="text-sm text-muted-foreground">{t("vaultEmpty")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">{t("vaultPosition")}</p>
              <p className="text-lg font-bold">
                {formatBaseUnits(yState.position, YIELD_DECIMALS)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">{t("vaultUnrealised")}</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">
                {formatBaseUnits(yState.unrealised, YIELD_DECIMALS)}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">{t("vaultSharePrice")}</p>
              <p className="text-lg font-bold">{sharePriceText ?? "—"}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">{t("vaultMaxAllocatable")}</p>
              <p className="text-lg font-bold">
                {formatBaseUnits(allocation.maxAllocatable, YIELD_DECIMALS)}
              </p>
            </div>
          </div>
        )}

        {yState?.vault && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("vaultContract")}</span>
            <Badge variant="secondary" className="font-mono text-xs">
              {shorten(yState.vault)}
            </Badge>
            <span className="ml-auto">
              {t("vaultBuffer")}: {(yState.bufferBps / 100).toFixed(2)}%
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Allocate */}
          <div className="space-y-2">
            <Label htmlFor="alloc-vault">{t("allocateLabel")}</Label>
            <Input
              id="alloc-vault"
              placeholder={t("vaultPlaceholder")}
              value={vaultInput}
              onChange={(e) => setVaultInput(e.target.value)}
              disabled={busy}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                placeholder={t("amountPlaceholder")}
                value={allocAmount}
                onChange={(e) => setAllocAmount(e.target.value)}
                disabled={busy}
              />
              <Button
                onClick={handleAllocate}
                disabled={busy || !vaultInput || !allocAmount || !address}
              >
                <Zap className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* De-allocate + buffer */}
          <div className="space-y-2">
            <Label htmlFor="dealloc-amount">{t("deallocateLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="dealloc-amount"
                type="number"
                step="0.01"
                placeholder={t("amountPlaceholder")}
                value={deallocAmount}
                onChange={(e) => setDeallocAmount(e.target.value)}
                disabled={busy}
              />
              <Button
                variant="outline"
                onClick={handleDeallocate}
                disabled={busy || !deallocAmount || !address}
              >
                {t("deallocate")}
              </Button>
            </div>
            <div className="flex gap-2 pt-1">
              <Input
                type="number"
                min="0"
                max="10000"
                placeholder={t("vaultBufferPlaceholder")}
                value={bufferInput}
                onChange={(e) => setBufferInput(e.target.value)}
                disabled={busy}
              />
              <Button
                variant="outline"
                onClick={handleSetBuffer}
                disabled={busy || !bufferInput || !address}
              >
                {t("set")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleSync}
            disabled={busy || !address}
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            {t("vaultSync")}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={toggleLock}
            disabled={busy || !address}
          >
            {yState?.locked ? t("vaultUnlock") : t("vaultLock")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center">{t("vaultHint")}</p>
      </div>
    </Card>
  )
}
