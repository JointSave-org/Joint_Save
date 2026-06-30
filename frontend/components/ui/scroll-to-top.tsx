"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

/**
 * Scrolls to the top of the page on every client-side route change.
 *
 * Skips scroll reset for popstate (browser back/forward) events so that the
 * browser's native scroll restoration can do its job for those navigations.
 */
export function ScrollToTop() {
  const pathname = usePathname()
  const isPopStateRef = useRef(false)

  useEffect(() => {
    const handlePopState = () => {
      isPopStateRef.current = true
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  useEffect(() => {
    if (isPopStateRef.current) {
      isPopStateRef.current = false
      return
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" })
  }, [pathname])

  return null
}
