"use client"

import { useState } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toastManager } from "@/lib/toast"
import {
  type PoolTemplateConfig,
  type TemplatePoolType,
  validateTemplateName,
  validateTemplateDescription,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
} from "@/lib/templates"

const POOL_TYPE_LABELS: Record<TemplatePoolType, string> = {
  rotational: "Rotational Savings",
  target: "Target Pool",
  flexible: "Flexible Pool",
}

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
]

/**
 * "Create Template" dialog on the templates page (issue #226). Lets a user
 * build a reusable template from scratch without first creating a pool.
 */
export function CreateTemplateDialog({
  open,
  onOpenChange,
  address,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  address: string | null
  onSaved: () => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [poolType, setPoolType] = useState<TemplatePoolType>("rotational")
  const [amount, setAmount] = useState("")
  const [targetAmount, setTargetAmount] = useState("")
  const [minimumDeposit, setMinimumDeposit] = useState("")
  const [frequency, setFrequency] = useState("weekly")
  const [withdrawalFee, setWithdrawalFee] = useState("1")
  const [enableYield, setEnableYield] = useState(false)
  const [deadlineDays, setDeadlineDays] = useState("")
  const [membersText, setMembersText] = useState("")
  const [isPublic, setIsPublic] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({})

  const handleSave = async () => {
    if (!address) {
      toastManager.error("Connect your wallet before creating a template")
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

    const config: PoolTemplateConfig = {
      name: name.trim(),
      description: description.trim() || null,
      poolType,
      members,
      token: "XLM",
    }
    if (poolType === "rotational") {
      config.amount = amount.trim()
      config.frequency = frequency
    } else if (poolType === "target") {
      config.targetAmount = targetAmount.trim()
      config.deadlineDays = deadlineDays.trim()
    } else {
      config.minimumDeposit = minimumDeposit.trim()
      config.withdrawalFee = withdrawalFee.trim()
      config.enableYield = enableYield
    }

    setSaving(true)
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": address,
        },
        body: JSON.stringify({
          creator_address: address,
          name: name.trim(),
          description: description.trim() || null,
          pool_type: poolType,
          config,
          is_public: isPublic,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to save template")
      }
      toastManager.success("Template created")
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toastManager.error((error as Error).message || "Failed to save template")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Template</DialogTitle>
          <DialogDescription>
            Build a reusable pool configuration from scratch. You can pre-fill the creation form
            with it at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="create-template-name">Template Name</Label>
            <div className="flex items-center gap-2">
              <Input
                id="create-template-name"
                maxLength={TEMPLATE_NAME_MAX_LENGTH}
                placeholder="e.g., Monthly Family Tanda"
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
            <Label htmlFor="create-template-description">Description (optional)</Label>
            <Textarea
              id="create-template-description"
              maxLength={TEMPLATE_DESCRIPTION_MAX_LENGTH}
              placeholder="Describe what this template is for"
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                if (errors.description) setErrors((prev) => ({ ...prev, description: "" }))
              }}
            />
            {errors.description && <FieldError message={errors.description} />}
          </div>

          <div className="space-y-1">
            <Label>Pool Type</Label>
            <Select value={poolType} onValueChange={(v) => setPoolType(v as TemplatePoolType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(POOL_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {poolType === "rotational" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="create-template-amount">Contribution Amount (XLM)</Label>
                <Input
                  id="create-template-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Payout Frequency</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {poolType === "target" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="create-template-target">Target Amount (XLM)</Label>
                <Input
                  id="create-template-target"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="5000"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="create-template-deadline">Deadline (days)</Label>
                <Input
                  id="create-template-deadline"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="30"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(e.target.value)}
                />
              </div>
            </div>
          )}

          {poolType === "flexible" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="create-template-minimum">Minimum Deposit (XLM)</Label>
                <Input
                  id="create-template-minimum"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="50"
                  value={minimumDeposit}
                  onChange={(e) => setMinimumDeposit(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="create-template-fee">Withdrawal Fee (%)</Label>
                <Input
                  id="create-template-fee"
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  placeholder="1"
                  value={withdrawalFee}
                  onChange={(e) => setWithdrawalFee(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between sm:col-span-2 rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="create-template-yield">Enable Yield Generation</Label>
                  <p className="text-sm text-muted-foreground">
                    Stake idle funds in Stellar DeFi protocols for passive income.
                  </p>
                </div>
                <Switch
                  id="create-template-yield"
                  checked={enableYield}
                  onCheckedChange={setEnableYield}
                  aria-label="Enable yield generation"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="create-template-members">Member Addresses (optional)</Label>
            <Textarea
              id="create-template-members"
              placeholder={
                "One Stellar address per line (G…)\nPre-fills the member list when used."
              }
              rows={3}
              value={membersText}
              onChange={(e) => setMembersText(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="create-template-public">Share with community</Label>
              <p className="text-sm text-muted-foreground">
                Public templates appear in the Community Templates tab.
              </p>
            </div>
            <Switch
              id="create-template-public"
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
              "Create Template"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
