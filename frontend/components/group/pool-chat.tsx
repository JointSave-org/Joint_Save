"use client"

/**
 * PoolChat — Real-time group discussion panel for a single pool.
 *
 * Features:
 *  - Live message delivery via Supabase Realtime (no polling)
 *  - Infinite scroll — "Load earlier messages" when hasMore is true
 *  - Optimistic send with rollback on failure
 *  - Client-side 3-second rate-limit guard with countdown badge
 *  - Message length cap enforced in the textarea
 *  - Auto-scroll to newest message on initial load and on new arrivals
 *  - Non-member wall: shows a friendly empty state if wallet not in pool
 *  - Fully mobile-responsive
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useStellar } from "@/components/web3-provider"
import { usePoolChat, type PoolMessage } from "@/hooks/usePoolChat"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CHAT_MESSAGE_MAX_LENGTH } from "@/lib/constants"
import { MessageSquare, Send, ChevronUp, AlertCircle, Loader2, Clock, Wifi } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Sub-components ────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** A single chat bubble */
function MessageBubble({ msg, isOwn }: { msg: PoolMessage; isOwn: boolean }) {
  const isOptimistic = msg.id.startsWith("optimistic-")

  return (
    <div className={cn("flex flex-col gap-0.5", isOwn ? "items-end" : "items-start")}>
      {/* Sender label (only for others' messages) */}
      {!isOwn && (
        <span className="text-xs text-muted-foreground px-1">
          {shortAddress(msg.sender_address)}
        </span>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words",
          isOwn
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
          isOptimistic && "opacity-60"
        )}
      >
        {msg.message}
      </div>
      <span className="text-[10px] text-muted-foreground px-1">
        {isOptimistic ? (
          <span className="flex items-center gap-1">
            <Loader2 className="h-2.5 w-2.5 animate-spin" /> Sending…
          </span>
        ) : (
          formatTime(msg.created_at)
        )}
      </span>
    </div>
  )
}

/** Skeleton placeholder rows while loading */
function MessageSkeletons() {
  return (
    <div className="flex flex-col gap-3 px-4 py-2">
      {[...Array(4)].map((_, i) => (
        <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
          <Skeleton className="h-8 rounded-2xl" style={{ width: `${40 + (i % 3) * 15}%` }} />
        </div>
      ))}
    </div>
  )
}

/** Empty state shown when no messages have been sent yet */
function EmptyChat() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground py-10">
      <MessageSquare className="h-8 w-8 opacity-30" />
      <p className="text-sm">No messages yet. Be the first to say something!</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface PoolChatProps {
  poolId: string
  /** Whether the current wallet is a verified member (passed from GroupDetails / GroupClient) */
  isMember: boolean
}

export function PoolChat({ poolId, isMember }: PoolChatProps) {
  const { address: walletAddress } = useStellar()

  const {
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
  } = usePoolChat({
    poolId,
    walletAddress: isMember ? (walletAddress ?? null) : null,
  })

  const [draft, setDraft] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef(0)

  // Auto-scroll to bottom when new messages arrive (not when loading older ones)
  const isFirstLoad = useRef(true)
  useEffect(() => {
    if (loading) return
    if (isFirstLoad.current) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" })
      isFirstLoad.current = false
      return
    }
    const list = listRef.current
    if (!list) return
    // Only auto-scroll if the user is already near the bottom
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, loading])

  // Preserve scroll position when older messages are prepended
  useEffect(() => {
    if (!loadingOlder) return
    const list = listRef.current
    if (list) prevScrollHeightRef.current = list.scrollHeight
  }, [loadingOlder])

  useEffect(() => {
    if (loadingOlder) return
    const list = listRef.current
    if (list && prevScrollHeightRef.current > 0) {
      list.scrollTop = list.scrollHeight - prevScrollHeightRef.current
      prevScrollHeightRef.current = 0
    }
  }, [messages, loadingOlder])

  const handleSend = () => {
    if (!draft.trim() || rateLimited) return
    sendMessage(draft)
    setDraft("")
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter; Shift+Enter inserts a newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const charsLeft = CHAT_MESSAGE_MAX_LENGTH - draft.length

  // ── Non-member wall ─────────────────────────────────────────────────────
  if (!isMember) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
          <MessageSquare className="h-8 w-8 opacity-30" />
          <p className="text-sm text-center">
            Only members of this pool can view and participate in the discussion.
          </p>
        </CardContent>
      </Card>
    )
  }

  // ── Main UI ─────────────────────────────────────────────────────────────
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="py-3 px-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Discussion</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-emerald-500">
            <Wifi className="h-3 w-3" />
            <span>Live</span>
          </div>
        </div>
      </CardHeader>

      {/* Message list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto min-h-[280px] max-h-[420px] px-4 py-3 space-y-3"
      >
        {/* Load earlier button */}
        {hasMore && (
          <div className="flex justify-center mb-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1"
              onClick={loadOlderMessages}
              disabled={loadingOlder}
            >
              {loadingOlder ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronUp className="h-3 w-3" />
              )}
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        )}

        {loading ? (
          <MessageSkeletons />
        ) : messages.length === 0 ? (
          <EmptyChat />
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isOwn={msg.sender_address === walletAddress?.toLowerCase()}
            />
          ))
        )}

        <div ref={bottomRef} />
      </div>

      {/* Send error banner */}
      {sendError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{sendError}</span>
        </div>
      )}

      {/* Input area */}
      <div className="border-t px-3 py-2">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              className={cn(
                "w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-primary/50",
                "min-h-[40px] max-h-[120px] leading-snug",
                "placeholder:text-muted-foreground disabled:opacity-50"
              )}
              rows={1}
              placeholder={
                rateLimited
                  ? `Wait ${(rateLimitRemainingMs / 1000).toFixed(1)}s…`
                  : "Type a message… (Enter to send)"
              }
              value={draft}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!walletAddress || isSending}
              aria-label="Chat message input"
            />
            {/* Character counter — only show when approaching limit */}
            {charsLeft < 80 && (
              <span
                className={cn(
                  "absolute bottom-1.5 right-2 text-[10px] select-none",
                  charsLeft < 20 ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {charsLeft}
              </span>
            )}
          </div>

          <Button
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            onClick={handleSend}
            disabled={!draft.trim() || isSending || rateLimited || !walletAddress}
            aria-label="Send message"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : rateLimited ? (
              <Clock className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Wallet not connected notice */}
        {!walletAddress && (
          <p className="text-xs text-muted-foreground mt-1">
            Connect your wallet to participate in the discussion.
          </p>
        )}
      </div>
    </Card>
  )
}
