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
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { FieldError } from "@/components/ui/form"
import { Loader2 } from "lucide-react"
import { toastManager } from "@/lib/toast"
import {
  type PoolTemplateConfig,
  validateTemplateName,
  validateTemplateDescription,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
} from "@/lib/templates"

/**
 * "Save as Template" dialog (issue #226). Opened from the pool creation
 * forms — saves the current pool configuration as a reusable template.
 */
export function SaveTemplateDialog({
  open,
  onOpenChange,
  config,
  creatorAddress,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: PoolTemplateConfig
  creatorAddress: string | null
}) {
  const [name, setName] = useState(config.name)
  const [description, setDescription] = useState(config.description || "")
  const [isPublic, setIsPublic] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({})

  useEffect(() => {
    if (open) {
      setName(config.name)
      setDescription(config.description || "")
      setIsPublic(false)
      setErrors({})
    }
  }, [open, config])

  const handleSave = async () => {
    if (!creatorAddress) {
      toastManager.error("Connect your wallet before saving a template")
      return
    }
    const nameResult = validateTemplateName(name)
    const descriptionResult = validateTemplateDescription(description)
    setErrors({
      name: nameResult.valid ? "" : nameResult.message,
      description: descriptionResult.valid ? "" : descriptionResult.message,
    })
    if (!nameResult.valid || !descriptionResult.valid) return

    setSaving(true)
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": creatorAddress,
        },
        body: JSON.stringify({
          creator_address: creatorAddress,
          name: name.trim(),
          description: description.trim() || null,
          pool_type: config.poolType,
          config,
          is_public: isPublic,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Failed to save template")
      }
      toastManager.success("Template saved")
      onOpenChange(false)
    } catch (error) {
      toastManager.error((error as Error).message || "Failed to save template")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>
            Reuse this pool configuration later — or share it with the community — without
            re-entering every field.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="template-name">Template Name</Label>
            <div className="flex items-center gap-2">
              <Input
                id="template-name"
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
            <Label htmlFor="template-description">Description (optional)</Label>
            <Textarea
              id="template-description"
              maxLength={TEMPLATE_DESCRIPTION_MAX_LENGTH}
              placeholder="Describe what this template is for"
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                if (errors.description) setErrors((prev) => ({ ...prev, description: "" }))
              }}
            />
            {errors.description && <FieldError message={errors.description} />}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="template-public">Share with community</Label>
              <p className="text-sm text-muted-foreground">
                Public templates appear in the Community Templates tab.
              </p>
            </div>
            <Switch
              id="template-public"
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
          <Button onClick={handleSave} disabled={saving || !creatorAddress}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Template"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
