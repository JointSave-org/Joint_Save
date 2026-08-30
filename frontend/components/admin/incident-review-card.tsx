"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle, XCircle, Clock, Shield, ExternalLink } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

interface Incident {
  id: string
  pool_id: string
  trigger_rule_ids: string[]
  severity: "info" | "warning" | "critical"
  alert_count: number
  reason: string
  created_by_scan: boolean
  scan_source: "cron" | "admin" | "manual"
  action: "pause" | "none"
  executed: boolean
  dry_run: boolean
  skip_reason: string | null
  platform_paused: boolean
  onchain_status: "not_required" | "pending" | "confirmed" | "failed"
  onchain_tx_hash: string | null
  status: "open" | "resolved"
  resolved_by: string | null
  resolution_notes: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

interface IncidentReviewCardProps {
  incident: Incident
  adminAddress: string
  onUpdate: () => void
}

const SEVERITY_CONFIG = {
  critical: {
    icon: XCircle,
    className: "border-rose-500/30 bg-rose-500/5",
    badgeClassName: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
    iconClassName: "text-rose-500",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-500/30 bg-amber-500/5",
    badgeClassName: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    iconClassName: "text-amber-500",
  },
  info: {
    icon: CheckCircle,
    className: "border-blue-500/30 bg-blue-500/5",
    badgeClassName: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    iconClassName: "text-blue-500",
  },
}

export function IncidentReviewCard({ incident, adminAddress, onUpdate }: IncidentReviewCardProps) {
  const t = useTranslations("admin.incidents")
  const { toast } = useToast()
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false)
  const [recordTxDialogOpen, setRecordTxDialogOpen] = useState(false)
  const [resolutionNotes, setResolutionNotes] = useState("")
  const [txHash, setTxHash] = useState("")
  const [loading, setLoading] = useState(false)

  const config = SEVERITY_CONFIG[incident.severity]
  const Icon = config.icon

  const handleAction = async (action: "resolve" | "resume" | "record_onchain") => {
    setLoading(true)
    try {
      const body: any = {
        admin_address: adminAddress,
        action,
      }

      if (action === "record_onchain") {
        body.tx_hash = txHash
      } else {
        body.resolution_notes = resolutionNotes
      }

      const response = await fetch(`/api/admin/incidents/${incident.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Action failed")
      }

      toast({
        title: t(`action.${action}Success`),
        description: data.onchainUnpauseRequired
          ? t("action.onchainUnpauseRequired")
          : t(`action.${action}Description`),
      })

      setResolveDialogOpen(false)
      setResumeDialogOpen(false)
      setRecordTxDialogOpen(false)
      setResolutionNotes("")
      setTxHash("")
      onUpdate()
    } catch (error) {
      console.error("Action error:", error)
      toast({
        title: t("action.error"),
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Card className={cn("p-4", config.className)}>
        <div className="flex items-start gap-3">
          <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", config.iconClassName)} />
          <div className="flex-1 min-w-0 space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={config.badgeClassName}>
                {incident.severity}
              </Badge>
              <Badge variant="outline">
                {incident.executed ? t("executed") : incident.dry_run ? t("dryRun") : t("skipped")}
              </Badge>
              {incident.status === "resolved" && (
                <Badge variant="outline" className="bg-green-500/15 text-green-700">
                  {t("resolved")}
                </Badge>
              )}
            </div>

            {/* Reason */}
            <p className="text-sm font-medium">{incident.reason}</p>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium">{t("alertCount")}: </span>
                {incident.alert_count}
              </div>
              <div>
                <span className="font-medium">{t("action")}: </span>
                {incident.action}
              </div>
              <div>
                <span className="font-medium">{t("platformPaused")}: </span>
                {incident.platform_paused ? t("yes") : t("no")}
              </div>
              <div>
                <span className="font-medium">{t("onchainStatus")}: </span>
                {t(`onchainStatus.${incident.onchain_status}`)}
              </div>
              {incident.skip_reason && (
                <div className="col-span-2">
                  <span className="font-medium">{t("skipReason")}: </span>
                  {t(`skipReason.${incident.skip_reason}`)}
                </div>
              )}
              <div className="col-span-2">
                <span className="font-medium">{t("triggered")}: </span>
                {new Date(incident.created_at).toLocaleString()}
              </div>
              {incident.resolved_at && (
                <div className="col-span-2">
                  <span className="font-medium">{t("resolvedAt")}: </span>
                  {new Date(incident.resolved_at).toLocaleString()}
                </div>
              )}
              {incident.resolution_notes && (
                <div className="col-span-2">
                  <span className="font-medium">{t("notes")}: </span>
                  {incident.resolution_notes}
                </div>
              )}
              {incident.onchain_tx_hash && (
                <div className="col-span-2 flex items-center gap-1">
                  <span className="font-medium">{t("txHash")}: </span>
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${incident.onchain_tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    {incident.onchain_tx_hash.slice(0, 8)}...{incident.onchain_tx_hash.slice(-6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {incident.status === "open" && (
              <div className="flex gap-2 flex-wrap">
                {incident.onchain_status === "pending" && !incident.onchain_tx_hash && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRecordTxDialogOpen(true)}
                    className="text-xs"
                  >
                    <Shield className="mr-1 h-3 w-3" />
                    {t("action.recordTx")}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResolveDialogOpen(true)}
                  className="text-xs"
                >
                  <CheckCircle className="mr-1 h-3 w-3" />
                  {t("action.resolve")}
                </Button>
                {incident.platform_paused && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResumeDialogOpen(true)}
                    className="text-xs"
                  >
                    <Clock className="mr-1 h-3 w-3" />
                    {t("action.resume")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("action.resolve")}</DialogTitle>
            <DialogDescription>{t("action.resolveDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="resolve-notes">{t("action.notesLabel")} *</Label>
              <Textarea
                id="resolve-notes"
                placeholder={t("action.notesPlaceholder")}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogOpen(false)} disabled={loading}>
              {t("action.cancel")}
            </Button>
            <Button onClick={() => handleAction("resolve")} disabled={loading || !resolutionNotes.trim()}>
              {loading ? t("action.processing") : t("action.resolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resume Dialog */}
      <Dialog open={resumeDialogOpen} onOpenChange={setResumeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("action.resume")}</DialogTitle>
            <DialogDescription>{t("action.resumeDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="resume-notes">{t("action.notesLabel")} *</Label>
              <Textarea
                id="resume-notes"
                placeholder={t("action.resumePlaceholder")}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={3}
              />
            </div>
            {incident.onchain_status === "confirmed" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {t("action.onchainPauseWarning")}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResumeDialogOpen(false)} disabled={loading}>
              {t("action.cancel")}
            </Button>
            <Button onClick={() => handleAction("resume")} disabled={loading || !resolutionNotes.trim()}>
              {loading ? t("action.processing") : t("action.resume")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record TX Dialog */}
      <Dialog open={recordTxDialogOpen} onOpenChange={setRecordTxDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("action.recordTx")}</DialogTitle>
            <DialogDescription>{t("action.recordTxDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tx-hash">{t("action.txHashLabel")} *</Label>
              <Input
                id="tx-hash"
                placeholder="a1b2c3d4..."
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                maxLength={64}
              />
              <p className="text-xs text-muted-foreground">{t("action.txHashHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordTxDialogOpen(false)} disabled={loading}>
              {t("action.cancel")}
            </Button>
            <Button
              onClick={() => handleAction("record_onchain")}
              disabled={loading || !/^[0-9a-f]{64}$/i.test(txHash)}
            >
              {loading ? t("action.processing") : t("action.recordTx")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
