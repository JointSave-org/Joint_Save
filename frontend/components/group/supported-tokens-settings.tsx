"use client"

import { useEffect, useState } from "react"
import { useStellar } from "@/components/web3-provider"
import { useSetSupportedTokens, fetchSupportedTokens } from "@/hooks/useJointSaveContracts"
import { SUPPORTED_TOKENS } from "@/lib/token-utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toastManager } from "@/lib/toast"
import { isMultiToken } from "@/lib/deposit-token"
import { Loader2, Coins, Plus, X } from "lucide-react"

interface SupportedTokensSettingsProps {
  poolId: string
  contractAddress: string
  isAdmin: boolean
  /** Pool's canonical settlement token address ("native" or C…). */
  poolTokenAddress: string
}

/**
 * Admin panel for configuring which SEP-41 assets a pool accepts as deposits.
 * Mirrors the contract's `set_supported_tokens` (replace semantics): the admin
 * selects from the well-known registry (XLM, USDC) plus any custom C…
 * contract ids, the choice is written on-chain via the wallet, and then
 * persisted to Supabase so the deposit UI reflects it.
 */
export function SupportedTokensSettings({
  poolId,
  contractAddress,
  isAdmin,
  poolTokenAddress,
}: SupportedTokensSettingsProps) {
  const { address } = useStellar()
  const { setSupportedTokens, isLoading } = useSetSupportedTokens(contractAddress)

  const [selected, setSelected] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [customInput, setCustomInput] = useState("")
  const [saving, setSaving] = useState(false)
  const [persisted, setPersisted] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchSupportedTokens(contractAddress)
      .then((list) => {
        if (cancelled) return
        // If the allowlist is empty, default to the pool's own settlement token.
        setSelected(list.length > 0 ? list : [poolTokenAddress])
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [contractAddress, poolTokenAddress])

  const registryIds = SUPPORTED_TOKENS.map((t) =>
    t.contractAddress === "native" ? "native" : t.contractAddress
  )
  const customIds = selected.filter((id) => !registryIds.includes(id.toUpperCase()))

  const toggle = (id: string) => {
    setPersisted(false)
    setSelected((prev) =>
      prev.map((x) => x.toUpperCase()).includes(id.toUpperCase())
        ? prev.filter((x) => x.toUpperCase() !== id.toUpperCase())
        : [...prev, id]
    )
  }

  const addCustom = () => {
    const id = customInput.trim().toUpperCase()
    if (!id || !/^C[A-Z2-7]{55}$/.test(id)) {
      toastManager.error("Enter a valid C… SEP-41 token contract id")
      return
    }
    setPersisted(false)
    setSelected((prev) => (prev.map((x) => x.toUpperCase()).includes(id) ? prev : [...prev, id]))
    setCustomInput("")
  }

  const handleSave = async () => {
    if (!address || !isAdmin) {
      toastManager.error("Only the pool admin can change supported tokens.")
      return
    }
    setSaving(true)
    try {
      const txHash = await setSupportedTokens(selected)
      const res = await fetch("/api/pools/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId,
          callerAddress: address,
          supportedTokens: selected,
          txHash,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to save")
      setPersisted(true)
      toastManager.success(
        `Supported tokens updated (${selected.length}). ${isMultiToken(selected) ? "Pool now accepts multiple assets." : ""}`
      )
    } catch (err) {
      toastManager.error(err instanceof Error ? err.message : "Failed to update tokens")
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading supported tokens…
      </div>
    )
  }

  const busy = isLoading || saving

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Accepted deposit tokens</Label>
        {SUPPORTED_TOKENS.map((token) => {
          const id = token.contractAddress === "native" ? "native" : token.contractAddress
          const checked = selected.map((x) => x.toUpperCase()).includes(id.toUpperCase())
          return (
            <label
              key={id}
              className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 cursor-pointer"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(id)}
                aria-label={`Toggle ${token.symbol}`}
              />
              <span className="text-sm font-medium">
                {token.icon} {token.symbol}
              </span>
              <span className="text-xs text-muted-foreground">{token.name}</span>
            </label>
          )
        })}
      </div>

      {customIds.length > 0 && (
        <div className="space-y-1.5">
          <Label>Custom tokens</Label>
          {customIds.map((id) => (
            <div
              key={id}
              className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2"
            >
              <span className="text-xs font-mono truncate">{id}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggle(id)}
                disabled={busy}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          placeholder="C… SEP-41 contract id"
          disabled={busy}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" onClick={addCustom} disabled={busy}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Button
        type="button"
        onClick={handleSave}
        disabled={busy || !isAdmin || !address}
        className="gap-2"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
        {busy ? "Saving…" : persisted ? "Saved" : "Save supported tokens"}
      </Button>
      {!isAdmin && (
        <p className="text-xs text-muted-foreground">Only the pool admin can change this.</p>
      )}
    </div>
  )
}
