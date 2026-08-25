"use client"

import { useTranslations } from "next-intl"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Bell, BellOff, ShieldCheck, AlertCircle, Loader2, BellRing } from "lucide-react"
import {
  useNotificationPreferences,
  type NotificationPreferences,
} from "@/hooks/useNotificationPreferences"

interface EventToggleProps {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

function EventToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: EventToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="text-sm font-medium cursor-pointer">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  )
}

// ─── Permission status badge ──────────────────────────────────────────────────

function PermissionBadge({ permission }: { permission: NotificationPermission | "unsupported" }) {
  const t = useTranslations("settings.preferences")
  if (permission === "unsupported") {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <ShieldCheck className="h-3 w-3" />
        {t("notSupported")}
      </Badge>
    )
  }
  if (permission === "granted") {
    return (
      <Badge variant="default" className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-xs">
        <ShieldCheck className="h-3 w-3" />
        {t("permissionGranted")}
      </Badge>
    )
  }
  if (permission === "denied") {
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <AlertCircle className="h-3 w-3" />
        {t("permissionDenied")}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <Bell className="h-3 w-3" />
      {t("permissionNotRequested")}
    </Badge>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

interface NotificationPreferencesProps {
  walletAddress: string | null
  /** If provided, shows per-pool overrides section for this pool. */
  poolId?: string | null
  poolName?: string | null
}

export function NotificationPreferencesPanel({
  walletAddress,
  poolId = null,
  poolName,
}: NotificationPreferencesProps) {
  const t = useTranslations("settings.preferences")
  const {
    preferences,
    loading,
    error,
    pushPermission,
    isPushSupported,
    updatePreference,
    subscribePush,
    unsubscribePush,
  } = useNotificationPreferences(walletAddress, poolId)

  if (!walletAddress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("connectWalletNotice")}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  const prefs = preferences
  if (!prefs) return null

  type EventKey = keyof Pick<
    NotificationPreferences,
    | "event_deposit"
    | "event_payout"
    | "event_member_joined"
    | "event_member_left"
    | "event_deadline_warning"
    | "event_paused"
  >

  const eventToggles: { key: EventKey; label: string; description: string }[] = [
    {
      key: "event_deposit",
      label: t("eventDepositLabel"),
      description: t("eventDepositDescription"),
    },
    {
      key: "event_payout",
      label: t("eventPayoutLabel"),
      description: t("eventPayoutDescription"),
    },
    {
      key: "event_member_joined",
      label: t("eventMemberJoinedLabel"),
      description: t("eventMemberJoinedDescription"),
    },
    {
      key: "event_member_left",
      label: t("eventMemberLeftLabel"),
      description: t("eventMemberLeftDescription"),
    },
    {
      key: "event_deadline_warning",
      label: t("eventDeadlineWarningLabel"),
      description: t("eventDeadlineWarningDescription"),
    },
    {
      key: "event_paused",
      label: t("eventPausedLabel"),
      description: t("eventPausedDescription"),
    },
  ]

  const isSubscribeLoading = false // subscribe is async; loading state handled internally

  return (
    <div className="space-y-6">
      {/* Push notification toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-5 w-5" />
              {t("browserPushTitle")}
            </CardTitle>
            <PermissionBadge permission={pushPermission} />
          </div>
          <CardDescription>{t("browserPushDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!isPushSupported ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t("pushNotSupported")}</AlertDescription>
            </Alert>
          ) : pushPermission === "denied" ? (
            <Alert variant="destructive">
              <BellOff className="h-4 w-4" />
              <AlertDescription>{t("pushBlocked")}</AlertDescription>
            </Alert>
          ) : prefs.push_enabled ? (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {t("pushEnabled")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("pushEnabledHint")}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={unsubscribePush}
                disabled={isSubscribeLoading}
                className="shrink-0"
              >
                <BellOff className="h-4 w-4 mr-1.5" />
                {t("disable")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">{t("enablePushHint")}</p>
              </div>
              <Button
                size="sm"
                onClick={subscribePush}
                disabled={isSubscribeLoading || (pushPermission as string) === "denied"}
                className="shrink-0"
              >
                {isSubscribeLoading ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Bell className="h-4 w-4 mr-1.5" />
                )}
                {t("enablePush")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event type toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {poolId && poolName ? t("eventsForPool", { poolName }) : t("globalEventPreferences")}
          </CardTitle>
          <CardDescription>
            {poolId ? t("perPoolOverrideDescription") : t("globalPreferencesDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {eventToggles.map(({ key, label, description }) => (
            <EventToggle
              key={key}
              id={`${poolId ?? "global"}-${key}`}
              label={label}
              description={description}
              checked={prefs[key]}
              onCheckedChange={(checked) => updatePreference(poolId ?? null, { [key]: checked })}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
