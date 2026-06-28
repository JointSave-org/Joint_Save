"use client"

import type React from "react"
import { useState, useCallback, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, X, Loader2, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import { useDeployPool, useInitializePool, useRegisterPool, useSetReputationTracker, resolveTokenAddress } from "@/hooks/useJointSaveContracts"
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
import type { DuplicatePrefill } from "@/app/dashboard/create/[type]/page"
import { MAX_POOL_MEMBERS } from "@/lib/constants"

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
  const router = useRouter()
  const { address } = useStellar()
  const [token, setToken] = useState<SelectedToken>({ address: "native", symbol: "XLM", decimals: 7 })
  // Creator is always the first member (read-only), others are editable
  const initialMembers = prefill?.members?.filter((m: string) => m !== address) ?? [""]
  const [members, setMembers] = useState<string[]>(
    initialMembers.length > 0 ? initialMembers : [""]
  )
  const [error, setError] = useState("")
  const [step, setStep] = useState<"idle" | "deploying" | "initializing" | "registering" | "saving">("idle")
  const [formData, setFormData] = useState({
    name: prefill?.name || "",
    description: prefill?.description || "",
    contributionAmount: prefill?.amount || "",
    frequency: prefill?.frequency || "weekly",
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Touched>({})
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [error])

  const { deploy } = useDeployPool()
  const { initRotational } = useInitializePool()
  const { register } = useRegisterPool("rotational")
  const { setTracker } = useSetReputationTracker()

  // Always include creator as first member
  const allMembers = address ? [address, ...members] : members
  const validMembers = Array.from(new Set(allMembers.filter(isValidStellarAddress)))
  const duplicateIndices = findDuplicateAddresses(allMembers)
  const memberErrors = members.map((m, i) => {
    if (!m) return ""
    const format = validateStellarAddress(m)
    if (!format.valid) return format.message
    const allMembersIndex = address ? i + 1 : i
    return duplicateIndices.has(allMembersIndex) ? "Duplicate address — already in this pool's member list" : ""
  })
  const isCreating = step !== "idle"
  const isMemberLimitReached = members.length >= MAX_POOL_MEMBERS

  const validateField = useCallback((name: keyof FieldErrors, value: string) => {
    const result =
      name === "name" ? validateGroupName(value) : validatePositiveAmount(value, "Contribution amount")
    setFieldErrors((prev) => ({ ...prev, [name]: result.valid ? "" : result.message }))
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

    // Mark all as touched and validate
    setTouched({ name: true, contributionAmount: true })
    const nameResult = validateGroupName(formData.name)
    const amountResult = validatePositiveAmount(formData.contributionAmount, "Contribution amount")
    setFieldErrors({
      name: nameResult.valid ? "" : nameResult.message,
      contributionAmount: amountResult.valid ? "" : amountResult.message,
    })

    if (!address) return setError("Please connect your wallet first")
    if (duplicateIndices.size > 0) return setError("Duplicate member addresses found — please remove duplicates before continuing")
    if (validMembers.length < 2) return setError("Need at least 2 valid Stellar addresses (you + 1 other)")
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
        treasuryFeeBps: 100,
        relayerFeeBps: 50,
        treasury: TREASURY,
      })

      // 3. Register with factory (best-effort — factory must be initialized by admin)
      setStep("registering")
      try {
        await register(address, contractId)
      } catch (regErr: any) {
        console.warn("Factory registration skipped:", regErr.message)
      }

      // 3b. Wire up the reputation tracker (best-effort — feature is additive)
      try {
        await setTracker(contractId)
      } catch (repErr: any) {
        console.warn("Reputation tracker wiring skipped:", repErr.message)
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
      if (!res.ok) throw new Error("Failed to save pool metadata")
      const pool = await res.json()
      router.push(`/dashboard/group/${pool.id}`)
    } catch (err: any) {
      setError(err.message || "Failed to create group")
      setStep("idle")
    }
  }

  const stepLabel: Record<typeof step, string> = {
    idle: "Create Rotational Group",
    deploying: "Deploying contract...",
    initializing: "Initializing pool...",
    registering: "Registering with factory...",
    saving: "Saving metadata...",
  }

  const progressFields: ProgressField[] = [
    { label: "Group name", valid: validateGroupName(formData.name).valid },
    { label: "Contribution amount", valid: validatePositiveAmount(formData.contributionAmount, "Amount").valid },
    { label: "Frequency", valid: !!formData.frequency },
    { label: "Members (2+)", valid: validMembers.length >= 2 },
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div ref={errorRef} className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
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
            tooltip="A short, memorable name for your savings circle — e.g. 'Family Trip Fund'. Visible to all members."
            required
          />
          <span className={`text-xs tabular-nums ${formData.name.length > 45 ? "text-destructive" : "text-muted-foreground"}`}>
            {formData.name.length}/50
          </span>
        </div>
        <Input
          id="name"
          placeholder="e.g., Family Savings Circle"
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
            label="Description"
            tooltip="Optional details about the group's purpose, rules, or goals. Helps members understand what they're joining."
          />
          <span className={`text-xs tabular-nums ${formData.description.length > 270 ? "text-destructive" : "text-muted-foreground"}`}>
            {formData.description.length}/300
          </span>
        </div>
        <Textarea
          id="description"
          placeholder="Describe the purpose of this savings group"
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
            htmlFor="amount"
            label={`Contribution Amount (${token.symbol})`}
            tooltip="How much each member deposits per round. Every member pays the same amount, and one member receives the full pool each round."
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
            label="Payout Frequency"
            tooltip="How often one member receives the pooled funds. Members take turns in rotation until everyone has received a payout."
            required
          />
          <Select
            value={formData.frequency}
            onValueChange={(v) => setFormData({ ...formData, frequency: v })}
          >
            <SelectTrigger id="frequency"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="biweekly">Bi-weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <FieldTooltip
            label="Member Stellar Addresses"
            tooltip="Add the public Stellar address (starts with G) for each person joining this pool. You are automatically included as the first member."
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
            <Plus className="h-4 w-4 mr-1" />Add Member
          </Button>
        </div>
        {isMemberLimitReached && (
          <p id="rotational-member-limit" className="text-xs text-muted-foreground">
            Maximum of {MAX_POOL_MEMBERS} members reached
          </p>
        )}

        <div className="space-y-3">
          {/* Creator — always included, read-only */}
          <div className="space-y-1">
            <div className="flex gap-2 items-center">
              <Input value={address || "Connect your wallet"} readOnly disabled className="font-mono text-xs opacity-70" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">You</span>
            </div>
            {!address && (
              <p className="text-xs text-amber-600">Connect your wallet to be included as a member</p>
            )}
          </div>

          {members.map((member, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2">
                <Input
                  placeholder="G... (56-character Stellar address)"
                  value={member}
                  onChange={(e) => updateMember(i, e.target.value)}
                  className={memberErrors[i] ? "border-destructive" : member && isValidStellarAddress(member) ? "border-green-500" : ""}
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
            <p className="text-xs text-muted-foreground">At least 2 valid members are required (you + 1 other)</p>
          )}
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <div className="bg-muted/30 rounded-lg p-4 mb-6">
          <h4 className="font-semibold mb-2">Summary</h4>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>Members: {validMembers.length}</li>
            <li>Contribution per Member: {formData.contributionAmount || "0"} XLM</li>
            <li>Payout Frequency: {formData.frequency}</li>
            <li>Total Pool: {(parseFloat(formData.contributionAmount || "0") * validMembers.length).toFixed(2)} XLM</li>
          </ul>
        </div>
        <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={isCreating}>
          {isCreating ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{stepLabel[step]}</>
          ) : (
            "Create Rotational Group"
          )}
        </Button>
      </div>
    </form>
  )
}
