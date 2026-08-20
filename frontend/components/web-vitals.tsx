"use client"

import { useEffect } from "react"

export function WebVitals() {
  useEffect(() => {
    if (typeof window === "undefined" || !("PerformanceObserver" in window)) return

    try {
      // Report FCP (First Contentful Paint)
      const paintObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            console.log("[Web Vitals] FCP:", Math.round(entry.startTime))
          }
        }
      })
      paintObserver.observe({ type: "paint", buffered: true })

      // Report LCP (Largest Contentful Paint)
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries()
        const lastEntry = entries[entries.length - 1]
        if (lastEntry) {
          console.log("[Web Vitals] LCP:", Math.round(lastEntry.startTime))
        }
      })
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true })

      // Report CLS (Cumulative Layout Shift)
      let clsValue = 0
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (!(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
            clsValue += (entry as PerformanceEntry & { value?: number }).value || 0
          }
        }
        console.log("[Web Vitals] CLS:", Number(clsValue.toFixed(4)))
      })
      clsObserver.observe({ type: "layout-shift", buffered: true })

      // Report FID / INP
      const fidObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          console.log("[Web Vitals] INP:", Math.round(entry.duration))
        }
      })
      fidObserver.observe({ type: "first-input", buffered: true })

      // Report TTFB (Time to First Byte)
      const navEntries = performance.getEntriesByType("navigation")
      if (navEntries.length > 0) {
        const nav = navEntries[0] as PerformanceNavigationTiming
        if (nav.responseStart) {
          console.log("[Web Vitals] TTFB:", Math.round(nav.responseStart))
        }
      }
    } catch (_err) {
      // Silently handle environments where specific observers are unsupported
    }
  }, [])

  return null
}
