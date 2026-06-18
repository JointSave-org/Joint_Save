"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, X, Loader2, ExternalLink } from "lucide-react"
import { useRouter } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import { useDeployPool, useInitializePool, useRegisterPool } from "@/hooks/useJointSaveContracts"
import { useToast } from "@/hooks/use-toast"

function isValidStellarAddress(addr: string) {
  return /^G[A-Z2-7]{55}$/.test(addr)
}

const TREASURY = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID || ""
const TOKEN = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID || "native"

// Stellar testnet: ~5 ledgers/sec, so 1 day ≈ 17280 ledgers
const FREQUENCY_SECONDS: Record<string, number> = {
  daily: 86400,
  weekly: 604800,
  biweekly: 1209600,
  monthly: 2592000,
}

export function RotationalForm() {
  const router = useRouter()
  const { address } = useStellar()
  // Creator is always the first member (read-only), others are editable
  const [members, setMembers] = useState<string[]>([""])
  const [step, setStep] = useState<"idle" | "deploying" | "initializing" | "registering" | "saving">("idle")
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    contributionAmount: "",
    frequency: "weekly",
  })

  const { deploy } = useDeployPool()
  const { initRotational } = useInitializePool()
  const { register } = useRegisterPool("rotational")

  // Always include creator as first member
  const allMembers = address ? [address, ...members] : members
  const validMembers = Array.from(new Set(allMembers.filter(isValidStellarAddress)))
  const isCreating = step !== "idle"

  const addMember = () => setMembers([...members, ""])
  const removeMember = (i: number) => setMembers(members.filter((_, idx) => idx !== i))
  const updateMember = (i: number, v: string) => {
    const next = [...members]; next[i] = v; setMembers(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address) return toast({ variant: "destructive", title: "Wallet not connected", description: "Please connect your wallet first" })
    if (validMembers.length < 2) return toast({ variant: "destructive", title: "Invalid members", description: "Need at least 2 valid Stellar addresses (you + 1 other)" })
    if (!formData.name) return toast({ variant: "destructive", title: "Missing name", description: "Please enter a group name" })
    if (!formData.contributionAmount) return toast({ variant: "destructive", title: "Missing amount", description: "Please enter a contribution amount" })

    try {
      // 1. Deploy contract instance from WASM hash
      setStep("deploying")
      const contractId = await deploy("rotational")

      // 2. Initialize the contract onchain
      setStep("initializing")
      await initRotational(contractId, {
        token: TOKEN === "native" ? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" : TOKEN,
        members: validMembers,
        depositAmount: formData.contributionAmount,
        roundDuration: FREQUENCY_SECONDS[formData.frequency],
        treasuryFeeBps: 100, // 1%
        relayerFeeBps: 50,   // 0.5%
        treasury: TREASURY,
      })

      // 3. Register with factory (best-effort — factory must be initialized by admin)
      setStep("registering")
      try {
        await register(address, contractId)
      } catch (regErr: any) {
        console.warn("Factory registration skipped:", regErr.message)
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
          tokenAddress: TOKEN,
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
      toast({ variant: "destructive", title: "Failed to create group", description: err.message || "Failed to create group" })
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {isCreating && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
          <p className="text-sm">{stepLabel[step]} — approve each wallet prompt.</p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Group Name</Label>
        <Input id="name" placeholder="e.g., Family Savings Circle" value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (Optional)</Label>
        <Textarea id="description" placeholder="Describe the purpose of this savings group"
          value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Contribution Amount (XLM)</Label>
          <Input id="amount" type="number" step="0.01" placeholder="100" value={formData.contributionAmount}
            onChange={(e) => setFormData({ ...formData, contributionAmount: e.target.value })} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="frequency">Payout Frequency</Label>
          <Select value={formData.frequency} onValueChange={(v) => setFormData({ ...formData, frequency: v })}>
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
        <div className="flex items-center justify-between">
          <Label>Member Stellar Addresses</Label>
          <Button type="button" variant="outline" size="sm" onClick={addMember}>
            <Plus className="h-4 w-4 mr-1" />Add Member
          </Button>
        </div>
        <div className="space-y-3">
          {/* Creator — always included, read-only */}
          <div className="flex gap-2 items-center">
            <Input value={address || ""} readOnly disabled className="font-mono text-xs opacity-70" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">You</span>
          </div>
          {members.map((member, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="G..." value={member} onChange={(e) => updateMember(i, e.target.value)} />
              {members.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removeMember(i)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
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
          {isCreating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{stepLabel[step]}</> : "Create Rotational Group"}
        </Button>
      </div>
    </form>
  )
}
