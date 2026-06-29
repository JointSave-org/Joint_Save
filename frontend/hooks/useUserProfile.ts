"use client"

import { useState, useEffect, useCallback } from "react"

const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"

export interface NotificationPreferences {
  email_on_payout: boolean
  email_on_deposit: boolean
  email_on_round: boolean
  email_on_target: boolean
  email_on_deposit_reminder: boolean
}

export interface UserProfile {
  wallet_address: string
  email: string | null
  notification_preferences: NotificationPreferences
}

const DEFAULT_PREFS: NotificationPreferences = {
  email_on_payout: true,
  email_on_deposit: true,
  email_on_round: true,
  email_on_target: true,
  email_on_deposit_reminder: true,
}

export function useUserProfile(walletAddress: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchProfile = useCallback(async () => {
    if (!walletAddress || IS_E2E) {
      setProfile(
        walletAddress
          ? {
              wallet_address: walletAddress.toLowerCase(),
              email: null,
              notification_preferences: DEFAULT_PREFS,
            }
          : null
      )
      return
    }
    setLoading(true)
    const res = await fetch(
      `/api/user-profile?wallet=${encodeURIComponent(walletAddress.toLowerCase())}`
    )
    const data = res.ok ? await res.json() : null
    setProfile(
      data ?? {
        wallet_address: walletAddress.toLowerCase(),
        email: null,
        notification_preferences: DEFAULT_PREFS,
      }
    )
    setLoading(false)
  }, [walletAddress])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const saveProfile = useCallback(
    async (updates: Partial<Pick<UserProfile, "email" | "notification_preferences">>) => {
      if (!walletAddress) return
      if (IS_E2E) {
        setProfile((prev) => (prev ? { ...prev, ...updates } : null))
        return
      }
      setSaving(true)
      await fetch("/api/user-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: walletAddress.toLowerCase(), ...updates }),
      })
      setProfile((prev) => (prev ? { ...prev, ...updates } : null))
      setSaving(false)
    },
    [walletAddress]
  )

  return { profile, loading, saving, saveProfile, refetch: fetchProfile }
}
