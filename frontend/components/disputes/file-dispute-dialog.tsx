"use client"

/**
 * FileDisputeDialog — member-facing form to raise a dispute (issue #208).
 * Type select, optional target member, description with live character
 * counter, and up to three evidence URLs.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DISPUTE_DESCRIPTION_MAX_LENGTH, DISPUTE_MAX_EVIDENCE_URLS } from "@/lib/disputes"

const DISPUTE_TYPES = [
  "missed_deposit",
  "unfair_penalty",
  "admin_abuse",
  "member_misconduct",
  "other",
] as const

interface FileDisputeDialogProps {
  disabled: boolean
  memberAddresses: string[]
  submitting: boolean
  onSubmit: (input: {
    disputeType: string
    description: string
    targetAddress?: string
    evidenceUrls?: string[]
  }) => Promise<boolean>
}

export function FileDisputeDialog({
  disabled,
  memberAddresses,
  submitting,
  onSubmit,
}: FileDisputeDialogProps) {
  const t = useTranslations("group.disputes")
  const [open, setOpen] = useState(false)
  const [disputeType, setDisputeType] = useState<string>("")
  const [targetAddress, setTargetAddress] = useState<string>("none")
  const [description, setDescription] = useState("")
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([""])
  const [formError, setFormError] = useState<string | null>(null)

  const reset = () => {
    setDisputeType("")
    setTargetAddress("none")
    setDescription("")
    setEvidenceUrls([""])
    setFormError(null)
  }

  const handleSubmit = async () => {
    if (!disputeType || !description.trim()) return
    const urls = evidenceUrls.map((u) => u.trim()).filter(Boolean)
    if (urls.some((u) => !/^https?:\/\//i.test(u))) {
      setFormError(t("invalidUrl"))
      return
    }
    const ok = await onSubmit({
      disputeType,
      description: description.trim(),
      targetAddress: targetAddress === "none" ? undefined : targetAddress,
      evidenceUrls: urls.length > 0 ? urls : undefined,
    })
    if (ok) {
      reset()
      setOpen(false)
    } else {
      setFormError(t("submitFailed"))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Flag className="mr-1.5 h-4 w-4" />
          {t("fileDispute")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("fileTitle")}</DialogTitle>
          <DialogDescription>{t("fileDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dispute-type">{t("typeLabel")}</Label>
            <Select value={disputeType} onValueChange={setDisputeType}>
              <SelectTrigger id="dispute-type">
                <SelectValue placeholder={t("typePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {DISPUTE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dispute-target">{t("targetLabel")}</Label>
            <Select value={targetAddress} onValueChange={setTargetAddress}>
              <SelectTrigger id="dispute-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("targetNone")}</SelectItem>
                {memberAddresses.map((addr) => (
                  <SelectItem key={addr} value={addr}>
                    {addr.slice(0, 8)}…{addr.slice(-6)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="dispute-description">{t("descriptionLabel")}</Label>
              <span className="text-xs text-muted-foreground">
                {description.length}/{DISPUTE_DESCRIPTION_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="dispute-description"
              value={description}
              onChange={(e) =>
                setDescription(e.target.value.slice(0, DISPUTE_DESCRIPTION_MAX_LENGTH))
              }
              placeholder={t("descriptionPlaceholder")}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("evidenceLabel")}</Label>
            {evidenceUrls.map((url, i) => (
              <Input
                key={i}
                value={url}
                onChange={(e) => {
                  const next = [...evidenceUrls]
                  next[i] = e.target.value
                  setEvidenceUrls(next)
                }}
                placeholder="https://…"
              />
            ))}
            {evidenceUrls.length < DISPUTE_MAX_EVIDENCE_URLS && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEvidenceUrls((prev) => [...prev, ""])}
              >
                + {t("addEvidence")}
              </Button>
            )}
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!disputeType || !description.trim() || submitting}
          >
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
