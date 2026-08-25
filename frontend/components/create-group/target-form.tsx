"use client"

import type React from "react"
import { useState, useCallback, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Plus, X, Loader2, Info, CopyPlus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import {
  useDeployPool,
  useInitializePool,
  useRegisterPool,
  getRpc,
  resolveTokenAddress,
} from "@/hooks/useJointSaveContracts"
import {
  TokenSelect,
  tokenFromPrefill,
  type SelectedToken,
} from "@/components/create-group/token-select"
import BulkImport from "@/components/create-group/BulkImport"
import { FieldTooltip } from "@/components/ui/field-tooltip"
import { FieldError } from "@/components/ui/form"
import { FormProgress, type ProgressField } from "@/components/ui/form-progress"
import {
  validateGroupName,
  validateStellarAddress,
  validatePositiveAmount,
  findDuplicateAddresses,
  type ValidationMessages,
} from "@/lib/form-validation"
import { MAX_POOL_MEMBERS, MAX_DEADLINE_DAYS } from "@/lib/constants"
import type { DuplicatePrefill } from "@/app/[locale]/dashboard/create/[type]/page"
import type { PoolTemplateConfig } from "@/lib/templates"
import { SaveTemplateDialog } from "@/components/templates/save-template-dialog"
import { toastManager } from "@/lib/toast"
import { LayoutTemplate } from "lucide-react"

function isValidStellarAddress(addr: string) {
  return /^G[A-Z2-7]{55}$/.test(addr)
}

// Stellar: ~6 seconds per ledger
const SECONDS_PER_LEDGER = 6

function daysToLedgers(days: number): number {
  return Math.floor((days * 24 * 60 * 60) / SECONDS_PER_LEDGER)
}

type FieldErrors = Partial<Record<"name" | "targetAmount" | "deadlineDays", string>>
type Touched = Partial<Record<"name" | "targetAmount" | "deadlineDays", boolean>>

export function TargetForm({ prefill }: { prefill?: DuplicatePrefill }) {
  const t = useTranslations("pool.create.target")
  const tc = useTranslations("pool.create.common")
  const tv = useTranslations("pool.create.validation")
  const router = useRouter()
  const { address } = useStellar()
  const [token, setToken] = useState<SelectedToken>(
    tokenFromPrefill(prefill?.token) ?? { address: "native", symbol: "XLM", decimals: 7 }
  )
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const initialMembers = prefill?.members?.filter((m: string) => m !== address) ?? [""]
  const [members, setMembers] = useState<string[]>(
    initialMembers.length > 0 ? initialMembers : [""]
  )
  const [step, setStep] = useState<
    "idle" | "deploying" | "initializing" | "registering" | "saving"
  >("idle")
  const [formData, setFormData] = useState({
    name: prefill?.name || "",
    description: prefill?.description || "",
    targetAmount: prefill?.targetAmount || "",
    deadlineDays: prefill?.deadlineDays || "",
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Touched>({})
  const [currentLedger, setCurrentLedger] = useState<number | null>(null)

  useEffect(() => {
    getRpc()
      .getLatestLedger()
      .then((l) => setCurrentLedger(l.sequence))
      .catch(() => {})
  }, [])

  const { deploy } = useDeployPool()
  const { initTarget } = useInitializePool()
  const { register } = useRegisterPool("target")

  const validationMessages: ValidationMessages = {
    groupNameRequired: tv("groupNameRequired"),
    groupNameTooShort: tv("groupNameTooShort"),
    groupNameTooLong: tv("groupNameTooLong"),
    addressRequired: tv("addressRequired"),
    addressMustStartWithG: tv("addressMustStartWithG"),
    addressWrongLength: (length) => tv("addressWrongLength", { length }),
    addressInvalidChars: tv("addressInvalidChars"),
    addressInvalidChecksum: tv("addressInvalidChecksum"),
    amountRequired: (label) => tv("amountRequired", { label }),
    amountInvalidNumber: (label) => tv("amountInvalidNumber", { label }),
    amountMustBePositive: (label) => tv("amountMustBePositive", { label }),
  }

  const allMembers = address ? [address, ...members] : members
  const validMembers = Array.from(new Set(allMembers.filter(isValidStellarAddress)))
  const duplicateIndices = findDuplicateAddresses(allMembers)
  const memberErrors = members.map((m, i) => {
    if (!m) return ""
    const format = validateStellarAddress(m, validationMessages)
    if (!format.valid) return format.message
    const allMembersIndex = address ? i + 1 : i
    return duplicateIndices.has(allMembersIndex) ? tv("duplicateAddress") : ""
  })
  const isCreating = step !== "idle"
  const isMemberLimitReached = members.length >= MAX_POOL_MEMBERS

  const validateField = useCallback(
    (name: keyof FieldErrors, value: string) => {
      let message = ""
      if (name === "name") message = validateGroupName(value, validationMessages).message
      else if (name === "targetAmount")
        message = validatePositiveAmount(
          value,
          t("targetAmountFieldLabel"),
          validationMessages
        ).message
      else if (name === "deadlineDays") {
        const d = parseInt(value)
        if (!value) message = tv("deadlineRequired")
        else if (isNaN(d) || d < 1) message = t("deadlineTooShort")
        else if (d > MAX_DEADLINE_DAYS)
          message = t("deadlineTooLong", { years: MAX_DEADLINE_DAYS / 365 })
      }
      setFieldErrors((prev) => ({ ...prev, [name]: message }))
    },
    [t, tv, validationMessages]
  )

  const handleBlur = (name: keyof FieldErrors, value: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }))
    validateField(name, value)
  }

  const updateMember = (i: number, v: string) => {
    const next = [...members]
    next[i] = v
    setMembers(next)
  }

  const addMember = () => {
    if (isMemberLimitReached) return
    setMembers([...members, ""])
  }
  const removeMember = (i: number) => {
    setMembers(members.filter((_, idx) => idx !== i))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setTouched({ name: true, targetAmount: true, deadlineDays: true })
    const nameResult = validateGroupName(formData.name, validationMessages)
    const amountResult = validatePositiveAmount(
      formData.targetAmount,
      t("targetAmountFieldLabel"),
      validationMessages
    )
    const deadlineDays = parseInt(formData.deadlineDays)
    const deadlineDaysValid =
      formData.deadlineDays &&
      !isNaN(deadlineDays) &&
      deadlineDays >= 1 &&
      deadlineDays <= MAX_DEADLINE_DAYS
    setFieldErrors({
      name: nameResult.message,
      targetAmount: amountResult.message,
      deadlineDays: deadlineDaysValid
        ? ""
        : formData.deadlineDays
          ? t("deadlineOutOfRange", { max: MAX_DEADLINE_DAYS })
          : tv("deadlineRequired"),
    })

    if (!address) return toastManager.error(tc("connectWalletFirst"))
    if (duplicateIndices.size > 0) return toastManager.error(tc("duplicateMembersFound"))
    if (validMembers.length < 2) return toastManager.error(tc("needAtLeastTwoMembers"))
    if (!nameResult.valid || !amountResult.valid || !deadlineDaysValid) return

    try {
      setStep("deploying")
      const contractId = await deploy("target")

      setStep("initializing")
      // Fetch fresh ledger at submit time for the most accurate deadline
      const ledger = await getRpc().getLatestLedger()
      const deadlineLedger = ledger.sequence + daysToLedgers(deadlineDays)
      await initTarget(contractId, {
        token: resolveTokenAddress(token.address),
        decimals: token.decimals,
        admin: address,
        members: validMembers,
        targetAmount: formData.targetAmount,
        deadlineLedger,
      })

      // Register with factory (best-effort — factory must be initialized by admin)
      setStep("registering")
      try {
        await register(address, contractId)
      } catch (regErr: unknown) {
        console.warn("Factory registration skipped:", (regErr as Error).message)
      }

      // Derive ISO deadline from days so the DB has a human-readable date
      const estimatedDeadlineISO = new Date(
        Date.now() + deadlineDays * 24 * 60 * 60 * 1000
      ).toISOString()

      setStep("saving")
      const res = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          poolType: "target",
          creatorAddress: address,
          poolAddress: contractId,
          tokenAddress: token.address,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          members: validMembers,
          targetAmount: formData.targetAmount,
          deadline: estimatedDeadlineISO,
        }),
      })
      if (!res.ok) throw new Error(tc("failedToSaveMetadata"))
      const pool = await res.json()
      router.push(`/dashboard/group/${pool.id}`)
    } catch (err: unknown) {
      toastManager.error((err as Error).message || tc("failedToCreateGroup"))
      setStep("idle")
    }
  }

  const stepLabel: Record<typeof step, string> = {
    idle: t("stepIdle"),
    deploying: t("stepDeploying"),
    initializing: t("stepInitializing"),
    registering: t("stepRegistering"),
    saving: t("stepSaving"),
  }

  const contributionPerMember =
    validMembers.length > 0
      ? (parseFloat(formData.targetAmount || "0") / validMembers.length).toFixed(2)
      : "0"

  const days = parseInt(formData.deadlineDays) || 0
  const estimatedDeadlineLedger =
    currentLedger !== null && days > 0 ? currentLedger + daysToLedgers(days) : null

  const progressFields: ProgressField[] = [
    { label: tc("progressGroupName"), valid: validateGroupName(formData.name).valid },
    {
      label: t("targetAmountFieldLabel"),
      valid: validatePositiveAmount(formData.targetAmount, "Amount").valid,
    },
    { label: t("deadlineDaysLabel"), valid: days >= 1 && days <= MAX_DEADLINE_DAYS },
    { label: tc("progressMembers"), valid: validMembers.length >= 2 },
  ]

  const templateToken = token.address === "native" ? "XLM" : token.address
  const templateConfig: PoolTemplateConfig = {
    name: formData.name,
    description: formData.description || null,
    poolType: "target",
    targetAmount: formData.targetAmount,
    deadlineDays: formData.deadlineDays,
    members: validMembers,
    token: templateToken,
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {isCreating && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
          <p className="text-sm">{tc("approveWalletPrompt", { step: stepLabel[step] })}</p>
        </div>
      )}

      <FormProgress fields={progressFields} />

      {prefill && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
          <CopyPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>{t.rich("prefillNotice", { strong: (chunks) => <strong>{chunks}</strong> })}</span>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <FieldTooltip
            htmlFor="name"
            label={tc("groupNameLabel")}
            tooltip={t("groupNameTooltip")}
            required
          />
          <span
            className={`text-xs tabular-nums ${formData.name.length > 45 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formData.name.length}/50
          </span>
        </div>
        <Input
          id="name"
          placeholder={t("groupNamePlaceholder")}
          maxLength={50}
          value={formData.name}
          onChange={(e) => {
            setFormData({ ...formData, name: e.target.value })
            if (touched.name) validateField("name", e.target.value)
          }}
          onBlur={(e) => handleBlur("name", e.target.value)}
        />
        {touched.name && <FieldError message={fieldErrors.name} />}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <FieldTooltip
            htmlFor="description"
            label={tc("descriptionLabel")}
            tooltip={t("descriptionTooltip")}
          />
          <span
            className={`text-xs tabular-nums ${formData.description.length > 270 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formData.description.length}/300
          </span>
        </div>
        <Textarea
          id="description"
          placeholder={t("descriptionPlaceholder")}
          maxLength={300}
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={3}
        />
      </div>

      <TokenSelect onChange={setToken} defaultToken={tokenFromPrefill(prefill?.token)} />
      {/* Bulk Import Component */}
      <BulkImport onMembersChange={setMembers} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <FieldTooltip
            htmlFor="target"
            label={t("targetAmountLabel", { symbol: token.symbol })}
            tooltip={t("targetAmountTooltip")}
            required
          />
          <Input
            id="target"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="5000"
            value={formData.targetAmount}
            onChange={(e) => {
              setFormData({ ...formData, targetAmount: e.target.value })
              if (touched.targetAmount) validateField("targetAmount", e.target.value)
            }}
            onBlur={(e) => handleBlur("targetAmount", e.target.value)}
          />
          {touched.targetAmount && <FieldError message={fieldErrors.targetAmount} />}
        </div>

        <div className="space-y-1">
          <FieldTooltip
            htmlFor="deadlineDays"
            label={t("deadlineDaysLabel")}
            tooltip={t("deadlineDaysTooltip")}
            required
          />
          <Input
            id="deadlineDays"
            type="number"
            min="1"
            max={String(MAX_DEADLINE_DAYS)}
            step="1"
            placeholder="30"
            value={formData.deadlineDays}
            onChange={(e) => {
              setFormData({ ...formData, deadlineDays: e.target.value })
              if (touched.deadlineDays) validateField("deadlineDays", e.target.value)
            }}
            onBlur={(e) => handleBlur("deadlineDays", e.target.value)}
          />
          {days > 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              {estimatedDeadlineLedger
                ? t("ledgerEstimate", {
                    ledger: estimatedDeadlineLedger.toLocaleString(),
                    date: new Date(Date.now() + days * 86_400_000).toLocaleDateString(),
                  })
                : t("fetchingLedger")}
            </p>
          )}
          {touched.deadlineDays && <FieldError message={fieldErrors.deadlineDays} />}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <FieldTooltip
            label={tc("memberAddressesLabel")}
            tooltip={t("memberAddressesTooltip")}
            required
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addMember}
            disabled={isMemberLimitReached}
            aria-describedby={isMemberLimitReached ? "target-member-limit" : undefined}
          >
            <Plus className="h-4 w-4 mr-1" />
            {tc("addMember")}
          </Button>
        </div>
        {isMemberLimitReached && (
          <p id="target-member-limit" className="text-xs text-muted-foreground">
            {tc("maxMembersReached", { max: MAX_POOL_MEMBERS })}
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex gap-2 items-center">
              <Input
                value={address || tc("connectWalletPlaceholder")}
                readOnly
                disabled
                className="font-mono text-xs opacity-70"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {tc("youLabel")}
              </span>
            </div>
            {!address && <p className="text-xs text-amber-600">{tc("connectWalletToBeMember")}</p>}
          </div>

          {members.map((member, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2">
                <Input
                  placeholder={tc("addressPlaceholder")}
                  value={member}
                  onChange={(e) => updateMember(i, e.target.value)}
                  className={
                    memberErrors[i]
                      ? "border-destructive"
                      : member && isValidStellarAddress(member)
                        ? "border-green-500"
                        : ""
                  }
                />
                {members.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeMember(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {memberErrors[i] && <FieldError message={memberErrors[i]} />}
              {!memberErrors[i] && member && isValidStellarAddress(member) && (
                <p className="text-green-600 text-xs flex items-center gap-1">
                  ✓ {tc("validAddress")}
                </p>
              )}
            </div>
          ))}

          {validMembers.length < 2 && members.some((m) => m) && (
            <p className="text-xs text-muted-foreground">{tc("atLeastTwoMembersRequired")}</p>
          )}
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <div className="bg-muted/30 rounded-lg p-4 mb-6">
          <h4 className="font-semibold mb-2">{tc("summary")}</h4>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>{tc("membersCount", { count: validMembers.length })}</li>
            <li>{t("targetAmountSummary", { amount: formData.targetAmount || "0" })}</li>
            <li>{t("perMemberContribution", { amount: contributionPerMember })}</li>
            <li>
              {t("deadlineSummary", {
                days,
                ledgerSuffix:
                  days > 0 && estimatedDeadlineLedger
                    ? t("ledgerSuffix", { ledger: estimatedDeadlineLedger.toLocaleString() })
                    : "",
              })}
            </li>
          </ul>
        </div>
        <Button
          type="submit"
          className="w-full bg-primary hover:bg-primary/90"
          disabled={isCreating}
        >
          {isCreating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {stepLabel[step]}
            </>
          ) : (
            t("stepIdle")
          )}
        </Button>

        <button
          type="button"
          onClick={() => setSaveTemplateOpen(true)}
          disabled={isCreating}
          className="w-full mt-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <LayoutTemplate className="h-4 w-4" />
          {tc("saveAsTemplate")}
        </button>
      </div>

      <SaveTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        config={templateConfig}
        creatorAddress={address}
      />
    </form>
  )
}
