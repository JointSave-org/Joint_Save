"use client"

import type React from "react"
import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, X, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import {
  useDeployPool,
  useInitializePool,
  useRegisterPool,
  useSetReputationTracker,
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
import type { DuplicatePrefill } from "@/app/[locale]/dashboard/create/[type]/page"
import type { PoolTemplateConfig } from "@/lib/templates"
import { SaveTemplateDialog } from "@/components/templates/save-template-dialog"
import {
  MAX_POOL_MEMBERS,
  DEFAULT_TREASURY_FEE_BPS,
  DEFAULT_RELAYER_FEE_BPS,
} from "@/lib/constants"
import { toastManager } from "@/lib/toast"
import { LayoutTemplate } from "lucide-react"

function isValidStellarAddress(addr: string) {
  return /^G[A-Z2-7]{55}$/.test(addr)
}

const TREASURY = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID || ""

// Stellar testnet: ~5 ledgers/sec, so 1 day ≈ 17280 ledgers
const FREQUENCY_SECONDS: Record<string, number> = {
  daily: 86400,
  weekly: 604800,
  biweekly: 1209600,
  monthly: 2592000,
}

type FieldErrors = Partial<Record<"name" | "contributionAmount", string>>
type Touched = Partial<Record<"name" | "contributionAmount", boolean>>

export function RotationalForm({ prefill }: { prefill?: DuplicatePrefill }) {
  const t = useTranslations("pool.create.rotational")
  const tc = useTranslations("pool.create.common")
  const tv = useTranslations("pool.create.validation")
  const router = useRouter()
  const { address } = useStellar()
  const [token, setToken] = useState<SelectedToken>(
    tokenFromPrefill(prefill?.token) ?? { address: "native", symbol: "XLM", decimals: 7 }
  )
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  // Creator is always the first member (read-only), others are editable
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
    contributionAmount: prefill?.amount || "",
    frequency: prefill?.frequency || "weekly",
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Touched>({})

  const { deploy } = useDeployPool()
  const { initRotational } = useInitializePool()
  const { register } = useRegisterPool("rotational")
  const { setTracker } = useSetReputationTracker()

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

  // Always include creator as first member
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
      const result =
        name === "name"
          ? validateGroupName(value, validationMessages)
          : validatePositiveAmount(value, tc("contributionAmountFieldLabel"), validationMessages)
      setFieldErrors((prev) => ({ ...prev, [name]: result.valid ? "" : result.message }))
    },
    [tc, validationMessages]
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

    // Mark all as touched and validate
    setTouched({ name: true, contributionAmount: true })
    const nameResult = validateGroupName(formData.name, validationMessages)
    const amountResult = validatePositiveAmount(
      formData.contributionAmount,
      tc("contributionAmountFieldLabel"),
      validationMessages
    )
    setFieldErrors({
      name: nameResult.valid ? "" : nameResult.message,
      contributionAmount: amountResult.valid ? "" : amountResult.message,
    })

    if (!address) return toastManager.error(tc("connectWalletFirst"))
    if (duplicateIndices.size > 0) return toastManager.error(tc("duplicateMembersFound"))
    if (validMembers.length < 2) return toastManager.error(tc("needAtLeastTwoMembers"))
    if (!nameResult.valid || !amountResult.valid) return

    try {
      // 1. Deploy contract instance from WASM hash
      setStep("deploying")
      const contractId = await deploy("rotational")

      // 2. Initialize the contract onchain
      setStep("initializing")
      await initRotational(contractId, {
        token: resolveTokenAddress(token.address),
        decimals: token.decimals,
        admin: address,
        members: validMembers,
        depositAmount: formData.contributionAmount,
        roundDuration: FREQUENCY_SECONDS[formData.frequency],
        treasuryFeeBps: DEFAULT_TREASURY_FEE_BPS,
        relayerFeeBps: DEFAULT_RELAYER_FEE_BPS,
        treasury: TREASURY,
      })

      // 3. Register with factory (best-effort — factory must be initialized by admin)
      setStep("registering")
      try {
        await register(address, contractId)
      } catch (regErr: unknown) {
        console.warn("Factory registration skipped:", (regErr as Error).message)
      }

      // 3b. Wire up the reputation tracker (best-effort — feature is additive)
      try {
        await setTracker(contractId)
      } catch (repErr: unknown) {
        console.warn("Reputation tracker wiring skipped:", (repErr as Error).message)
      }

      // 4. Save metadata to DB
      setStep("saving")
      const res = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          poolType: "rotational",
          creatorAddress: address,
          poolAddress: contractId,
          tokenAddress: token.address,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          members: validMembers,
          contributionAmount: formData.contributionAmount,
          roundDuration: FREQUENCY_SECONDS[formData.frequency],
          frequency: formData.frequency,
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
      label: tc("progressContributionAmount"),
      valid: validatePositiveAmount(formData.contributionAmount, "Amount").valid,
    },
    { label: t("progressFrequency"), valid: !!formData.frequency },
    { label: tc("progressMembers"), valid: validMembers.length >= 2 },
  ]

  const templateToken = token.address === "native" ? "XLM" : token.address
  const templateConfig: PoolTemplateConfig = {
    name: formData.name,
    description: formData.description || null,
    poolType: "rotational",
    amount: formData.contributionAmount,
    frequency: formData.frequency,
    members: validMembers,
    token: templateToken,
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {isCreating && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
          <p className="text-sm">{t("approveWalletPrompt", { step: stepLabel[step] })}</p>
        </div>
      )}

      <FormProgress fields={progressFields} />

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <FieldTooltip
            htmlFor="name"
            label={tc("groupNameLabel")}
            tooltip={tc("groupNameTooltip")}
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
          placeholder={tc("groupNamePlaceholder")}
          maxLength={50}
          value={formData.name}
          onChange={(e) => {
            setFormData({ ...formData, name: e.target.value })
            if (touched.name) validateField("name", e.target.value)
          }}
          onBlur={(e) => handleBlur("name", e.target.value)}
          aria-describedby="name-error"
        />
        {touched.name && <FieldError message={fieldErrors.name} />}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <FieldTooltip
            htmlFor="description"
            label={tc("descriptionLabel")}
            tooltip={tc("descriptionTooltip")}
          />
          <span
            className={`text-xs tabular-nums ${formData.description.length > 270 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formData.description.length}/300
          </span>
        </div>
        <Textarea
          id="description"
          placeholder={tc("descriptionPlaceholder")}
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
            htmlFor="amount"
            label={t("contributionAmountLabel", { symbol: token.symbol })}
            tooltip={t("contributionAmountTooltip")}
            required
          />
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="100"
            value={formData.contributionAmount}
            onChange={(e) => {
              setFormData({ ...formData, contributionAmount: e.target.value })
              if (touched.contributionAmount) validateField("contributionAmount", e.target.value)
            }}
            onBlur={(e) => handleBlur("contributionAmount", e.target.value)}
          />
          {touched.contributionAmount && <FieldError message={fieldErrors.contributionAmount} />}
        </div>

        <div className="space-y-1">
          <FieldTooltip
            htmlFor="frequency"
            label={t("payoutFrequencyLabel")}
            tooltip={t("payoutFrequencyTooltip")}
            required
          />
          <Select
            value={formData.frequency}
            onValueChange={(v) => setFormData({ ...formData, frequency: v })}
          >
            <SelectTrigger id="frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">{t("frequency.daily")}</SelectItem>
              <SelectItem value="weekly">{t("frequency.weekly")}</SelectItem>
              <SelectItem value="biweekly">{t("frequency.biweekly")}</SelectItem>
              <SelectItem value="monthly">{t("frequency.monthly")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <FieldTooltip
            label={tc("memberAddressesLabel")}
            tooltip={tc("memberAddressesTooltip")}
            required
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addMember}
            disabled={isMemberLimitReached}
            aria-describedby={isMemberLimitReached ? "rotational-member-limit" : undefined}
          >
            <Plus className="h-4 w-4 mr-1" />
            {tc("addMember")}
          </Button>
        </div>
        {isMemberLimitReached && (
          <p id="rotational-member-limit" className="text-xs text-muted-foreground">
            {tc("maxMembersReached", { max: MAX_POOL_MEMBERS })}
          </p>
        )}

        <div className="space-y-3">
          {/* Creator — always included, read-only */}
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
            <li>
              {t("contributionPerMember", {
                amount: formData.contributionAmount || "0",
                token: "XLM",
              })}
            </li>
            <li>
              {t("payoutFrequencySummary", { frequency: t(`frequency.${formData.frequency}`) })}
            </li>
            <li>
              {t("totalPool", {
                amount: (
                  parseFloat(formData.contributionAmount || "0") * validMembers.length
                ).toFixed(2),
                token: "XLM",
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
