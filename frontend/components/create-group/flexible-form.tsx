"use client"

import type React from "react"
import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Plus, X, Loader2, CopyPlus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import {
  useDeployPool,
  useInitializePool,
  useRegisterPool,
  resolveTokenAddress,
} from "@/hooks/useJointSaveContracts"
import {
  TokenSelect,
  tokenFromPrefill,
  type SelectedToken,
} from "@/components/create-group/token-select"
import { FieldTooltip } from "@/components/ui/field-tooltip"
import { FieldError } from "@/components/ui/form"
import { FormProgress, type ProgressField } from "@/components/ui/form-progress"
import BulkImport from "@/components/create-group/BulkImport"
import {
  validateGroupName,
  validateStellarAddress,
  validatePositiveAmount,
  validateWithdrawalFee,
  findDuplicateAddresses,
  type ValidationMessages,
} from "@/lib/form-validation"
import { MAX_POOL_MEMBERS, DEFAULT_TREASURY_FEE_BPS } from "@/lib/constants"
import type { DuplicatePrefill } from "@/app/[locale]/dashboard/create/[type]/page"
import type { PoolTemplateConfig } from "@/lib/templates"
import { SaveTemplateDialog } from "@/components/templates/save-template-dialog"
import { toastManager } from "@/lib/toast"
import { LayoutTemplate } from "lucide-react"

function isValidStellarAddress(addr: string) {
  return /^G[A-Z2-7]{55}$/.test(addr)
}

const TREASURY = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID || ""

type FieldErrors = Partial<Record<"name" | "minimumDeposit" | "withdrawalFee", string>>
type Touched = Partial<Record<"name" | "minimumDeposit" | "withdrawalFee", boolean>>

