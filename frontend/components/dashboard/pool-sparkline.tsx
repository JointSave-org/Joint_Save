"use client"

import { useEffect, useState } from "react"
import { requestPoolHistory, subscribePoolHistory } from "@/lib/data-layer/PoolHistoryCache"

export function PoolSparkline({ poolId }: { poolId: string }) {
  const [, forceRerender] = useState(0)

  useEffect(() => subscribePoolHistory(() => forceRerender((n) => n + 1)), [])

  const history = requestPoolHistory(poolId)

  // Degrade gracefully: no data yet, or not enough points to be meaningful.
  if (!history || history.length < 2) return null

  const min = Math.min(...history)
  const max = Math.max(...history)
  const range = max - min || 1
  const width = 80
  const height = 24
  const step = width / (history.length - 1)

  const points = history
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(" ")

  const trendingUp = history[history.length - 1] >= history[0]

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={trendingUp ? "#22c55e" : "#ef4444"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}