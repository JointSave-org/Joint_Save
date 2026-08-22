"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FieldError } from "@/components/ui/form"
import { Loader2 } from "lucide-react"
import { toastManager } from "@/lib/toast"
import {
  type PoolTemplate,
  validateTemplateName,
  validateTemplateDescription,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
} from "@/lib/templates"

/**
 * Edit dialog for a template the user owns (issue #226). Updates the name,
 * description, visibility, and the serialized pool configuration.
 */
export function EditTemplateDialog({
  template,
  open,
  onOpenChange,
  address,
  onSaved,
}: {
  template: PoolTemplate | null
  open: boolean
  onOpenChange: (open: boolean) => void
  address: string | null
  onSaved: () => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isPublic, setIsPublic] = useState(false)
  const [amount, setAmount] = useState("")
  const [targetAmount, setTargetAmount] = useState("")
  const [minimumDeposit, setMinimumDeposit] = useState("")
  const [frequency, setFrequency] = useState("weekly")
  const [withdrawalFee, setWithdrawalFee] = useState("1")
  const [enableYield, setEnableYield] = useState(false)
  const [deadlineDays, setDeadlineDays] = useState("")
  const [membersText, setMembersText] = useState("")
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({})

  useEffect(() => {
    if (open && template) {
      const config = template.config
      setName(config.name || template.name)
      setDescription(config.description || template.description || "")
      setIsPublic(template.is_public)
      setAmount(config.amount || "")
      setTargetAmount(config.targetAmount || "")
      setMinimumDeposit(config.minimumDeposit || "")
      setFrequency(config.frequency || "weekly")
      setWithdrawalFee(config.withdrawalFee || "1")
      setEnableYield(config.enableYield || false)
      setDeadlineDays(config.deadlineDays || "")
      setMembersText((config.members || []).join("\n"))
      setErrors({})
    }
  }, [open, template])

  if (!template) return null

  const handleSave = async () => {
    if (!address) {
      toastManager.error("Connect your wallet before editing a template")
      return
    }
    const nameResult = validateTemplateName(name)
    const descriptionResult = validateTemplateDescription(description)
    setErrors({
      name: nameResult.valid ? "" : nameResult.message,
      description: descriptionResult.valid ? "" : descriptionResult.message,
    })
    if (!nameResult.valid || !descriptionResult.valid) return

    const members = membersText
      .split(/\n|,/)
      .map((m) => m.trim())
      .filter((m) => /^G[A-Z2-7]{55}$/.test(m))

    const config = {
      ...template.config,
      name: name.trim(),
      description: description.trim() || null,
      members,
    }
    if (template.pool_type === "rotational") {
      config.amount = amount.trim()
      config.frequency = frequency
    } else if (template.pool_type === "target") {
      config.targetAmount = targetAmount.trim()
      config.deadlineDays = deadlineDays.trim()
    } else {
      config.minimumDeposit = minimumDeposit.trim()
      config.withdrawalFee = withdrawalFee.trim()
      config.enableYield = enableYield
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": address,
        },
        body: JSON.stringify({
          wallet: address,
          name: name.trim(),
          description: description.trim() || null,
          config,
          is_public: isPublic,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to update template")
      }
      toastManager.success("Template updated")
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toastManager.error((error as Error).message || "Failed to update template")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Template</DialogTitle>
          <DialogDescription>Update this template's details and configuration.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="edit-template-name">Template Name</Label>
            <div className="flex items-center gap-2">
              <Input
                id="edit-template-name"
                maxLength={TEMPLATE_NAME_MAX_LENGTH}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (errors.name) setErrors((prev) => ({ ...prev, name: "" }))
                }}
              />
              <span
                className={`text-xs tabular-nums shrink-0 ${name.length > 45 ? "text-destructive" : "text-muted-foreground"}`}
              >
                {name.length}/{TEMPLATE_NAME_MAX_LENGTH}
              </span>
            </div>
            {errors.name && <FieldError message={errors.name} />}
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-template-description">Description (optional)</Label>
            <Textarea
              id="edit-template-description"
              maxLength={TEMPLATE_DESCRIPTION_MAX_LENGTH}
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                if (errors.description) setErrors((prev) => ({ ...prev, description: "" }))
              }}
            />
            {errors.description && <FieldError message={errors.description} />}
          </div>

          {template.pool_type === "rotational" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="edit-template-amount">Contribution Amount (XLM)</Label>
                <Input
                  id="edit-template-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-template-frequency">Payout Frequency</Label>
                <Input
                  id="edit-template-frequency"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                />
              </div>
            </div>
          )}

          {template.pool_type === "target" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="edit-template-target">Target Amount (XLM)</Label>
                <Input
                  id="edit-template-target"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-template-deadline">Deadline (days)</Label>
                <Input
                  id="edit-template-deadline"
                  type="number"
                  min="1"
                  step="1"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(e.target.value)}
                />
              </div>
            </div>
          )}

          {template.pool_type === "flexible" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="edit-template-minimum">Minimum Deposit (XLM)</Label>
                <Input
                  id="edit-template-minimum"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={minimumDeposit}
                  onChange={(e) => setMinimumDeposit(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-template-fee">Withdrawal Fee (%)</Label>
                <Input
                  id="edit-template-fee"
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  value={withdrawalFee}
                  onChange={(e) => setWithdrawalFee(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between sm:col-span-2 rounded-lg border border-border p-4">
                <Label htmlFor="edit-template-yield">Enable Yield Generation</Label>
                <Switch
                  id="edit-template-yield"
                  checked={enableYield}
                  onCheckedChange={setEnableYield}
                  aria-label="Enable yield generation"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="edit-template-members">Member Addresses (optional)</Label>
            <Textarea
              id="edit-template-members"
              rows={3}
              value={membersText}
              onChange={(e) => setMembersText(e.target.value)}
              className="font-mono text-xs"
              placeholder="One Stellar address per line (G…)"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="edit-template-public">Share with community</Label>
              <p className="text-sm text-muted-foreground">
                Public templates appear in the Community Templates tab.
              </p>
            </div>
            <Switch
              id="edit-template-public"
              checked={isPublic}
              onCheckedChange={setIsPublic}
              aria-label="Make template public"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !address}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