export function FlexibleForm({ prefill }: { prefill?: DuplicatePrefill }) {
  const t = useTranslations("pool.create.flexible")
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
    minimumDeposit: prefill?.minimumDeposit || "",
    enableYield: prefill?.enableYield ?? false,
    withdrawalFee: prefill?.withdrawalFee || "1",
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Touched>({})

  const { deploy } = useDeployPool()
  const { initFlexible } = useInitializePool()
  const { register } = useRegisterPool("flexible")

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
    feeRequired: tv("feeRequired"),
    feeInvalidNumber: tv("feeInvalidNumber"),
    feeNegative: tv("feeNegative"),
    feeTooHigh: tv("feeTooHigh"),
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
      else if (name === "minimumDeposit")
        message = validatePositiveAmount(
          value,
          t("minimumDepositFieldLabel"),
          validationMessages
        ).message
      else if (name === "withdrawalFee")
        message = validateWithdrawalFee(value, validationMessages).message
      setFieldErrors((prev) => ({ ...prev, [name]: message }))
    },
    [t, validationMessages]
  )

  const handleBlur = (name: keyof FieldErrors, value: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }))
    validateField(name, value)
  }

  const updateMember = (i: number, v: string) => {
    const n = [...members]
    n[i] = v
    setMembers(n)
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

    setTouched({ name: true, minimumDeposit: true, withdrawalFee: true })
    const nameResult = validateGroupName(formData.name, validationMessages)
    const depositResult = validatePositiveAmount(
      formData.minimumDeposit,
      t("minimumDepositFieldLabel"),
      validationMessages
    )
    const feeResult = validateWithdrawalFee(formData.withdrawalFee, validationMessages)
    setFieldErrors({
      name: nameResult.message,
      minimumDeposit: depositResult.message,
      withdrawalFee: feeResult.message,
    })

    if (!address) return toastManager.error(tc("connectWalletFirst"))
    if (duplicateIndices.size > 0) return toastManager.error(tc("duplicateMembersFound"))
    if (validMembers.length < 2) return toastManager.error(tc("needAtLeastTwoMembers"))
    if (!nameResult.valid || !depositResult.valid || !feeResult.valid) return

    try {
      setStep("deploying")
      const contractId = await deploy("flexible")

      setStep("initializing")
      // withdrawalFee is in %, convert to bps (1% = 100 bps)
      const withdrawalFeeBps = Math.round(parseFloat(formData.withdrawalFee) * 100)
      await initFlexible(contractId, {
        token: resolveTokenAddress(token.address),
        decimals: token.decimals,
        admin: address,
        members: validMembers,
        minimumDeposit: formData.minimumDeposit,
        withdrawalFeeBps,
        yieldEnabled: formData.enableYield,
        treasury: TREASURY,
        treasuryFeeBps: DEFAULT_TREASURY_FEE_BPS, // 1%
      })

      // Register with factory (best-effort — factory must be initialized by admin)
      setStep("registering")
      try {
        await register(address, contractId)
      } catch (regErr: unknown) {
        console.warn("Factory registration skipped:", (regErr as Error).message)
      }

      setStep("saving")
      const res = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          poolType: "flexible",
          creatorAddress: address,
          poolAddress: contractId,
          tokenAddress: token.address,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          members: validMembers,
          minimumDeposit: formData.minimumDeposit,
          withdrawalFee: formData.withdrawalFee,
          yieldEnabled: formData.enableYield,
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

  const progressFields: ProgressField[] = [
    { label: tc("progressGroupName"), valid: validateGroupName(formData.name).valid },
    {
      label: t("minimumDepositFieldLabel"),
      valid: validatePositiveAmount(formData.minimumDeposit, "Amount").valid,
    },
    {
      label: t("withdrawalFeeFieldLabel"),
      valid: validateWithdrawalFee(formData.withdrawalFee).valid,
    },
    { label: tc("progressMembers"), valid: validMembers.length >= 2 },
  ]

  const templateToken = token.address === "native" ? "XLM" : token.address
  const templateConfig: PoolTemplateConfig = {
    name: formData.name,
    description: formData.description || null,
    poolType: "flexible",
    minimumDeposit: formData.minimumDeposit,
    withdrawalFee: formData.withdrawalFee,
    enableYield: formData.enableYield,
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
          aria-required="true"
          aria-describedby="name-error"
        />
        {touched.name && <FieldError id="name-error" message={fieldErrors.name} />}
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
            htmlFor="minimum"
            label={t("minimumDepositLabel", { symbol: token.symbol })}
            tooltip={t("minimumDepositTooltip")}
            required
          />
          <Input
            id="minimum"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="50"
            value={formData.minimumDeposit}
            onChange={(e) => {
              setFormData({ ...formData, minimumDeposit: e.target.value })
              if (touched.minimumDeposit) validateField("minimumDeposit", e.target.value)
            }}
            onBlur={(e) => handleBlur("minimumDeposit", e.target.value)}
            aria-required="true"
            aria-describedby="minimum-error"
          />
          {touched.minimumDeposit && <FieldError id="minimum-error" message={fieldErrors.minimumDeposit} />}
        </div>

        <div className="space-y-1">
          <FieldTooltip
            htmlFor="fee"
            label={t("withdrawalFeeLabel")}
            tooltip={t("withdrawalFeeTooltip")}
            required
          />
          <Input
            id="fee"
            type="number"
            step="0.1"
            min="0"
            max="10"
            placeholder="1"
            value={formData.withdrawalFee}
            onChange={(e) => {
              setFormData({ ...formData, withdrawalFee: e.target.value })
              if (touched.withdrawalFee) validateField("withdrawalFee", e.target.value)
            }}
            onBlur={(e) => handleBlur("withdrawalFee", e.target.value)}
            aria-required="true"
            aria-describedby="fee-error"
          />
          {touched.withdrawalFee && <FieldError id="fee-error" message={fieldErrors.withdrawalFee} />}
        </div>
      </div>

      <div className="flex items-center justify-between p-4 rounded-lg border border-border">
        <div className="space-y-0.5">
          <FieldTooltip
            htmlFor="yield"
            label={t("enableYieldLabel")}
            tooltip={t("enableYieldTooltip")}
          />
          <p className="text-sm text-muted-foreground">{t("enableYieldDescription")}</p>
        </div>
        <input
          id="yield"
          type="checkbox"
          checked={formData.enableYield}
          onChange={(e) => setFormData({ ...formData, enableYield: e.target.checked })}
          className="h-4 w-4 rounded"
        />
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
            aria-describedby={isMemberLimitReached ? "flexible-member-limit" : undefined}
          >
            <Plus className="h-4 w-4 mr-1" />
            {tc("addMember")}
          </Button>
        </div>
        {isMemberLimitReached && (
          <p id="flexible-member-limit" className="text-xs text-muted-foreground">
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
                  aria-label={`Member ${i + 2} address`}
                  aria-required="true"
                  aria-describedby={`member-error-${i}`}
                  className={
                    memberErrors[i]
                      ? "border-destructive"
                      : member && isValidStellarAddress(member)
                        ? "border-green-500"
                        : ""
                  }
                />
                {members.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeMember(i)} aria-label={`Remove member ${i + 2}`}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {memberErrors[i] && <FieldError id={`member-error-${i}`} message={memberErrors[i]} />}
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
            <li>{t("minimumDepositSummary", { amount: formData.minimumDeposit || "0" })}</li>
            <li>{t("withdrawalFeeSummary", { fee: formData.withdrawalFee })}</li>
            <li>
              {t("yieldGenerationSummary", {
                status: formData.enableYield ? t("enabled") : t("disabled"),
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
