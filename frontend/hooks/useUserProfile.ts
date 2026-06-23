"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"

export interface NotificationPreferences {
  email_on_payout: boolean
  email_on_deposit: boolean
  email_on_round: boolean
  email_on_target: boolean
  email_on_reminder: boolean
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
  email_on_reminder: true,
}

export function useUserProfile(walletAddress: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchProfile = useCallback(async () => {
    if (!walletAddress) { setProfile(null); return }
    setLoading(true)
    const { data } = await supabase
      .from("user_profiles")
      .select("wallet_address, email, notification_preferences")
      .eq("wallet_address", walletAddress.toLowerCase())
      .maybeSingle()
    setProfile(
      data ?? {
        wallet_address: walletAddress.toLowerCase(),
        email: null,
        notification_preferences: DEFAULT_PREFS,
      }
    )
    setLoading(false)
  }, [walletAddress])

  useEffect(() => { fetchProfile() }, [fetchProfile])

  const saveProfile = useCallback(
    async (updates: Partial<Pick<UserProfile, "email" | "notification_preferences">>) => {
      if (!walletAddress) return
      setSaving(true)
      await supabase.from("user_profiles").upsert(
        {
          wallet_address: walletAddress.toLowerCase(),
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet_address" }
      )
      setProfile((prev) =>
        prev ? { ...prev, ...updates } : null
      )
      setSaving(false)
    },
    [walletAddress]
  )

  return { profile, loading, saving, saveProfile, refetch: fetchProfile }
}
