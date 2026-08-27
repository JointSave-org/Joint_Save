"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { useStellar } from "@/components/web3-provider"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { toastManager } from "@/lib/toast"
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wallet,
  XCircle,
} from "lucide-react"
import {
  CCTP_CHAINS,
  validateBridgeAmount,
  usdcHumanToBase,
  usdcBaseToHuman,
  resolveAttestationPhase,
  advanceBridgeStatus,
  explorerTxUrl,
  getCctpChainById,
  BRIDGE_STATUS_LABEL_KEY,
  type BridgeStatus,
} from "@/lib/cctp-bridge"
import { depositForBurnSeam, fetchAttestation } from "@/lib/cctp-driver"

const ATTESTATION_POLL_MS = 6000
const MAX_POLLS = 40

/** Persist bridge state so progress survives a page refresh. */
async function saveBridgeState(payload: Record<string, unknown>) {
  try {
    await fetch("/api/bridge/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch {
    // Non-critical — leave the row unpersisted rather than break the flow.
  }
}

export default function BridgePage() {
  const t = useTranslations("bridge")
  const { address } = useStellar()

  const [chainId, setChainId] = useState(CCTP_CHAINS[0].id)
  const chain = getCctpChainById(chainId) ?? CCTP_CHAINS[0]
  const [amount, setAmount] = useState("")
  const [status, setStatus] = useState<BridgeStatus>("pending")
  const [messageHash, setMessageHash] = useState<string | null>(null)
  const [sourceTxHash, setSourceTxHash] = useState<string | null>(null)
  const [burning, setBurning] = useState(false)
  const [attestationError, setAttestationError] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const messageRef = useRef<string | null>(null)

  const baseAmount = useMemo(() => {
    try {
      return usdcHumanToBase(amount, chain.decimals)
    } catch {
      return null
    }
  }, [amount, chain.decimals])

  const amountError = validateBridgeAmount(amount, chain.decimals)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Resume an in-flight bridge on mount (persisted state).
  useEffect(() => {
    if (!address) return
    let cancelled = false
    fetch(`/api/bridge/transactions?user=${encodeURIComponent(address)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const tx = Array.isArray(data.transactions) ? data.transactions[0] : null
        if (tx && tx.status !== "deposited" && tx.status !== "failed") {
          setStatus(tx.status)
          setMessageHash(tx.message_hash ?? null)
          setSourceTxHash(tx.source_tx_hash ?? null)
          messageRef.current = tx.message_hash ?? null
          if (tx.source_chain) setChainId(tx.source_chain)
          if (tx.amount_base_units) {
            try {
              setAmount(usdcBaseToHuman(BigInt(tx.amount_base_units), chain.decimals))
            } catch {
              /* leave amount blank */
            }
          }
          if (tx.message_hash) beginPolling(tx.message_hash)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [address])

  const beginPolling = useCallback(
    (hash: string) => {
      stopPolling()
      setMessageHash(hash)
      messageRef.current = hash
      let polls = 0
      pollRef.current = setInterval(async () => {
        polls += 1
        try {
          const { status: raw } = await fetchAttestation(hash)
          const phase = resolveAttestationPhase(raw)
          setStatus((current) => {
            const next = advanceBridgeStatus(current, phase)
            if (next === "attested") {
              stopPolling()
              void saveBridgeState({ id: hash, status: "attested" })
            } else if (next === "failed") {
              stopPolling()
              setAttestationError(t("attestationFailed"))
              void saveBridgeState({ id: hash, status: "failed", error: "attestation failed" })
            }
            return next
          })
        } catch {
          // transient network error — keep polling
        }
        if (polls >= MAX_POLLS) stopPolling()
      }, ATTESTATION_POLL_MS)
    },
    [stopPolling, t]
  )

  useEffect(() => stopPolling, [stopPolling])

  const handleStart = async () => {
    if (!address) return toastManager.error(t("connectWalletFirst"))
    if (amountError) return toastManager.error(amountError)
    if (baseAmount == null) return
    setBurning(true)
    setAttestationError("")
    try {
      const { messageHash: hash, sourceTxHash: txHash } = await depositForBurnSeam({
        sourceChainId: chain.id,
        amountBaseUnits: baseAmount,
        recipient: address,
        nonce: String(Date.now()),
      })
      setSourceTxHash(txHash)
      setStatus("pending")
      await saveBridgeState({
        id: hash,
        userAddress: address,
        sourceChain: chain.id,
        amountBaseUnits: baseAmount.toString(),
        status: "pending",
        sourceTxHash: txHash,
        messageHash: hash,
        poolId: null,
      })
      beginPolling(hash)
      toastManager.info(t("burnInitiated"))
    } catch (err) {
      toastManager.error(err instanceof Error ? err.message : t("burnFailed"))
    } finally {
      setBurning(false)
    }
  }

  const handleReceive = async () => {
    if (!messageHash || !address) return
    setStatus("received")
    await saveBridgeState({
      id: messageHash,
      userAddress: address,
      status: "received",
      redemptionTxHash: messageHash,
    })
    toastManager.success(t("receivedOnStellar"))
  }

  // Deposit hand-off prefills a query so the group deposit page can credit
  // the bridged amount.
  const depositLink =
    status === "received"
      ? `/dashboard?bridge-deposit=${encodeURIComponent(usdcBaseToHuman(baseAmount ?? 0n, chain.decimals) || "")}`
      : "/dashboard"

  const statusSteps: BridgeStatus[] = ["pending", "attested", "received", "deposited"]
  const currentIndex = statusSteps.indexOf(status === "failed" ? "pending" : status)

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl">
                <Image
                  src="/joint-save.webp"
                  alt="JointSave Logo"
                  width={40}
                  height={40}
                  priority
                  placeholder="blur"
                  blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4MCA4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMWUxZTJlIi8+PC9zdmc+"
                  className="object-cover"
                />
              </div>
              <span className="text-xl font-bold">JointSave</span>
            </Link>
            <div className="flex items-center gap-2">
              {address && (
                <Badge variant="secondary" className="gap-1.5">
                  <Wallet className="h-3.5 w-3.5" />
                  {address.slice(0, 6)}…{address.slice(-4)}
                </Badge>
              )}
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 pt-28 pb-24 sm:px-6 lg:px-8">
        <Badge variant="secondary" className="mb-4 gap-1.5">
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {t("badge")}
        </Badge>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mb-8 max-w-2xl text-lg text-muted-foreground text-pretty">
          {t("description")}
        </p>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ArrowUpDown className="h-5 w-5 text-primary" />
              {t("formTitle")}
            </CardTitle>
            <CardDescription>{t("formDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("sourceChain")}</Label>
              <Select
                value={chainId}
                onValueChange={(v) => {
                  setChainId(v)
                  setAmount("")
                }}
                disabled={burning || messageHash != null}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CCTP_CHAINS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("destinationHint")}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("usdcAmount")}</Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={burning || messageHash != null}
              />
              {amount && baseAmount != null && (
                <p className="text-xs text-muted-foreground">
                  {t("converted", {
                    n: usdcBaseToHuman(baseAmount, chain.decimals),
                    dest: t("stellarUsdcLabel"),
                  })}
                </p>
              )}
              {amountError && <p className="text-xs text-destructive">{amountError}</p>}
            </div>

            {!address && (
              <Alert>
                <Wallet className="h-4 w-4" />
                <AlertTitle>{t("connectWalletTitle")}</AlertTitle>
                <AlertDescription>{t("connectWalletBody")}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full gap-2"
              onClick={handleStart}
              disabled={burning || !address || !!amountError || !amount}
            >
              {burning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("burning")}
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4" />
                  {t("startBridge")}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {(messageHash || status !== "pending") && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <RefreshCw className="h-5 w-5 text-primary" />
                {t("progressTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="flex items-center gap-2">
                {statusSteps.map((step, i) => {
                  const reached = i <= currentIndex
                  const isFailed = status === "failed"
                  return (
                    <li key={step} className="flex flex-1 items-center gap-2">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          isFailed && i === 0
                            ? "bg-destructive/15 text-destructive"
                            : reached
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span
                        className={`text-xs ${
                          reached && !isFailed
                            ? "font-medium"
                            : status === "failed" && i === 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                      >
                        {t(BRIDGE_STATUS_LABEL_KEY[step])}
                      </span>
                      {i < statusSteps.length - 1 && <span className="h-px flex-1 bg-border" />}
                    </li>
                  )
                })}
              </ol>

              {status === "attested" && messageHash && (
                <>
                  <Alert className="border-primary/40 bg-primary/5">
                    <ArrowRight className="h-4 w-4 text-primary" />
                    <AlertTitle>{t("attestedTitle")}</AlertTitle>
                    <AlertDescription>{t("attestedBody")}</AlertDescription>
                  </Alert>
                  <Button className="w-full gap-2" onClick={handleReceive}>
                    <ArrowUpDown className="h-4 w-4" />
                    {t("receiveOnStellar")}
                  </Button>
                </>
              )}

              {status === "received" && (
                <div className="space-y-3">
                  <Alert>
                    <ArrowRight className="h-4 w-4" />
                    <AlertTitle>{t("receivedTitle")}</AlertTitle>
                    <AlertDescription>{t("receivedBody")}</AlertDescription>
                  </Alert>
                  <Button className="w-full gap-2" asChild>
                    <Link href={depositLink}>
                      {t("depositIntoPool")} <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}

              {status === "failed" && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>{t("failedTitle")}</AlertTitle>
                  <AlertDescription>
                    {attestationError || t("failedBody")}
                    {sourceTxHash && chain && (
                      <a
                        href={explorerTxUrl(chain, sourceTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 flex items-center gap-1.5 text-sm font-medium underline"
                      >
                        {t("refundLink")} <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {messageHash && (
                <p className="truncate text-xs text-muted-foreground">
                  {t("messageHash")}: <span className="font-mono">{messageHash}</span>
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
