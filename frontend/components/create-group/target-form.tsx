"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, X, Loader2, ExternalLink } from "lucide-react"
import { useRouter } from "next/navigation"
import { useStellar } from "@/components/web3-provider"
import { useDeployPool, useInitializePool, useRegisterPool, getRpc } from "@/hooks/useJointSaveContracts"
import { useToast } from "@/hooks/use-toast"

function isValidStellarAddress(addr: string) {
  return /^G[A-Z2-7]{55}$/.test(addr)
}

const TREASURY = process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID || ""
const TOKEN = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID || "native"

// Convert a JS Date to an approximate Stellar ledger sequence number.
// Stellar testnet: ~5 ledgers/sec. We fetch current ledger and extrapolate.
async function dateToLedger(date: Date): Promise<number> {
  const rpc = getRpc()
  const ledger = await rpc.getLatestLedger()
  const secsFromNow = Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000))
  return ledger.sequence + Math.floor(secsFromNow * 5)
}

export function TargetForm() {
  const router = useRouter()
  const { address } = useStellar()
  const [members, setMembers] = useState<string[]>([""])
  const [step, setStep] = useState<"idle" | "deploying" | "initializing" | "registering" | "saving">("idle")
  const { toast } = useToast()
  const [formData, setFormData] = useState({ name: "", description: "", targetAmount: "", deadline: "" })

  const { deploy } = useDeployPool()
  const { initTarget } = useInitializePool()
  const { register } = useRegisterPool("target")

  const allMembers = address ? [address, ...members] : members
  const validMembers = Array.from(new Set(allMembers.filter(isValidStellarAddress)))
  const isCreating = step !== "idle"

  const addMember = () => setMembers([...members, ""])
  const removeMember = (i: number) => setMembers(members.filter((_, idx) => idx !== i))
  const updateMember = (i: number, v: string) => { const n = [...members]; n[i] = v; setMembers(n) }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address) return toast({ variant: "destructive", title: "Wallet not connected", description: "Please connect your wallet first" })
    if (validMembers.length < 2) return toast({ variant: "destructive", title: "Invalid members", description: "Need at least 2 valid Stellar addresses (you + 1 other)" })
    if (!formData.name) return toast({ variant: "destructive", title: "Missing name", description: "Please enter a group name" })
    if (!formData.targetAmount) return toast({ variant: "destructive", title: "Missing target", description: "Please enter a target amount" })
    if (!formData.deadline) return toast({ variant: "destructive", title: "Missing deadline", description: "Please select a deadline" })
    if (new Date(formData.deadline) <= new Date()) return toast({ variant: "destructive", title: "Invalid deadline", description: "Deadline must be in the future" })

    try {
      setStep("deploying")
      const contractId = await deploy("target")

      setStep("initializing")
      const deadlineLedger = await dateToLedger(new Date(formData.deadline))
      await initTarget(contractId, {
        token: TOKEN === "native" ? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" : TOKEN,
        admin: address,
        members: validMembers,
        targetAmount: formData.targetAmount,
        deadlineLedger,
      })

      // Register with factory (best-effort — factory must be initialized by admin)
      setStep("registering")
      try {
        await register(address, contractId)
      } catch (regErr: any) {
        console.warn("Factory registration skipped:", regErr.message)
      }

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
          tokenAddress: TOKEN,
          members: validMembers,
          targetAmount: formData.targetAmount,
          deadline: formData.deadline,
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
        <Input id="name" placeholder="e.g., Wedding Fund" value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description (Optional)</Label>
        <Textarea id="description" placeholder="Describe the savings goal" value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="target">Target Amount (XLM)</Label>
          <Input id="target" type="number" step="0.01" placeholder="5000" value={formData.targetAmount}
            onChange={(e) => setFormData({ ...formData, targetAmount: e.target.value })} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="deadline">Target Deadline</Label>
          <Input id="deadline" type="date" value={formData.deadline}
            onChange={(e) => setFormData({ ...formData, deadline: e.target.value })} required />
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
            <li>Target Amount: {formData.targetAmount || "0"} XLM</li>
            <li>Contribution per Member: {contributionPerMember} XLM</li>
            <li>Deadline: {formData.deadline || "Not set"}</li>
          </ul>
        </div>
        <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={isCreating}>
          {isCreating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{stepLabel[step]}</> : "Create Target Pool"}
        </Button>
      </div>
    </form>
  )
}
