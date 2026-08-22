"use client"

import { AlertTriangle, Info, AlertCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { useState } from "react"
import type { SecurityAlert, RuleId } from "@/lib/security-rules"

const SEVERITY_CONFIG = {
  critical: {
    icon: XCircle,
    className: "border-rose-500/30 bg-rose-500/5",
    badgeClassName: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20",
    iconClassName: "text-rose-500",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-500/30 bg-amber-500/5",
    badgeClassName: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
    iconClassName: "text-amber-500",
  },
  info: {
    icon: Info,
    className: "border-blue-500/30 bg-blue-500/5",
    badgeClassName: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
    iconClassName: "text-blue-500",
  },
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  investigating: "Investigating",
  resolved: "Resolved",
  false_positive: "False Positive",
}

const RULE_NAMES: Record<RuleId, string> = {
  rapid_emergency_withdraw: "Rapid Emergency Withdraw",
  unusual_deposit_spike: "Unusual Deposit Spike",
  admin_key_rotation: "Admin Key Rotation",
  mass_member_removal: "Mass Member Removal",
  pool_pause_cascade: "Pool Pause Cascade",
  dormant_pool_activation: "Dormant Pool Activation",
  failed_transaction_storm: "Failed Transaction Storm",
  reputation_manipulation: "Reputation Manipulation",
}

interface SecurityAlertCardProps {
  alert: SecurityAlert
  onStatusChange?: (alertId: string, status: SecurityAlert["status"]) => void
}

export function SecurityAlertCard({ alert, onStatusChange }: SecurityAlertCardProps) {
  const [expanded, setExpanded] = useState(false)
  const config = SEVERITY_CONFIG[alert.severity]
  const Icon = config.icon

  return (
    <Card className={cn("border p-4 transition-colors", config.className)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", config.iconClassName)} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn("text-[10px] uppercase tracking-wider", config.badgeClassName)}
            >
              {alert.severity}
            </Badge>
            <span className="font-medium text-sm">{RULE_NAMES[alert.rule_id]}</span>
            <Badge variant="outline" className="text-[10px]">
              {STATUS_LABELS[alert.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{alert.description}</p>

          {/* Expandable details */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide details" : "Show details"}
          </button>

          {expanded && (
            <div className="space-y-2 text-xs text-muted-foreground mt-2 pl-1 border-l-2 border-muted">
              {alert.affected_pools.length > 0 && (
                <div>
                  <span className="font-medium">Affected Pools:</span> {alert.affected_pools.length}{" "}
                  pool(s)
                </div>
              )}
              {alert.affected_wallets.length > 0 && (
                <div>
                  <span className="font-medium">Affected Wallets:</span>{" "}
                  {alert.affected_wallets.length} wallet(s)
                </div>
              )}
              <div>
                <span className="font-medium">Detected:</span>{" "}
                {new Date(alert.created_at).toLocaleString()}
              </div>
              {alert.resolved_at && (
                <div>
                  <span className="font-medium">Resolved:</span>{" "}
                  {new Date(alert.resolved_at).toLocaleString()}
                </div>
              )}
              {alert.resolution_notes && (
                <div>
                  <span className="font-medium">Notes:</span> {alert.resolution_notes}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {onStatusChange && alert.status !== "resolved" && alert.status !== "false_positive" && (
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onStatusChange(alert.id, "investigating")}
                disabled={alert.status === "investigating"}
              >
                Investigate
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onStatusChange(alert.id, "resolved")}
              >
                Resolved
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onStatusChange(alert.id, "false_positive")}
              >
                False Positive
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export function SecurityAlertListEmpty() {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-50" />
      <p className="text-sm font-medium">No security alerts detected</p>
      <p className="text-xs mt-1">
        All monitoring rules are clear. Run a scan to check for new alerts.
      </p>
    </div>
  )
}
