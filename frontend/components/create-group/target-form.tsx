"use client"

import type React from "react"
import { useState, useCallback, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Plus, X, Loader2, AlertCircle, Info } from "lucide-react"
import { useRouter } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import {
  useDeployPool,
  useInitializePool,
  useRegisterPool,
  getRpc,
  resolveTokenAddress,
} from "@/hooks/useJointSaveContracts"
import { TokenSelect, type SelectedToken } from "@/components/create-group/token-select"
import BulkImport from "@/components/create-group/BulkImport"
import { FieldTooltip } from "@/components/ui/field-tooltip"
import { FieldError } from "@/components/ui/form"
import { FormProgress, type ProgressField } from "@/components/ui/form-progress"
import {
  validateGroupName,
  validateStellarAddress,
  validatePositiveAmount,
  findDuplicateAddresses,
} from "@/lib/form-validation"
import { MAX_POOL_MEMBERS } from "@/lib/constants"

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

export function TargetForm() {
  const router = useRouter()
  const { address } = useStellar()
  const [token, setToken] = useState<SelectedToken>({
    address: "native",
    symbol: "XLM",
    decimals: 7,
  })
  const [members, setMembers] = useState<string[]>([""])
  const [error, setError] = useState("")
  const [step, setStep] = useState<
    "idle" | "deploying" | "initializing" | "registering" | "saving"
  >("idle")
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    targetAmount: "",
    deadlineDays: "",
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Touched>({})
  const [currentLedger, setCurrentLedger] = useState<number | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [error])

  useEffect(() => {
    getRpc()
      .getLatestLedger()
      .then((l) => setCurrentLedger(l.sequence))
      .catch(() => {})
  }, [])

  const { deploy } = useDeployPool()
  const { initTarget } = useInitializePool()
  const { register } = useRegisterPool("target")

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
    else if (name === "targetAmount")
      message = validatePositiveAmount(value, "Target amount").message
    else if (name === "deadlineDays") {
      const d = parseInt(value)
      if (!value) message = "Deadline is required"
      else if (isNaN(d) || d < 1) message = "Deadline must be at least 1 day"
      else if (d > 3650) message = "Deadline cannot exceed 10 years"
    }
    setFieldErrors((prev) => ({ ...prev, [name]: message }))
  }, [])

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
    setError("")

    setTouched({ name: true, targetAmount: true, deadlineDays: true })
    const nameResult = validateGroupName(formData.name)
    const amountResult = validatePositiveAmount(formData.targetAmount, "Target amount")
    const deadlineDays = parseInt(formData.deadlineDays)
    const deadlineDaysValid = formData.deadlineDays && !isNaN(deadlineDays) && deadlineDays >= 1 && deadlineDays <= 3650
    setFieldErrors({
      name: nameResult.message,
      targetAmount: amountResult.message,
      deadlineDays: deadlineDaysValid ? "" : (formData.deadlineDays ? "Deadline must be between 1 and 3650 days" : "Deadline is required"),
    })

    if (!address) return setError("Please connect your wallet first")
    if (duplicateIndices.size > 0)
      return setError(
        "Duplicate member addresses found — please remove duplicates before continuing"
      )
    if (validMembers.length < 2)
      return setError("Need at least 2 valid Stellar addresses (you + 1 other)")
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
      if (!res.ok) throw new Error("Failed to save pool metadata")
      const pool = await res.json()
      router.push(`/dashboard/group/${pool.id}`)
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to create group")
      setStep("idle")
    }
  }

  const stepLabel: Record<typeof step, string> = {
    idle: "Create Target Pool",
    deploying: "Deploying contract...",
    initializing: "Initializing pool...",
    registering: "Registering with factory...",
    saving: "Saving metadata...",
  }

  const contributionPerMember =
    validMembers.length > 0
      ? (parseFloat(formData.targetAmount || "0") / validMembers.length).toFixed(2)
      : "0"

  const days = parseInt(formData.deadlineDays) || 0
  const estimatedDeadlineLedger =
    currentLedger !== null && days > 0 ? currentLedger + daysToLedgers(days) : null

  const progressFields: ProgressField[] = [
    { label: "Group name", valid: validateGroupName(formData.name).valid },
    {
      label: "Target amount",
      valid: validatePositiveAmount(formData.targetAmount, "Amount").valid,
    },
    { label: "Deadline (days)", valid: days >= 1 && days <= 3650 },
    { label: "Members (2+)", valid: validMembers.length >= 2 },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          ref={errorRef}
          className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}
      {isCreating && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
          <p className="text-sm">{stepLabel[step]} — approve each wallet prompt.</p>
        </div>
      )}

      <FormProgress fields={progressFields} />

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <FieldTooltip
            htmlFor="name"
            label="Group Name"
            tooltip="A descriptive name for your savings goal — e.g. 'Wedding Fund'. Visible to all members."
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
          placeholder="e.g., Wedding Fund"
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
            tooltip="Optional context about the savings goal — what you're saving for, any rules, or milestones to reach."
          />
          <span
            className={`text-xs tabular-nums ${formData.description.length > 270 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formData.description.length}/300
          </span>
        </div>
        <Textarea
          id="description"
          placeholder="Describe the savings goal"
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
            htmlFor="target"
            label={`Target Amount (${token.symbol})`}
            tooltip="The total amount the group aims to save collectively. Members contribute until this amount is reached."
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
            label="Deadline (days from now)"
            tooltip="How many days until the savings target deadline. Stored as a Stellar ledger sequence number (~6 sec/ledger)."
            required
          />
          <Input
            id="deadlineDays"
            type="number"
            min="1"
            max="3650"
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
                ? `Ledger ~${estimatedDeadlineLedger.toLocaleString()} · Est. ${new Date(Date.now() + days * 86_400_000).toLocaleDateString()}`
                : "Fetching current ledger…"}
            </p>
          )}
          {touched.deadlineDays && <FieldError message={fieldErrors.deadlineDays} />}
        </div>
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
            aria-describedby={isMemberLimitReached ? "target-member-limit" : undefined}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Member
          </Button>
        </div>
        {isMemberLimitReached && (
          <p id="target-member-limit" className="text-xs text-muted-foreground">
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
            <li>Target Amount: {formData.targetAmount || "0"} XLM</li>
            <li>Each member contributes: {contributionPerMember} XLM</li>
            <li>Deadline: {days > 0
              ? `~${days} day${days !== 1 ? "s" : ""}${estimatedDeadlineLedger ? ` (ledger ~${estimatedDeadlineLedger.toLocaleString()})` : ""}`
              : "Not set"}</li>
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
            "Create Target Pool"
          )}
        </Button>
      </div>
    </form>
  )
}
