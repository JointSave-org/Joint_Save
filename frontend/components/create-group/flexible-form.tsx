"use client"

import type React from "react"
import { useState, useCallback } from "react"
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
import { TokenSelect, type SelectedToken } from "@/components/create-group/token-select"
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
} from "@/lib/form-validation"
import { MAX_POOL_MEMBERS } from "@/lib/constants"
import type { DuplicatePrefill } from "@/app/dashboard/create/[type]/page"
import { toastManager } from "@/lib/toast"

function isValidStellarAddress(addr: string) {
  return /^G[A-Z2-7]{55}$/.test(addr)
}

const TREASURY = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID || ""

type FieldErrors = Partial<Record<"name" | "minimumDeposit" | "withdrawalFee", string>>
type Touched = Partial<Record<"name" | "minimumDeposit" | "withdrawalFee", boolean>>

export function FlexibleForm({ prefill }: { prefill?: DuplicatePrefill }) {
  const router = useRouter()
  const { address } = useStellar()
  const [token, setToken] = useState<SelectedToken>({
    address: "native",
    symbol: prefill?.token || "XLM",
    decimals: 7,
  })
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
    enableYield: false,
    withdrawalFee: "1",
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Touched>({})

  const { deploy } = useDeployPool()
  const { initFlexible } = useInitializePool()
  const { register } = useRegisterPool("flexible")

  const allMembers = address ? [address, ...members] : members
  const validMembers = Array.from(new Set(allMembers.filter(isValidStellarAddress)))
  const duplicateIndices = findDuplicateAddresses(allMembers)
  const memberErrors = members.map((m, i) => {
    if (!m) return ""
    const format = validateStellarAddress(m)
    if (!format.valid) return format.message
    const allMembersIndex = address ? i + 1 : i
    return duplicateIndices.has(allMembersIndex)
      ? "Duplicate address — already in this pool's member list"
      : ""
  })
  const isCreating = step !== "idle"
  const isMemberLimitReached = members.length >= MAX_POOL_MEMBERS

  const validateField = useCallback((name: keyof FieldErrors, value: string) => {
    let message = ""
    if (name === "name") message = validateGroupName(value).message
    else if (name === "minimumDeposit")
      message = validatePositiveAmount(value, "Minimum deposit").message
    else if (name === "withdrawalFee") message = validateWithdrawalFee(value).message
    setFieldErrors((prev) => ({ ...prev, [name]: message }))
  }, [])

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
    const nameResult = validateGroupName(formData.name)
    const depositResult = validatePositiveAmount(formData.minimumDeposit, "Minimum deposit")
    const feeResult = validateWithdrawalFee(formData.withdrawalFee)
    setFieldErrors({
      name: nameResult.message,
      minimumDeposit: depositResult.message,
      withdrawalFee: feeResult.message,
    })

    if (!address) return toastManager.error("Please connect your wallet first")
    if (duplicateIndices.size > 0)
      return toastManager.error(
        "Duplicate member addresses found — please remove duplicates before continuing"
      )
    if (validMembers.length < 2)
      return toastManager.error("Need at least 2 valid Stellar addresses (you + 1 other)")
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
        treasuryFeeBps: 100, // 1%
      })

      // Register with factory (best-effort — factory must be initialized by admin)
      setStep("registering")
      try {
        await register(address, contractId)
      } catch (regErr: unknown) {
        // eslint-disable-next-line no-console
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
      if (!res.ok) throw new Error("Failed to save pool metadata")
      const pool = await res.json()
      router.push(`/dashboard/group/${pool.id}`)
    } catch (err: unknown) {
      toastManager.error((err as Error).message || "Failed to create group")
      setStep("idle")
    }
  }

  const stepLabel: Record<typeof step, string> = {
    idle: "Create Flexible Pool",
    deploying: "Deploying contract...",
    initializing: "Initializing pool...",
    registering: "Registering with factory...",
    saving: "Saving metadata...",
  }

  const progressFields: ProgressField[] = [
    { label: "Group name", valid: validateGroupName(formData.name).valid },
    {
      label: "Minimum deposit",
      valid: validatePositiveAmount(formData.minimumDeposit, "Amount").valid,
    },
    { label: "Withdrawal fee", valid: validateWithdrawalFee(formData.withdrawalFee).valid },
    { label: "Members (2+)", valid: validMembers.length >= 2 },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {isCreating && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
          <p className="text-sm">{stepLabel[step]} — approve each wallet prompt.</p>
        </div>
      )}

      <FormProgress fields={progressFields} />

      {prefill && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
          <CopyPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>
            Pre-filled from the original pool — all values are editable. Submitting will deploy a{" "}
            <strong>new, independent contract</strong> with no connection to the original.
          </span>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <FieldTooltip
            htmlFor="name"
            label="Group Name"
            tooltip="A name for your flexible savings pool — e.g. 'Emergency Fund'. Visible to all members."
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
          placeholder="e.g., Emergency Fund"
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
            label="Description"
            tooltip="Optional notes about this pool's purpose, deposit rules, or any agreements between members."
          />
          <span
            className={`text-xs tabular-nums ${formData.description.length > 270 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formData.description.length}/300
          </span>
        </div>
        <Textarea
          id="description"
          placeholder="Describe the purpose of this flexible pool"
          maxLength={300}
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={3}
        />
      </div>

      <TokenSelect onChange={setToken} />
      {/* Bulk Import Component */}
      <BulkImport onMembersChange={setMembers} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <FieldTooltip
            htmlFor="minimum"
            label={`Minimum Deposit (${token.symbol})`}
            tooltip="The smallest amount a member can deposit in a single transaction. Helps maintain meaningful contributions."
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
          />
          {touched.minimumDeposit && <FieldError message={fieldErrors.minimumDeposit} />}
        </div>

        <div className="space-y-1">
          <FieldTooltip
            htmlFor="fee"
            label="Withdrawal Fee (%)"
            tooltip="A small fee charged on withdrawals to discourage early exits and build the pool's reserve. 0–10% allowed."
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
          />
          {touched.withdrawalFee && <FieldError message={fieldErrors.withdrawalFee} />}
        </div>
      </div>

      <div className="flex items-center justify-between p-4 rounded-lg border border-border">
        <div className="space-y-0.5">
          <FieldTooltip
            htmlFor="yield"
            label="Enable Yield Generation"
            tooltip="When enabled, idle funds are staked in Stellar DeFi protocols to earn passive income for the pool. Members share the yield proportionally."
          />
          <p className="text-sm text-muted-foreground">
            Stake idle funds in Stellar DeFi protocols for passive income
          </p>
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
            label="Member Stellar Addresses"
            tooltip="Add the public Stellar address (starts with G) for each person joining this pool. You are automatically included."
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
            Add Member
          </Button>
        </div>
        {isMemberLimitReached && (
          <p id="flexible-member-limit" className="text-xs text-muted-foreground">
            Maximum of {MAX_POOL_MEMBERS} members reached
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex gap-2 items-center">
              <Input
                value={address || "Connect your wallet"}
                readOnly
                disabled
                className="font-mono text-xs opacity-70"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">You</span>
            </div>
            {!address && (
              <p className="text-xs text-amber-600">
                Connect your wallet to be included as a member
              </p>
            )}
          </div>

          {members.map((member, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2">
                <Input
                  placeholder="G... (56-character Stellar address)"
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
                <p className="text-green-600 text-xs flex items-center gap-1">✓ Valid address</p>
              )}
            </div>
          ))}

          {validMembers.length < 2 && members.some((m) => m) && (
            <p className="text-xs text-muted-foreground">
              At least 2 valid members are required (you + 1 other)
            </p>
          )}
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <div className="bg-muted/30 rounded-lg p-4 mb-6">
          <h4 className="font-semibold mb-2">Summary</h4>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>Members: {validMembers.length}</li>
            <li>Minimum Deposit: {formData.minimumDeposit || "0"} XLM</li>
            <li>Withdrawal Fee: {formData.withdrawalFee}%</li>
            <li>Yield Generation: {formData.enableYield ? "Enabled" : "Disabled"}</li>
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
            "Create Flexible Pool"
          )}
        </Button>
      </div>
    </form>
  )
}
