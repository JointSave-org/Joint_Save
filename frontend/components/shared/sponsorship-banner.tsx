"use client"

import { useState, useEffect } from "react"
import { CheckCircle, XCircle, Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

interface SponsorshipBannerProps {
  /** Whether the user is eligible for sponsorship (call /api/sponsor/eligible first). */
  isEligible: boolean
  /** Current state of the sponsorship flow. */
  status?: "idle" | "loading" | "sponsored" | "failed"
  /** Optional message to display (e.g., failure reason). */
  message?: string
  /** Auto-hide delay in ms after successful sponsorship. 0 = don't auto-hide. */
  autoHideMs?: number
  className?: string
}

/**
 * Green banner shown during first deposit to inform the user their
 * transaction fee is sponsored by JointSave.
 *
 * Auto-hides after `autoHideMs` (default 5000ms) once status is "sponsored".
 */
export function SponsorshipBanner({
  isEligible,
  status = "idle",
  message,
  autoHideMs = 5000,
  className,
}: SponsorshipBannerProps) {
  const [visible, setVisible] = useState(isEligible)

  useEffect(() => {
    setVisible(isEligible)
  }, [isEligible])

  useEffect(() => {
    if (status === "sponsored" && autoHideMs > 0) {
      const timer = setTimeout(() => setVisible(false), autoHideMs)
      return () => clearTimeout(timer)
    }
  }, [status, autoHideMs])

  if (!visible || !isEligible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
        "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
        status === "failed" &&
          "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
        className
      )}
    >
      {status === "loading" && (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-green-600 dark:text-green-400" />
      )}
      {status === "idle" && (
        <Sparkles className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
      )}
      {status === "sponsored" && (
        <CheckCircle className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
      )}
      {status === "failed" && (
        <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
      )}

      <span className="flex-1">
        {status === "idle" && "First deposit? Transaction fees are on us!"}
        {status === "loading" && "Sponsoring your transaction fee..."}
        {status === "sponsored" && "Your first deposit transaction fee is sponsored by JointSave!"}
        {status === "failed" && (message || "Sponsorship unavailable. You will pay the standard fee.")}
      </span>
    </div>
  )
}
