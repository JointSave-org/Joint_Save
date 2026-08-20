"use client"

import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Bell,
  BellOff,
  ShieldCheck,
  AlertCircle,
  Loader2,
  BellRing,
} from "lucide-react"
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

function PermissionBadge({
  permission,
}: {
  permission: NotificationPermission | "unsupported"
}) {
  if (permission === "unsupported") {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <ShieldCheck className="h-3 w-3" />
        Not supported in this browser
      </Badge>
    )
  }
  if (permission === "granted") {
    return (
      <Badge variant="default" className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-xs">
        <ShieldCheck className="h-3 w-3" />
        Permission granted
      </Badge>
    )
  }
  if (permission === "denied") {
    return (
      <Badge variant="destructive" className="gap-1 text-xs">
        <AlertCircle className="h-3 w-3" />
        Permission denied — re-enable in browser settings
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <Bell className="h-3 w-3" />
      Permission not yet requested
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
            Notification Preferences
          </CardTitle>
          <CardDescription>Connect your wallet to manage push notifications.</CardDescription>
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
      label: "Deposits",
      description: "When a member makes a deposit in this pool.",
    },
    {
      key: "event_payout",
      label: "Payouts",
      description: "When a payout is distributed to a pool member.",
    },
    {
      key: "event_member_joined",
      label: "New members",
      description: "When someone joins the pool.",
    },
    {
      key: "event_member_left",
      label: "Member departures",
      description: "When a member leaves or is removed.",
    },
    {
      key: "event_deadline_warning",
      label: "Deadline warnings",
      description: "When a deposit deadline is less than 24 hours away.",
    },
    {
      key: "event_paused",
      label: "Pool paused / resumed",
      description: "When the pool is paused or unpaused by an admin.",
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
              Browser Push Notifications
            </CardTitle>
            <PermissionBadge permission={pushPermission} />
          </div>
          <CardDescription>
            Get browser notifications even when the app is not open. Works on desktop and
            supported mobile browsers.
          </CardDescription>
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
              <AlertDescription>
                Your browser does not support push notifications. In-app notifications are still
                active.
              </AlertDescription>
            </Alert>
          ) : pushPermission === "denied" ? (
            <Alert variant="destructive">
              <BellOff className="h-4 w-4" />
              <AlertDescription>
                Push notifications are blocked. Open your browser settings and allow notifications
                for this site, then come back to enable them.
              </AlertDescription>
            </Alert>
          ) : prefs.push_enabled ? (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Push notifications are enabled ✓
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  You will receive browser alerts for the events you have toggled on below.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={unsubscribePush}
                disabled={isSubscribeLoading}
                className="shrink-0"
              >
                <BellOff className="h-4 w-4 mr-1.5" />
                Disable
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">
                  Enable browser push notifications to be alerted even when the app is closed.
                </p>
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
                Enable Push
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event type toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {poolId && poolName ? `Events — ${poolName}` : "Global Event Preferences"}
          </CardTitle>
          <CardDescription>
            {poolId
              ? "Override which events trigger notifications for this specific pool."
              : "Set your default notification preferences. These apply to all pools unless overridden per-pool."}
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
