"use client"

/**
 * usePoolChat
 *
 * Manages the full lifecycle of a pool chat room:
 *  - Initial history load (most-recent PAGE_SIZE messages)
 *  - Infinite-scroll "load older messages" via cursor pagination
 *  - Supabase Realtime subscription for live delivery of new messages
 *  - Optimistic send with rollback on failure
 *  - Client-side rate-limit guard (3 s between sends)
 *
 * The hook is intentionally self-contained so the PoolChat component
 * stays a pure presentational layer.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { CHAT_RATE_LIMIT_MS, CHAT_MESSAGE_MAX_LENGTH } from "@/lib/constants"
import type { RealtimeChannel, RealtimePostgresInsertPayload } from "@supabase/supabase-js"

export interface PoolMessage {
  id: string
  pool_id: string
  sender_address: string
  message: string
  created_at: string
}

export type RealtimeStatus = "connecting" | "connected" | "disconnected"

interface UsePoolChatOptions {
  poolId: string
  walletAddress: string | null
}

interface UsePoolChatReturn {
  messages: PoolMessage[]
  loading: boolean
  loadingOlder: boolean
  hasMore: boolean
  sendError: string | null
  isSending: boolean
  sendMessage: (text: string) => Promise<void>
  loadOlderMessages: () => Promise<void>
  /** True while the client is blocked by the 3-second rate limit */
  rateLimited: boolean
  /** Milliseconds remaining until next send is allowed */
  rateLimitRemainingMs: number
  /** Supabase Realtime connection status */
  realtimeStatus: RealtimeStatus
}

const IS_E2E = process.env.NEXT_PUBLIC_E2E === "true"

