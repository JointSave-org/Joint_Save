"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Loader2, Users, ShieldPlus, X, CheckCircle2, AlertCircle } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import {
  fetchAdminQuorum,
  useSetAdminQuorum,
} from "@/hooks/useJointSaveContracts"

interface AdminQuorumManagerProps {
  poolAddress: string
  poolAdmin?: string | null
}

export function AdminQuorumManager({ poolAddress, poolAdmin }: AdminQuorumManagerProps) {
  const { address } = useStellar()
  const isAdmin = !!address && !!poolAdmin && address.toUpperCase() === poolAdmin.toUpperCase()

  const [quorum, setQuorum] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [editing, setEditing] = useState(false)
  const [newAdminsInput, setNewAdminsInput] = useState("")

  const setQuorumHook = useSetAdminQuorum(poolAddress)

  // Load current quorum
  useEffect(() => {
    if (!poolAddress) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const members = await fetchAdminQuorum(poolAddress)
        if (!cancelled) setQuorum(members)
      } catch {
        if (!cancelled) setQuorum([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [poolAddress])

  const handleSetQuorum = async () => {
    setError(""); setSuccess("")
    const admins = newAdminsInput
      .split(",")
      .map(a => a.trim())
      .filter(Boolean)

    if (admins.length < 2 && admins.length > 0) {
      setError("Quorum must have at least 2 admins (or leave empty to clear)")
      return
    }

    if (admins.length === 0) {
      setError("Cannot clear quorum via UI. Use empty to keep current.")
      return
    }

    try {
      await setQuorumHook.setQuorum(admins)
      setQuorum(admins)
      setSuccess("Admin quorum updated successfully!")
      setEditing(false)
      setNewAdminsInput("")
    } catch (e: any) {
      setError(e.message || "Failed to update quorum")
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading quorum...
        </div>
      </Card>
    )
  }

  const hasQuorum = quorum.length > 0

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5" />
          Admin Quorum
        </h3>
        {hasQuorum && (
          <Badge variant="secondary">
            {quorum.length} admin{quorum.length > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {error && (
        <div className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary mb-4">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <p className="text-sm">{success}</p>
        </div>
      )}

      {!hasQuorum && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            No admin quorum configured. All admin actions use single-signature mode.
          </p>
          {isAdmin && !editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(true)
                setNewAdminsInput(address || "")
              }}
            >
              <ShieldPlus className="mr-2 h-4 w-4" />
              Set Up Multi-Sig
            </Button>
          )}
        </div>
      )}

      {hasQuorum && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Multi-sig is <span className="font-semibold text-foreground">active</span>.
            High-risk actions (pause, emergency withdraw, remove member) require
            {" "}{Math.ceil(quorum.length / 2)} of {quorum.length} approvals.
          </p>

          <div className="space-y-2">
            {quorum.map((admin, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                <Badge variant="outline" className="text-xs">
                  Admin {i + 1}
                </Badge>
                <code className="text-xs text-muted-foreground break-all">{admin}</code>
                {address && admin.toUpperCase() === address.toUpperCase() && (
                  <Badge className="text-xs bg-primary/10 text-primary">You</Badge>
                )}
              </div>
            ))}
          </div>

          {isAdmin && !editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(true)
                setNewAdminsInput(quorum.join(", "))
              }}
            >
              Edit Quorum
            </Button>
          )}
        </div>
      )}

      {editing && isAdmin && (
        <div className="mt-4 p-4 rounded-lg bg-muted/30 space-y-3">
          <p className="text-sm font-medium">Update Admin Quorum</p>
          <p className="text-xs text-muted-foreground">
            Enter Stellar addresses separated by commas. Minimum 2 admins. You must include yourself.
          </p>
          <Input
            value={newAdminsInput}
            onChange={(e) => setNewAdminsInput(e.target.value)}
            placeholder="GABC..., GDEF..., GHIJ..."
            disabled={setQuorumHook.isLoading}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSetQuorum}
              disabled={setQuorumHook.isLoading || !newAdminsInput.trim()}
            >
              {setQuorumHook.isLoading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
              ) : (
                "Save Quorum"
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={setQuorumHook.isLoading}
            >
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!isAdmin && hasQuorum && (
        <p className="text-xs text-muted-foreground mt-2">
          Only the pool admin can modify the quorum.
        </p>
      )}
    </Card>
  )
}