"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, Send, MessageSquare, Loader2, Lock, Sparkles } from "lucide-react"
import { getSupabaseClient } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { motion, AnimatePresence } from "framer-motion"

interface GroupDiscussionProps {
  groupId: string
  walletAddress: string | null
}

interface Message {
  id: string
  pool_id: string
  sender_address: string
  message: string
  created_at: string
}

export function GroupDiscussion({ groupId, walletAddress }: GroupDiscussionProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState("")
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0)

  const { toast } = useToast()
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom helper
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior })
    }, 50)
  }, [])

  // Fetch initial chat history
  const fetchMessages = useCallback(async () => {
    if (!walletAddress) return
    setIsLoadingHistory(true)
    setError(null)
    
    try {
      const client = getSupabaseClient(walletAddress)
      if (!client) throw new Error("Supabase client not initialized")
      
      const { data, error: dbError } = await client
        .from("pool_messages")
        .select("*")
        .eq("pool_id", groupId)
        .order("created_at", { ascending: true })
        
      if (dbError) {
        console.error("Fetch messages error:", dbError)
        setError("Failed to load chat history. Ensure you are an active member of this pool.")
      } else {
        setMessages(data || [])
        scrollToBottom("auto")
      }
    } catch (err: any) {
      console.error("Fetch messages catch:", err)
      setError(err.message || "An unexpected error occurred.")
    } finally {
      setIsLoadingHistory(false)
    }
  }, [groupId, walletAddress, scrollToBottom])

  // Setup Real-time listener and fetch history
  useEffect(() => {
    if (!walletAddress) return
    
    fetchMessages()

    const client = getSupabaseClient(walletAddress)
    if (!client) return

    const channel = client
      .channel(`pool_messages:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pool_messages",
          filter: `pool_id=eq.${groupId}`,
        },
        (payload: any) => {
          const newMessage = payload.new as Message
          setMessages((prev) => {
            // Avoid duplicate additions
            if (prev.some((m) => m.id === newMessage.id)) return prev
            return [...prev, newMessage]
          })
          scrollToBottom()
        }
      )
      .subscribe()

    return () => {
      client.removeChannel(channel)
    }
  }, [groupId, walletAddress, fetchMessages, scrollToBottom])

  // Decrement rate limit timer
  useEffect(() => {
    if (rateLimitSeconds <= 0) return
    const timer = setTimeout(() => {
      setRateLimitSeconds((prev) => prev - 1)
    }, 1000)
    return () => clearTimeout(timer)
  }, [rateLimitSeconds])

  // Format addresses for display
  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  // Handle message submission
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    
    const trimmed = inputText.trim()
    if (!trimmed || !walletAddress) return
    if (trimmed.length > 1000) {
      toast({
        title: "Message too long",
        description: "Messages cannot exceed 1000 characters.",
        variant: "destructive",
      })
      return
    }

    if (rateLimitSeconds > 0) {
      toast({
        title: "Slow down",
        description: `Please wait ${rateLimitSeconds} seconds before sending another message.`,
        variant: "destructive",
      })
      return
    }

    setIsSending(true)
    try {
      const client = getSupabaseClient(walletAddress)
      if (!client) throw new Error("Supabase client not initialized")

      const { error: insertError } = await client
        .from("pool_messages")
        .insert([
          {
            pool_id: groupId,
            sender_address: walletAddress.toLowerCase(),
            message: trimmed,
          },
        ])

      if (insertError) {
        throw insertError
      }

      setInputText("")
      setRateLimitSeconds(3) // 3 seconds rate limit
      scrollToBottom()
    } catch (err: any) {
      console.error("Send message error:", err)
      const errorMsg = err.message || ""
      
      if (errorMsg.includes("Rate limit")) {
        toast({
          title: "Rate limit exceeded",
          description: "Please wait 3 seconds between messages.",
          variant: "destructive",
        })
      } else {
        toast({
          title: "Failed to send",
          description: "Only active members of this pool can send messages.",
          variant: "destructive",
        })
      }
    } finally {
      setIsSending(false)
    }
  }

  // Handle keypress inside textarea (Enter to send, Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  if (!walletAddress) {
    return (
      <Card className="p-8 text-center flex flex-col items-center justify-center space-y-4 border border-dashed min-h-[300px]">
        <div className="p-4 rounded-full bg-muted">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="max-w-sm space-y-2">
          <h4 className="font-semibold text-lg">Wallet Connection Required</h4>
          <p className="text-sm text-muted-foreground">
            Please connect your wallet at the top of the dashboard to view and participate in this pool's discussions.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col h-[550px] overflow-hidden border bg-card/60 backdrop-blur-md shadow-lg relative">
      {/* Discussion Header */}
      <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <span className="font-semibold">Pool Discussion</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-xs text-muted-foreground font-medium">Live Chat</span>
        </div>
      </div>

      {/* Message Area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 p-4 relative">
        {isLoadingHistory ? (
          <div className="space-y-4 pr-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`flex items-start gap-3 ${i % 2 === 0 ? "flex-row-reverse" : ""}`}>
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-2 max-w-[70%]">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-[200px] rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-6 space-y-3">
            <AlertCircle className="h-10 w-10 text-destructive animate-bounce" />
            <h4 className="font-semibold text-destructive">Access Restricted</h4>
            <p className="text-sm text-muted-foreground max-w-sm">
              {error}
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center p-6 space-y-3">
            <div className="p-4 rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary animate-pulse" />
            </div>
            <h4 className="font-semibold text-foreground">Welcome to the Pool!</h4>
            <p className="text-sm text-muted-foreground max-w-xs">
              This chat is secure and private to pool members. Start by saying hello to your fellow members!
            </p>
          </div>
        ) : (
          <div className="space-y-4 pr-3">
            <AnimatePresence initial={false}>
              {messages.map((msg) => {
                const isMe = msg.sender_address.toLowerCase() === walletAddress.toLowerCase()
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-start gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}
                  >
                    <Avatar className="h-8 w-8 border shrink-0">
                      <AvatarFallback className={isMe ? "bg-primary text-primary-foreground text-xs" : "bg-muted text-muted-foreground text-xs"}>
                        {msg.sender_address.slice(2, 4).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className={`flex flex-col max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs font-mono font-medium text-muted-foreground">
                          {formatAddress(msg.sender_address)}
                        </span>
                        {isMe && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-primary/20 bg-primary/5 text-primary font-normal">
                            You
                          </Badge>
                        )}
                      </div>
                      
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap ${
                          isMe
                            ? "bg-primary text-primary-foreground rounded-tr-none shadow-md"
                            : "bg-muted/65 text-foreground rounded-tl-none border border-muted"
                        }`}
                      >
                        {msg.message}
                      </div>
                      
                      <span className="text-[10px] text-muted-foreground/80 mt-1">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input Form */}
      {!error && (
        <form onSubmit={handleSendMessage} className="p-4 border-t bg-muted/10 space-y-2">
          <div className="relative flex items-end gap-2">
            <Textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={rateLimitSeconds > 0 ? `Wait ${rateLimitSeconds}s...` : "Type a message..."}
              disabled={isSending || rateLimitSeconds > 0}
              className="min-h-[44px] max-h-[120px] resize-none pr-12 rounded-xl focus-visible:ring-1 focus-visible:ring-primary/40 border bg-background/50"
              rows={1}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!inputText.trim() || isSending || rateLimitSeconds > 0}
              className="rounded-xl shrink-0 h-11 w-11 shadow-sm hover:scale-105 transition-transform"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          
          <div className="flex justify-between items-center px-1 text-[10px] text-muted-foreground">
            <span>
              {rateLimitSeconds > 0 && (
                <span className="text-amber-500 font-medium">
                  Rate limited: {rateLimitSeconds}s remaining
                </span>
              )}
            </span>
            <span className={inputText.length > 1000 ? "text-destructive font-medium" : ""}>
              {inputText.length} / 1000
            </span>
          </div>
        </form>
      )}
    </Card>
  )
}
