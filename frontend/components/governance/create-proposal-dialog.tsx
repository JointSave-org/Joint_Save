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
  encodeParamHex,
  type GovernanceProposalType,
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
}

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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMeta = availableTypes.find((p) => p.value === proposalType) ?? null
  const needsParam = !!selectedMeta?.paramKey

  const reset = () => {
    setProposalType("")
    setDescription("")
    setParamValue("")
    setSubmitting(false)
    setError(null)
  }

  const handleClose = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async () => {
    if (!proposalType || description.trim().length === 0 || (needsParam && !paramValue)) {
      setError(t("fillRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let params: Record<string, string> = {}
      if (needsParam) {
        params = {
          [selectedMeta!.paramKey]: encodeParamHex(Number(paramValue.replace(/,/g, ""))),
        }
      }
      const ok = await onSubmit(proposalType, description.trim(), params)
      if (!ok) {
        setError(t("toastError"))
        setSubmitting(false)
        return
      }
      reset()
      onOpenChange(false)
    } catch {
      setError(t("toastError"))
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
            disabled={
              submitting ||
              !proposalType ||
              description.trim().length === 0 ||
              (needsParam && !paramValue)
            }
          >
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
