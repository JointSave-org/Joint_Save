"use client"

// Collects pool IDs requested during the same render tick and fires a
// single batched /api/pools/history call, so a grid of N cards makes
// 1 request instead of N. Simple module-level cache, mirrors the
// registerInterest pattern in PoolDataProvider.

type Listener = () => void

const cache = new Map<string, number[]>()
const pending = new Set<string>()
const listeners = new Set<Listener>()
let flushScheduled = false

function notify() {
  listeners.forEach((l) => l())
}

async function flush() {
  flushScheduled = false
  const ids = Array.from(pending)
  pending.clear()
  if (ids.length === 0) return

  try {
    const res = await fetch(`/api/pools/history?poolIds=${ids.join(",")}`)
    if (!res.ok) return
    const { history } = await res.json()
    for (const id of ids) {
      cache.set(id, history[id] || [])
    }
    notify()
  } catch {
    // Silent fail — sparkline just won't render for these pools.
  }
}

export function requestPoolHistory(poolId: string): number[] | undefined {
  if (cache.has(poolId)) return cache.get(poolId)
  pending.add(poolId)
  if (!flushScheduled) {
    flushScheduled = true
    queueMicrotask(flush)
  }
  return undefined
}

export function subscribePoolHistory(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
