"use client"

import { useEffect, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getTokenByAddress, getTokenBalance } from "@/lib/token-utils"
import { validateTokenSelection } from "@/lib/deposit-token"
import { Skeleton } from "@/components/ui/skeleton"

interface DepositTokenPickerProps {
  /** Pool's supported-token identifiers ("native" / C…); [] = unrestricted. */
  supportedTokens: string[]
  /** The pool's canonical settlement token address. */
  poolTokenAddress: string
  symbol: string
  decimals: number
  /** Connected wallet address; null when disconnected (balances hidden). */
  walletAddress?: string | null
  onTokenChange?: (token: { symbol: string; decimals: number; id: string }) => void
}

/**
 * Token picker shown on the deposit panel. Lists the pool's supported SEP-41
 * assets (falling back to the pool's settlement token when the allowlist is
 * empty), shows each token's wallet balance using its own decimals, and
 * validates the selection against the allowlist before a deposit.
 */
export function DepositTokenPicker({
  supportedTokens,
  poolTokenAddress,
  symbol,
  decimals,
  walletAddress,
  onTokenChange,
}: DepositTokenPickerProps) {
  const allowed = supportedTokens.length > 0 ? supportedTokens : [poolTokenAddress]
  const unique = [...new Set(allowed.map((a) => a.toUpperCase()))]

  const [selectedId, setSelectedId] = useState<string>(
    poolTokenAddress === "native" ? "native" : poolTokenAddress.toUpperCase()
  )
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  const selection = getTokenByAddress(selectedId === "native" ? "native" : selectedId)
  const shownSymbol = selection?.symbol ?? symbol
  const shownDecimals = selection?.decimals ?? decimals

  useEffect(() => {
    onTokenChange?.({
      symbol: shownSymbol,
      decimals: shownDecimals,
      id: selectedId,
    })
     
  }, [selectedId, shownSymbol, shownDecimals])

  useEffect(() => {
    if (!walletAddress) {
      setBalances({})
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setBalances({})
    Promise.all(
      unique.map(async (id) => {
        const token = getTokenByAddress(id === "native" ? "native" : id)
        if (!token) return { id, balance: 0 }
        const balance = await getTokenBalance(walletAddress, token)
        return { id, balance }
      })
    )
      .then((results) => {
        if (cancelled) return
        const next: Record<string, number> = {}
        for (const r of results) next[r.id] = r.balance
        setBalances(next)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
     
  }, [walletAddress, unique.join(",")])

  const validationError = validateTokenSelection(
    { address: selectedId, symbol: shownSymbol },
    allowed
  )

  return (
    <div className="space-y-1.5">
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {unique.map((id) => {
            const token = getTokenByAddress(id === "native" ? "native" : id)
            const label = token ? `${token.icon} ${token.symbol}` : id
            return (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {walletAddress &&
        (loading ? (
          <Skeleton className="h-3 w-28" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {shownSymbol} balance:{" "}
            <span className="font-medium">{(balances[selectedId] ?? 0).toFixed(2)}</span>{" "}
            {shownSymbol}
          </p>
        ))}
      {validationError && <p className="text-xs text-destructive">{validationError}</p>}
    </div>
  )
}
