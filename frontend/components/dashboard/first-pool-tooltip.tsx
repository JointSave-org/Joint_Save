"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"

const STORAGE_KEY = "jointsave:has-created-first-pool"

interface FirstPoolTooltipProps {
  /** Number of pools the user currently has. Tooltip only shows when exactly 1. */
  poolCount: number
}

export function FirstPoolTooltip({ poolCount }: FirstPoolTooltipProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Show only when the user has exactly one pool and hasn't dismissed yet
    if (poolCount !== 1) return
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY)
      if (!dismissed) setVisible(true)
    } catch {
      // localStorage unavailable (SSR or private mode) — silently skip
    }
  }, [poolCount])

  const dismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem(STORAGE_KEY, "true")
    } catch {
      // ignore
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="tooltip"
          aria-live="polite"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground shadow-sm"
        >
          <span className="flex-1">
            🎉 <strong>Great!</strong> Invite members or make your first deposit to get started.
          </span>
          <button
            onClick={dismiss}
            aria-label="Dismiss tip"
            className="shrink-0 rounded p-0.5 hover:bg-primary/20 transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
