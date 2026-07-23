"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js"
import { NOTIFICATION_BADGE_MAX } from "@/lib/constants"

const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"

export interface AppNotification {
  id: string
  pool_id: string | null
  activity_type: string
  message: string
  read: boolean
  created_at: string
}

export function useNotifications(walletAddress: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(false)
  const hasLoadedOnce = useRef(false)

  useEffect(() => {
    hasLoadedOnce.current = false
  }, [walletAddress])

  const loadNotifications = useCallback(async () => {
    if (!walletAddress || IS_E2E) {
      setNotifications([])
      return
    }
    setLoading(true)
    if (!hasLoadedOnce.current) setInitialLoading(true)
    const res = await window.fetch(
      `/api/notifications?wallet=${encodeURIComponent(walletAddress.toLowerCase())}`
    )
    const data = res.ok ? await res.json() : []
    setNotifications(data)
    setLoading(false)
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true
      setInitialLoading(false)
    }
  }, [walletAddress])

  useEffect(() => {
    loadNotifications()
    if (!walletAddress || IS_E2E) return

    const channel = supabase
      .channel(`notifications:${walletAddress}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `wallet_address=eq.${walletAddress.toLowerCase()}`,
        },
        (payload: RealtimePostgresInsertPayload<AppNotification>) => {
          setNotifications((prev) =>
            [payload.new as AppNotification, ...prev].slice(0, NOTIFICATION_BADGE_MAX)
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [walletAddress, loadNotifications])

  const markAllRead = useCallback(async () => {
    if (!walletAddress || IS_E2E) return
    await window.fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address: walletAddress.toLowerCase() }),
    })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [walletAddress])

  const unreadCount = notifications.filter((n) => !n.read).length

  return {
    notifications,
    loading,
    initialLoading,
    unreadCount,
    markAllRead,
    refetch: loadNotifications,
  }
}
