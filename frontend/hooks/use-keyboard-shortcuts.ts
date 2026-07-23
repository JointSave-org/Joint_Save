"use client"

import { useEffect, useRef } from "react"

type ShortcutHandlers = {
  onCreatePool: () => void
  onGoToGroups: () => void
  onGoToPortfolio: () => void
  onGoToTransactions: () => void
  onGoToProfile: () => void
  onOpenHelp: () => void
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return
      }

      const key = e.key

      if (gTimerRef.current !== null) {
        clearTimeout(gTimerRef.current)
        gTimerRef.current = null
        const lowerKey = key.toLowerCase()
        if (lowerKey === "h" || lowerKey === "f" || lowerKey === "t" || lowerKey === "p") {
          e.preventDefault()
          switch (lowerKey) {
            case "h":
              handlersRef.current.onGoToGroups()
              break
            case "f":
              handlersRef.current.onGoToPortfolio()
              break
            case "t":
              handlersRef.current.onGoToTransactions()
              break
            case "p":
              handlersRef.current.onGoToProfile()
              break
          }
          return
        }
        return
      }

      if (key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        handlersRef.current.onOpenHelp()
        return
      }

      if (key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        handlersRef.current.onCreatePool()
        return
      }

      if (key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        gTimerRef.current = setTimeout(() => {
          gTimerRef.current = null
        }, 1000)
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      if (gTimerRef.current) clearTimeout(gTimerRef.current)
    }
  }, [])
}
