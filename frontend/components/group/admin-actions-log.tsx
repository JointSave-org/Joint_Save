"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ShieldOff,
  Shield,
  UserPlus,
  UserMinus,
  Settings,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ExternalLink,
  Bot,
} from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import { formatRelativeTime, formatExactDateTime } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

interface AdminAction {
  id: string
  pool_id: string
  admin_address: string
  action_type: string
  target_address: string | null
  metadata: Record<string, unknown>
  tx_hash: string | null
  created_at: string
}

interface AdminActionsLogProps {
  groupId: string
}

export function AdminActionsLog({ groupId }: AdminActionsLogProps) {
  const t = useTranslations("group.actionsLog")
  const locale = useLocale()
  const { address } = useStellar()
  const [actions, setActions] = useState<AdminAction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchActions = useCallback(async () => {
    if (!address) {
      setError(t("connectWalletToView"))
      setActions([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/actions?poolId=${groupId}&callerAddress=${address}`)
      if (res.status === 403) {
        setError(t("onlyVisibleToMembers"))
        setActions([])
        return
      }
      if (!res.ok) {
        throw new Error(t("failedToFetch"))
      }
      const data = await res.json()
      setActions(data.actions || [])
    } catch (e: unknown) {
      setError((e as Error).message || t("errorOccurred"))
    } finally {
      setLoading(false)
    }
  }, [groupId, address, t])

  useEffect(() => {
    fetchActions()
  }, [fetchActions])

  const formatAddress = (addr: string | null) => {
    if (!addr) return ""
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`
  }

  const getActionDetails = (action: AdminAction) => {
    switch (action.action_type) {
      case "pause":
        return {
          title: t("pauseTitle"),
          description: t("pauseDescription"),
          icon: ShieldOff,
          iconColor: "text-destructive",
          bgColor: "bg-destructive/10",
        }
      case "unpause":
        return {
          title: t("unpauseTitle"),
          description: t("unpauseDescription"),
          icon: Shield,
          iconColor: "text-green-600",
          bgColor: "bg-green-600/10",
        }
      case "add_member":
        return {
          title: t("addMemberTitle"),
          description: t("addMemberDescription", {
            address: formatAddress(action.target_address),
          }),
          icon: UserPlus,
          iconColor: "text-primary",
          bgColor: "bg-primary/10",
        }
      case "remove_member":
        return {
          title: t("removeMemberTitle"),
          description: t("removeMemberDescription", {
            address: formatAddress(action.target_address),
          }),
          icon: UserMinus,
          iconColor: "text-amber-600",
          bgColor: "bg-amber-600/10",
        }
      case "emergency_withdraw":
        return {
          title: t("emergencyWithdrawTitle"),
          description: t("emergencyWithdrawDescription", {
            address: formatAddress(action.target_address),
          }),
          icon: AlertTriangle,
          iconColor: "text-destructive",
          bgColor: "bg-destructive/10",
        }
      case "set_treasury":
        return {
          title: t("setTreasuryTitle"),
          description: t("setTreasuryDescription", {
            address: formatAddress(action.target_address),
          }),
          icon: Settings,
          iconColor: "text-muted-foreground",
          bgColor: "bg-muted",
        }
      case "auto_trigger_payout":
        return {
          title: t("autoTriggerTitle"),
          description: t("autoTriggerDescription"),
          icon: Bot,
          iconColor: "text-blue-600",
          bgColor: "bg-blue-600/10",
        }
      default:
        return {
          title: action.action_type.replace("_", " "),
          description: t("genericActionDescription", { actionType: action.action_type }),
          icon: Settings,
          iconColor: "text-muted-foreground",
          bgColor: "bg-muted",
        }
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchActions}
          disabled={loading || !address}
          className="h-8 w-8 p-0"
          aria-label={t("refreshAria")}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading && actions.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {error && <p className="text-sm text-muted-foreground text-center py-4">{error}</p>}

      {!loading && !error && actions.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">{t("noActionsYet")}</p>
      )}

      {actions.length > 0 && (
        <div className="space-y-4">
          {actions.map((action) => {
            const details = getActionDetails(action)
            const Icon = details.icon
            return (
              <div
                key={action.id}
                className="flex items-start gap-4 pb-4 border-b border-border last:border-0 last:pb-0"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 ${details.bgColor}`}
                >
                  <Icon className={`h-5 w-5 ${details.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-medium text-sm">{details.title}</p>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        action.action_type === "auto_trigger_payout"
                          ? "border-blue-400 text-blue-600"
                          : ""
                      }`}
                    >
                      {action.action_type === "auto_trigger_payout"
                        ? t("autoCron")
                        : t("adminLabel", { address: formatAddress(action.admin_address) })}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{details.description}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <time
                          dateTime={action.created_at}
                          className="text-xs text-muted-foreground cursor-default"
                          tabIndex={0}
                        >
                          {formatRelativeTime(action.created_at, locale)}
                        </time>
                      </TooltipTrigger>
                      <TooltipContent>{formatExactDateTime(action.created_at, locale)}</TooltipContent>
                    </Tooltip>
                    {action.tx_hash && (
                      <>
                        <span className="text-muted-foreground text-xs">•</span>
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${action.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                        >
                          {t("txPrefix", { hash: action.tx_hash.slice(0, 8) })}…
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
