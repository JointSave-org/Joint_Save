"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  GOVERNANCE_DESCRIPTION_MAX,
  PROPOSAL_TYPES,
  buildYieldAllocationParams,
  encodeParamHex,
  parseAmountToBaseUnits,
  type GovernanceProposalType,
  type YieldAllocationAction,
} from "@/lib/governance"

interface CreateProposalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  poolType: string
  onSubmit: (
    proposalType: GovernanceProposalType,
    description: string,
    paramsHex: Record<string, string>
  ) => Promise<boolean>
}

const APPLICABLE_POOL_TYPES: Record<string, string[]> = {
  ChangeDepositAmount: ["flexible", "rotational"],
  ExtendDeadline: ["rotational", "target"],
  AddPenalty: ["flexible", "rotational", "target"],
  RemovePenalty: ["flexible", "rotational", "target"],
  ChangeQuorum: ["flexible", "rotational", "target"],
  YieldAllocation: ["flexible"],
}

const YIELD_DECIMALS = 7

export function CreateProposalDialog({
  open,
  onOpenChange,
  poolType,
  onSubmit,
}: CreateProposalDialogProps) {
  const t = useTranslations("governance")

  const availableTypes = useMemo(
    () => PROPOSAL_TYPES.filter((p) => APPLICABLE_POOL_TYPES[p.value]?.includes(poolType)),
    [poolType]
  )

  const [proposalType, setProposalType] = useState<GovernanceProposalType | "">("")
  const [description, setDescription] = useState("")
  const [paramValue, setParamValue] = useState("")
  const [yieldAction, setYieldAction] = useState<YieldAllocationAction>("alloc")
  const [vaultId, setVaultId] = useState("")
  const [yieldAmount, setYieldAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isYield = proposalType === "YieldAllocation"
  const selectedMeta = availableTypes.find((p) => p.value === proposalType) ?? null
  const needsParam = !!selectedMeta?.paramKey

  const reset = () => {
    setProposalType("")
    setDescription("")
    setParamValue("")
    setYieldAction("alloc")
    setVaultId("")
    setYieldAmount("")
    setSubmitting(false)
    setError(null)
  }

  const handleClose = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const canSubmit = isYield
    ? description.trim().length > 0 &&
      !!yieldAmount &&
      (yieldAction === "dealloc" || vaultId.trim().length > 0)
    : !!proposalType && description.trim().length > 0 && (!needsParam || !!paramValue)

  const handleSubmit = async () => {
    if (!canSubmit) {
      setError(t("fillRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let submitType: GovernanceProposalType = proposalType as GovernanceProposalType
      let params: Record<string, string> = {}
      if (isYield) {
        params = buildYieldAllocationParams({
          action: yieldAction,
          vault: yieldAction === "alloc" ? vaultId.trim() : undefined,
          amountBaseUnits: parseAmountToBaseUnits(yieldAmount, YIELD_DECIMALS),
        })
        submitType = "Custom"
      } else if (needsParam) {
        params = {
          [selectedMeta!.paramKey]: encodeParamHex(Number(paramValue.replace(/,/g, ""))),
        }
      }
      const ok = await onSubmit(submitType, description.trim(), params)
      if (!ok) {
        setError(t("toastError"))
        setSubmitting(false)
        return
      }
      reset()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("toastError"))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("createProposal")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="proposal-type">{t("typeLabel")}</Label>
            <Select
              value={proposalType}
              onValueChange={(v) => {
                setProposalType(v as GovernanceProposalType)
                setParamValue("")
              }}
            >
              <SelectTrigger id="proposal-type" className="w-full">
                <SelectValue placeholder={t("typeLabel")} />
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {t(`types.${p.value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsParam && (
            <div className="space-y-2">
              <Label htmlFor="proposal-param">{selectedMeta!.paramLabel}</Label>
              <Input
                id="proposal-param"
                type="number"
                min="0"
                value={paramValue}
                onChange={(e) => setParamValue(e.target.value)}
                placeholder="0"
              />
            </div>
          )}

          {isYield && (
            <>
              <div className="space-y-2">
                <Label htmlFor="yield-action">{t("yield.actionLabel")}</Label>
                <Select
                  value={yieldAction}
                  onValueChange={(v) => setYieldAction(v as YieldAllocationAction)}
                >
                  <SelectTrigger id="yield-action" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alloc">{t("yield.alloc")}</SelectItem>
                    <SelectItem value="dealloc">{t("yield.dealloc")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {yieldAction === "alloc" && (
                <div className="space-y-2">
                  <Label htmlFor="yield-vault">{t("yield.vaultLabel")}</Label>
                  <Input
                    id="yield-vault"
                    value={vaultId}
                    onChange={(e) => setVaultId(e.target.value)}
                    placeholder="C..."
                    spellCheck={false}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="yield-amount">{t("yield.amountLabel")}</Label>
                <Input
                  id="yield-amount"
                  type="number"
                  min="0"
                  value={yieldAmount}
                  onChange={(e) => setYieldAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="proposal-description">{t("descriptionLabel")}</Label>
              <span
                className={`text-xs ${
                  description.length > GOVERNANCE_DESCRIPTION_MAX
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {t("charCount", { count: description.length, max: GOVERNANCE_DESCRIPTION_MAX })}
              </span>
            </div>
            <Textarea
              id="proposal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, GOVERNANCE_DESCRIPTION_MAX))}
              placeholder={t("descriptionPlaceholder")}
              rows={4}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
