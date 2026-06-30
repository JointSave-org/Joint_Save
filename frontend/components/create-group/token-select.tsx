"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { FieldTooltip } from "@/components/ui/field-tooltip"
import { fetchTokenMetadata, type TokenMetadata } from "@/hooks/useJointSaveContracts"

/** What the parent form needs to create a pool with the chosen token. */
export interface SelectedToken {
  /** "native" or a `C…` token contract id (stored on the pool row as-is). */
  address: string
  symbol: string
  decimals: number
}

const NATIVE: SelectedToken = { address: "native", symbol: "XLM", decimals: 7 }
const isValidContractId = (id: string) => /^C[A-Z2-7]{55}$/.test(id)

/**
 * Token picker shared by all three creation forms. Defaults to native XLM; when
 * "Custom token" is chosen it resolves the SEP-41 name/symbol/decimals via a view
 * call and reports the resolved `SelectedToken` to the parent. The parent should
 * also seed its own state to native XLM so submit works without interaction.
 */
export function TokenSelect({ onChange }: { onChange: (token: SelectedToken) => void }) {
  const [mode, setMode] = useState<"native" | "custom">("native")
  const [customId, setCustomId] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle")
  const [meta, setMeta] = useState<TokenMetadata | null>(null)
  const [error, setError] = useState("")

  const handleMode = (v: string) => {
    const next = v as "native" | "custom"
    setMode(next)
    setError("")
    setMeta(null)
    setStatus("idle")
    if (next === "native") {
      setCustomId("")
      onChange(NATIVE)
    }
  }

  const resolveCustom = async () => {
    const id = customId.trim().toUpperCase()
    if (!id) return
    if (!isValidContractId(id)) {
      setStatus("error")
      setError("Enter a valid token contract id (starts with C, 56 chars).")
      return
    }
    setStatus("loading")
    setError("")
    try {
      const m = await fetchTokenMetadata(id)
      setMeta(m)
      setStatus("ok")
      onChange({ address: id, symbol: m.symbol, decimals: m.decimals })
    } catch {
      setStatus("error")
      setMeta(null)
      setError("Couldn't read this token — is it a valid SEP-41 contract?")
    }
  }

  return (
    <div className="space-y-2">
      <FieldTooltip
        label="Token"
        tooltip="The asset members deposit. Defaults to native XLM. Choose 'Custom token' to use any SEP-41 token (e.g. USDC) by its contract id."
        required
      />
      <Select value={mode} onValueChange={handleMode}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="native">XLM (native)</SelectItem>
          <SelectItem value="custom">Custom token…</SelectItem>
        </SelectContent>
      </Select>

      {mode === "custom" && (
        <div className="space-y-1">
          <Input
            placeholder="Token contract id (C…)"
            value={customId}
            onChange={(e) => {
              setCustomId(e.target.value)
              setStatus("idle")
              setMeta(null)
              setError("")
            }}
            onBlur={resolveCustom}
            className={
              status === "error" ? "border-destructive" : status === "ok" ? "border-green-500" : ""
            }
          />
          {status === "loading" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading token…
            </p>
          )}
          {status === "ok" && meta && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {meta.name} ({meta.symbol}) · {meta.decimals} decimals
            </p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
