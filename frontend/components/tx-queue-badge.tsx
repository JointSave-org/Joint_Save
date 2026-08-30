"use client"

/**
 * Small floating badge that shows "N transactions waiting for your approval"
 * whenever more than one signing request is queued (see lib/tx-queue.ts).
 * Renders nothing when the queue has 0 or 1 entries, since a single pending
 * request is the normal case and doesn't need a special indicator.
 */

import { useEffect, useState } from "react"
import { subscribeToQueueLength } from "@/lib/tx-queue"

export function TxQueueBadge() {
  const [queueLength, setQueueLength] = useState(0)

  useEffect(() => {
    return subscribeToQueueLength(setQueueLength)
  }, [])

  if (queueLength <= 1) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-600 shadow-lg backdrop-blur-sm dark:text-yellow-400"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
      {queueLength} transactions waiting for your approval
    </div>
  )
}
