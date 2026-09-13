"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Shield, ShieldCheck, ShieldOff, Clock, AlertTriangle, Plus } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { useStellar } from "@/components/web3-provider"
import {
  signPauseAuthorization,
  signRevokeProof,
  DEFAULT_VALIDITY_LEDGERS,
} from "@/lib/pause-authorization"
import { STELLAR_RPC_URL, STELLAR_NETWORK_PASSPHRASE } from "@/components/web3-provider"

interface PauseAuthorization {
  id: string
  pool_id: string
  contract_address: string
  admin_address: string
  expiration_ledger: number
  used_at: string | null
  used_by_incident: string | null
  revoked_at: string | null
  created_at: string
}

interface PauseAuthorizationPanelProps {
  poolId: string
  poolContractAddress: string
  adminAddress: string
}

export function PauseAuthorizationPanel({
  poolId,
  poolContractAddress,
  adminAddress,
}: PauseAuthorizationPanelProps) {
  const t = useTranslations("admin.pauseAuth")
  const { toast } = useToast()
  const { kit } = useStellar()
  const [authorizations, setAuthorizations] = useState<PauseAuthorization[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [signing, setSigning] = useState(false)

  const fetchAuthorizations = async () => {
    try {
      const response = await fetch(
        `/api/admin/pause-authorizations?poolId=${poolId}&callerAddress=${adminAddress}`
      )
      if (!response.ok) throw new Error("Failed to fetch authorizations")
      const data = await response.json()
      setAuthorizations(data.authorizations || [])
    } catch (error) {
      console.error("Fetch error:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAuthorizations()
  }, [poolId, adminAddress])

  const handleCreate = async () => {
    if (!kit) {
      toast({
        title: t("error.noWallet"),
        description: t("error.connectWallet"),
        variant: "destructive",
      })
      return
    }

    setSigning(true)
    try {
      // Sign the authorization entry
      const { entryXdr, expirationLedger } = await signPauseAuthorization({
        kit,
        rpcUrl: STELLAR_RPC_URL,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        contractAddress: poolContractAddress,
        adminAddress,
        validityLedgers: DEFAULT_VALIDITY_LEDGERS,
      })

      // Submit to API
      const response = await fetch("/api/admin/pause-authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_id: poolId,
          contract_address: poolContractAddress,
          admin_address: adminAddress,
          entry_xdr: entryXdr,
          expiration_ledger: expirationLedger,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to create authorization")
      }

      toast({
        title: t("create.success"),
        description: t("create.successDesc"),
      })

      setCreateDialogOpen(false)
      fetchAuthorizations()
    } catch (error) {
      console.error("Create error:", error)
      toast({
        title: t("create.error"),
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSigning(false)
    }
  }

  const handleRevoke = async (authorizationId: string) => {
    if (!kit) {
      toast({
        title: t("error.noWallet"),
        variant: "destructive",
      })
      return
    }

    try {
      // Sign revoke proof
      const { signature, signedAt } = await signRevokeProof({
        kit,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        adminAddress,
        authorizationId,
      })

      // Submit to API
      const response = await fetch(`/api/admin/pause-authorizations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorization_id: authorizationId,
          admin_address: adminAddress,
          signature,
          signed_at: signedAt,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to revoke authorization")
      }

      toast({
        title: t("revoke.success"),
        description: t("revoke.successDesc"),
      })

      fetchAuthorizations()
    } catch (error) {
      console.error("Revoke error:", error)
      toast({
        title: t("revoke.error"),
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    }
  }

  const getAuthStatus = (auth: PauseAuthorization): { status: string; className: string } => {
    if (auth.revoked_at) return { status: "revoked", className: "bg-gray-500/15 text-gray-700" }
    if (auth.used_at) return { status: "used", className: "bg-blue-500/15 text-blue-700" }
    // TODO: Check if expired based on current ledger
    return { status: "active", className: "bg-green-500/15 text-green-700" }
  }

  const activeAuthorizations = authorizations.filter(
    (a) => !a.revoked_at && !a.used_at
  )

  return (
    <>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">{t("title")}</h3>
          </div>
          {activeAuthorizations.length > 0 ? (
            <Badge className="bg-green-500/15 text-green-700">
              <ShieldCheck className="h-3 w-3 mr-1" />
              {t("armed")}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              <ShieldOff className="h-3 w-3 mr-1" />
              {t("disarmed")}
            </Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground mb-4">{t("description")}</p>

        <Button onClick={() => setCreateDialogOpen(true)} className="w-full mb-4" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t("create.button")}
        </Button>

        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : authorizations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t("empty")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {authorizations.map((auth) => {
              const { status, className } = getAuthStatus(auth)
              return (
                <div
                  key={auth.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn("text-xs", className)}>
                        {t(`status.${status}`)}
                      </Badge>
                      {auth.used_by_incident && (
                        <span className="text-xs text-muted-foreground">
                          {t("usedBy")}: {auth.used_by_incident.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t("expires")}: {t("ledger")} {auth.expiration_ledger.toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("created")}: {new Date(auth.created_at).toLocaleString()}
                    </div>
                  </div>
                  {!auth.revoked_at && !auth.used_at && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(auth.id)}
                      className="ml-2"
                    >
                      {t("revoke.button")}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Create Authorization Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-100">
                    {t("create.warningTitle")}
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-amber-800 dark:text-amber-200">
                    <li>{t("create.warning1")}</li>
                    <li>{t("create.warning2")}</li>
                    <li>{t("create.warning3")}</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("create.validity")}:</span>
                <span className="font-medium">~30 {t("create.days")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("create.ledgers")}:</span>
                <span className="font-medium">{DEFAULT_VALIDITY_LEDGERS.toLocaleString()}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={signing}
            >
              {t("create.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={signing}>
              {signing ? t("create.signing") : t("create.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