export function usePoolChat({ poolId, walletAddress }: UsePoolChatOptions): UsePoolChatReturn {
  const [messages, setMessages] = useState<PoolMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting")

  // Client-side rate-limit state
  const lastSentAt = useRef<number>(0)
  const [rateLimited, setRateLimited] = useState(false)
  const [rateLimitRemainingMs, setRateLimitRemainingMs] = useState(0)
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Deduplicate incoming realtime messages (can arrive before POST response)
  const seenIds = useRef(new Set<string>())

  // Ref to the oldest message timestamp — avoids including `messages` in the
  // loadOlderMessages dependency array (which would recreate the callback on
  // every new message).
  const oldestCreatedAtRef = useRef<string | null>(null)

  // Keep oldestCreatedAtRef in sync whenever messages change
  useEffect(() => {
    oldestCreatedAtRef.current = messages.length > 0 ? messages[0].created_at : null
  }, [messages])

  // ── Load initial history ──────────────────────────────────────────────────

  useEffect(() => {
    if (!poolId || !walletAddress || IS_E2E) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setMessages([])
    seenIds.current.clear()
    oldestCreatedAtRef.current = null

    fetch(
      `/api/pools/messages?pool_id=${encodeURIComponent(poolId)}&wallet=${encodeURIComponent(walletAddress)}`
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { messages: PoolMessage[]; hasMore: boolean }) => {
        if (cancelled) return
        setMessages(data.messages)
        data.messages.forEach((m) => seenIds.current.add(m.id))
        setHasMore(data.hasMore)
      })
      .catch(() => {
        if (!cancelled) setMessages([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [poolId, walletAddress])

  // ── Supabase Realtime subscription with reconnection handling ─────────────

  useEffect(() => {
    if (!poolId || !walletAddress || IS_E2E || !supabase) return

    setRealtimeStatus("connecting")

    const channel: RealtimeChannel = supabase
      .channel(`pool_messages:${poolId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pool_messages",
          filter: `pool_id=eq.${poolId}`,
        },
        (payload: RealtimePostgresInsertPayload<PoolMessage>) => {
          const incoming = payload.new as PoolMessage
          // Ignore if we already added it via optimistic update
          if (seenIds.current.has(incoming.id)) return
          seenIds.current.add(incoming.id)
          setMessages((prev) => [...prev, incoming])
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected")
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setRealtimeStatus("disconnected")
        } else {
          // TIMED_OUT or other transient states — show as connecting
          setRealtimeStatus("connecting")
        }
      })

    return () => {
      supabase.removeChannel(channel)
      setRealtimeStatus("disconnected")
    }
  }, [poolId, walletAddress])

  // ── Load older messages (infinite scroll) ────────────────────────────────
  // Uses oldestCreatedAtRef instead of reading messages[0] directly so this
  // callback is NOT recreated on every new message arrival.

  const loadOlderMessages = useCallback(async () => {
    if (!poolId || !walletAddress || loadingOlder || !hasMore) return

    const cursor = oldestCreatedAtRef.current
    if (!cursor) return

    setLoadingOlder(true)
    try {
      const res = await fetch(
        `/api/pools/messages?pool_id=${encodeURIComponent(poolId)}&wallet=${encodeURIComponent(walletAddress)}&cursor=${encodeURIComponent(cursor)}`
      )
      if (!res.ok) return
      const data: { messages: PoolMessage[]; hasMore: boolean } = await res.json()
      data.messages.forEach((m) => seenIds.current.add(m.id))
      setMessages((prev) => [...data.messages, ...prev])
      setHasMore(data.hasMore)
    } finally {
      setLoadingOlder(false)
    }
  }, [poolId, walletAddress, loadingOlder, hasMore])
  // NOTE: `messages` intentionally excluded — cursor is read via ref.

  // ── Rate-limit countdown ticker ───────────────────────────────────────────

  const startRateLimitCountdown = useCallback(() => {
    if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
    setRateLimited(true)

    rateLimitTimerRef.current = setInterval(() => {
      const remaining = CHAT_RATE_LIMIT_MS - (Date.now() - lastSentAt.current)
      if (remaining <= 0) {
        setRateLimited(false)
        setRateLimitRemainingMs(0)
        if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
      } else {
        setRateLimitRemainingMs(remaining)
      }
    }, 100)
  }, [])

  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
    }
  }, [])

  // ── Send a message ────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !walletAddress || isSending) return
      if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) return

      // Client-side rate limit guard
      const now = Date.now()
      const waitMs = CHAT_RATE_LIMIT_MS - (now - lastSentAt.current)
      if (waitMs > 0) {
        startRateLimitCountdown()
        return
      }

      setSendError(null)
      setIsSending(true)

      // Optimistic message — temporary id prefixed so dedup doesn't block the
      // real record when it arrives via realtime
      const optimisticId = `optimistic-${crypto.randomUUID()}`
      const optimisticMsg: PoolMessage = {
        id: optimisticId,
        pool_id: poolId,
        sender_address: walletAddress.toLowerCase(),
        message: trimmed,
        created_at: new Date().toISOString(),
      }
      seenIds.current.add(optimisticId)
      setMessages((prev) => [...prev, optimisticMsg])

      try {
        const res = await fetch("/api/pools/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pool_id: poolId,
            wallet_address: walletAddress,
            message: trimmed,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to send" }))
          throw new Error(err.error ?? "Failed to send")
        }

        const { message: saved }: { message: PoolMessage } = await res.json()

        // Replace optimistic record with the real one
        seenIds.current.delete(optimisticId)
        seenIds.current.add(saved.id)
        setMessages((prev) => prev.map((m) => (m.id === optimisticId ? saved : m)))

        lastSentAt.current = Date.now()
        startRateLimitCountdown()
      } catch (err) {
        // Rollback optimistic message
        seenIds.current.delete(optimisticId)
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        setSendError(err instanceof Error ? err.message : "Failed to send message")
      } finally {
        setIsSending(false)
      }
    },
    [poolId, walletAddress, isSending, startRateLimitCountdown]
  )

  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    sendError,
    isSending,
    sendMessage,
    loadOlderMessages,
    rateLimited,
    rateLimitRemainingMs,
    realtimeStatus,
  }
}
