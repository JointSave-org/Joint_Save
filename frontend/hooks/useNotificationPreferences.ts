"use client"

import { useState, useEffect, useCallback } from "react"

export interface NotificationPreferences {
  wallet_address: string
  pool_id: string | null
  event_deposit: boolean
  event_payout: boolean
  event_member_joined: boolean
  event_member_left: boolean
  event_deadline_warning: boolean
  event_paused: boolean
  push_enabled: boolean
}

type PartialPrefs = Partial<Omit<NotificationPreferences, "wallet_address" | "pool_id">>

interface UseNotificationPreferencesResult {
  preferences: NotificationPreferences | null
  loading: boolean
  error: string | null
  /** Push permission state: 'default' | 'granted' | 'denied' | 'unsupported' */
  pushPermission: NotificationPermission | "unsupported"
  /** True if the browser + context supports Web Push */
  isPushSupported: boolean
  /** Update a subset of preferences for the given pool (or global if poolId is null). */
  updatePreference: (poolId: string | null, updates: PartialPrefs) => Promise<void>
  /** Request browser notification permission and register a push subscription. */
  subscribePush: () => Promise<void>
  /** Unregister the current browser's push subscription. */
  unsubscribePush: () => Promise<void>
}

// Default in-memory fallback when wallet is not connected.
const DEFAULTS: NotificationPreferences = {
  wallet_address: "",
  pool_id: null,
  event_deposit: true,
  event_payout: true,
  event_member_joined: true,
  event_member_left: false,
  event_deadline_warning: true,
  event_paused: true,
  push_enabled: false,
}

function getPushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
  return Notification.permission
}

function isPushSupportedCheck(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function useNotificationPreferences(
  walletAddress: string | null,
  poolId: string | null = null
): UseNotificationPreferencesResult {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(
    "default"
  )
  const isPushSupported = isPushSupportedCheck()

  // Sync push permission state on mount and when it changes.
  useEffect(() => {
    setPushPermission(getPushPermission())
  }, [])

  // Fetch preferences from the server.
  const fetchPreferences = useCallback(async () => {
    if (!walletAddress) {
      setPreferences({ ...DEFAULTS, wallet_address: walletAddress ?? "" })
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ wallet: walletAddress })
      if (poolId) params.set("poolId", poolId)
      const res = await fetch(`/api/notifications/preferences?${params}`)
      if (!res.ok) throw new Error(`Failed to fetch preferences: ${res.status}`)
      const data: NotificationPreferences = await res.json()
      setPreferences(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setPreferences({ ...DEFAULTS, wallet_address: walletAddress })
    } finally {
      setLoading(false)
    }
  }, [walletAddress, poolId])

  useEffect(() => {
    void fetchPreferences()
  }, [fetchPreferences])

  // Upsert a preference row via PUT.
  const updatePreference = useCallback(
    async (targetPoolId: string | null, updates: PartialPrefs) => {
      if (!walletAddress) return
      setError(null)
      try {
        const res = await fetch("/api/notifications/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress, pool_id: targetPoolId, ...updates }),
        })
        if (!res.ok) {
          const json = await res.json()
          throw new Error(json.error ?? "Failed to update preferences")
        }
        const updated: NotificationPreferences = await res.json()
        // Only update local state if this update matches the currently displayed preference.
        if (targetPoolId === poolId) {
          setPreferences(updated)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error")
      }
    },
    [walletAddress, poolId]
  )

  // Request permission and register a push subscription with the service worker.
  const subscribePush = useCallback(async () => {
    if (!walletAddress || !isPushSupported) return
    setError(null)

    try {
      // 1. Request notification permission.
      const permission = await Notification.requestPermission()
      setPushPermission(permission)
      if (permission !== "granted") {
        setError("Notification permission was not granted.")
        return
      }

      // 2. Wait for the service worker to be ready.
      const registration = await navigator.serviceWorker.ready

      // 3. Subscribe via PushManager.
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        setError("Push notifications are not configured on this server.")
        return
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      })

      // 4. Send the subscription to the server.
      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: walletAddress,
          subscription: subscription.toJSON(),
        }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? "Failed to store subscription")
      }

      // 5. Reflect the change locally.
      setPreferences((prev) => (prev ? { ...prev, push_enabled: true } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to subscribe to push notifications")
    }
  }, [walletAddress, isPushSupported])

  // Unsubscribe from browser push.
  const unsubscribePush = useCallback(async () => {
    if (!walletAddress || !isPushSupported) return
    setError(null)

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) return

      const endpoint = subscription.endpoint
      await subscription.unsubscribe()

      // Notify server to remove the subscription row.
      await fetch("/api/notifications/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddress, endpoint }),
      })

      setPreferences((prev) => (prev ? { ...prev, push_enabled: false } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unsubscribe")
    }
  }, [walletAddress, isPushSupported])

  return {
    preferences,
    loading,
    error,
    pushPermission,
    isPushSupported,
    updatePreference,
    subscribePush,
    unsubscribePush,
  }
}

// Convert VAPID public key from base64url to Uint8Array for PushManager.subscribe.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)))
}
