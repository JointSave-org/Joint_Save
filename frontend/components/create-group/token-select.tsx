"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Link } from "@/i18n/navigation"
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
import { SUPPORTED_TOKENS } from "@/lib/token-utils"

/** What the parent form needs to create a pool with the chosen token. */
export interface SelectedToken {
  /** "native" or a `C…` token contract id (stored on the pool row as-is). */
  address: string
  symbol: string
  decimals: number
}

const NATIVE: SelectedToken = { address: "native", symbol: "XLM", decimals: 7 }
const USDC_TOKEN = SUPPORTED_TOKENS.find((t) => t.symbol === "USDC")!
const USDC: SelectedToken = {
  address: USDC_TOKEN.contractAddress,
  symbol: USDC_TOKEN.symbol,
  decimals: USDC_TOKEN.decimals,
}
const isValidContractId = (id: string) => /^C[A-Z2-7]{55}$/.test(id)

type TokenMode = "native" | "usdc" | "custom"

/**
 * Map a template/duplicate prefill token string ("XLM", "USDC", or a SEP-41
 * contract id) to the `SelectedToken` a creation form seeds its state with.
 * Returns undefined when the value can't be mapped to a known token.
 */
export function tokenFromPrefill(token: string | undefined): SelectedToken | undefined {
  if (!token) return undefined
  if (token === "XLM") return NATIVE
  if (token === "USDC") return USDC
  if (isValidContractId(token)) return { address: token, symbol: "CUSTOM", decimals: 7 }
  return undefined
}

/**
 * Token picker shared by all three creation forms. Defaults to native XLM;
 * "USDC" uses the well-known registry entry from `lib/token-utils` directly
 * (see the bridge tutorial at /bridge for getting USDC onto Stellar first).
 * "Custom token" resolves any other SEP-41 token's name/symbol/decimals via a
 * view call and reports the resolved `SelectedToken` to the parent. The
 * parent should also seed its own state to native XLM so submit works
 * without interaction.
 *
 * Pass an optional `defaultToken` (e.g. from a template) to have the picker
 * reflect a pre-filled token instead of defaulting to XLM.
 */
export function TokenSelect({
  onChange,
  defaultToken,
}: {
  onChange: (token: SelectedToken) => void
  defaultToken?: SelectedToken
}) {
  const t = useTranslations("pool.create.tokenSelect")
  const [mode, setMode] = useState<TokenMode>("native")
  const [customId, setCustomId] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle")
  const [meta, setMeta] = useState<TokenMetadata | null>(null)
  const [error, setError] = useState("")

  // Reflect a pre-filled token (from a template) on mount.
  useEffect(() => {
    if (!defaultToken) return
    if (defaultToken.address === "native") {
      setMode("native")
      onChange(NATIVE)
    } else if (defaultToken.address === USDC.address) {
      setMode("usdc")
      onChange(USDC)
    } else if (isValidContractId(defaultToken.address)) {
      setMode("custom")
      setCustomId(defaultToken.address)
      fetchTokenMetadata(defaultToken.address)
        .then((m) => {
          setMeta(m)
          setStatus("ok")
          onChange({
            address: defaultToken.address,
            symbol: m.symbol,
            decimals: m.decimals,
          })
        })
        .catch(() => {
          setStatus("error")
          setError(t("couldNotReadToken"))
        })
    }
  }, [defaultToken, onChange, t])

  const handleMode = (v: string) => {
    const next = v as TokenMode
    setMode(next)
    setError("")
    setMeta(null)
    setStatus("idle")
    if (next === "native") {
      setCustomId("")
      onChange(NATIVE)
    } else if (next === "usdc") {
      setCustomId("")
      onChange(USDC)
    }
  }

  const resolveCustom = async () => {
    const id = customId.trim().toUpperCase()
    if (!id) return
    if (!isValidContractId(id)) {
      setStatus("error")
      setError(t("invalidContractId"))
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
      setError(t("couldNotReadToken"))
    }
  }

  return (
    <div className="space-y-2">
      <FieldTooltip label={t("depositCurrency")} tooltip={t("depositCurrencyTooltip")} required />
      <Select value={mode} onValueChange={handleMode}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="native">{t("xlmNative")}</SelectItem>
          <SelectItem value="usdc">USDC</SelectItem>
          <SelectItem value="custom">{t("customToken")}</SelectItem>
        </SelectContent>
      </Select>

      {mode === "usdc" && (
        <p className="text-xs text-muted-foreground">
          {t.rich("usdcNotice", {
            link: (chunks) => (
              <Link href="/bridge" className="text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {mode === "custom" && (
        <div className="space-y-1">
          <Input
            placeholder={t("contractIdPlaceholder")}
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
              <Loader2 className="h-3 w-3 animate-spin" /> {t("readingToken")}
            </p>
          )}
          {status === "ok" && meta && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {t("tokenResolved", {
                name: meta.name,
                symbol: meta.symbol,
                decimals: meta.decimals,
              })}
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
