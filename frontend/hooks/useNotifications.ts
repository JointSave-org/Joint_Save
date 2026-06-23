"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"

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

  const fetch = useCallback(async () => {
    if (!walletAddress) { setNotifications([]); return }
    setLoading(true)
    const { data } = await supabase
      .from("notifications")
      .select("id, pool_id, activity_type, message, read, created_at")
      .eq("wallet_address", walletAddress.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(10)
    setNotifications((data as AppNotification[]) ?? [])
    setLoading(false)
  }, [walletAddress])

  useEffect(() => {
    fetch()
    if (!walletAddress) return

    // Real-time: prepend new notifications as they arrive
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
        (payload: any) => {
          setNotifications((prev) =>
            [payload.new as AppNotification, ...prev].slice(0, 10)
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [walletAddress, fetch])

  const markAllRead = useCallback(async () => {
    if (!walletAddress) return
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("wallet_address", walletAddress.toLowerCase())
      .eq("read", false)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [walletAddress])

  const unreadCount = notifications.filter((n) => !n.read).length

  return { notifications, loading, unreadCount, markAllRead, refetch: fetch }
}
