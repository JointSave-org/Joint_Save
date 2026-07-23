/**
 * Client-side transaction signing queue.
 *
 * Freighter (and other wallet extensions) can only show one signing popup
 * at a time. If two `kit.signTransaction(...)` calls fire close together —
 * e.g. a user double-clicks "Deposit" then immediately clicks "Trigger
 * Payout" on another pool card — the second call can silently fail, get
 * stuck pending, or produce a confusing double-prompt experience.
 *
 * This module serializes every `signTransaction` call in the app through a
 * single FIFO queue, so only one wallet popup is ever in flight. Callers
 * await `enqueueSign(...)` exactly as they would await `kit.signTransaction(...)`
 * directly — the queueing is transparent to the caller.
 */

import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit"
import { toastManager } from "@/lib/toast"
import { SIGN_TIMEOUT_MS } from "@/lib/constants"

// ── Types ────────────────────────────────────────────────────────────────

export interface EnqueueSignOptions {
  networkPassphrase: string
  /** Optional Freighter "address" override, forwarded as-is to signTransaction. */
  address?: string
}

export interface SignResult {
  signedTxXdr: string
}

interface QueueEntry {
  xdr: string
  opts: EnqueueSignOptions
  resolve: (result: SignResult) => void
  reject: (error: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
  /** True once settled (resolved, rejected, or timed out) — guards against
   * double-settling if a timeout race fires after the popup already
   * resolved (or vice versa). */
  settled: boolean
}

// ── Configuration ───────────────────────────────────────────────────────

/** If a queued signing request sits unconfirmed this long, we assume the
 * user closed the wallet popup without responding, and free the queue for
 * the next request rather than blocking it forever. */
// SIGN_TIMEOUT_MS is imported from @/lib/constants (2 minutes)

// ── Queue state ──────────────────────────────────────────────────────────

let kitRef: StellarWalletsKit | null = null
const queue: QueueEntry[] = []
let isProcessing = false

/** Subscribers notified whenever the queue length changes, so UI components
 * (e.g. a toast/badge) can reflect "N transactions waiting for your approval"
 * without polling. */
type QueueListener = (length: number) => void
const listeners = new Set<QueueListener>()

function notifyListeners() {
  for (const listener of listeners) {
    listener(queue.length)
  }
}

/** Subscribe to queue-length changes. Returns an unsubscribe function. */
export function subscribeToQueueLength(listener: QueueListener): () => void {
  listeners.add(listener)
  // Immediately report current length so a freshly-mounted UI doesn't have
  // to wait for the next change to render the correct count.
  listener(queue.length)
  return () => {
    listeners.delete(listener)
  }
}

export function getQueueLength(): number {
  return queue.length
}

/**
 * Registers the active StellarWalletsKit instance. Must be called once the
 * kit is available (e.g. from Web3Provider) before enqueueSign can be used.
 * Safe to call repeatedly — e.g. if the kit instance is recreated.
 */
export function setSigningKit(kit: StellarWalletsKit | null) {
  kitRef = kit
}

// ── Core queue processing ───────────────────────────────────────────────

function settleEntry(
  entry: QueueEntry,
  outcome: { ok: true; result: SignResult } | { ok: false; error: unknown }
) {
  if (entry.settled) return
  entry.settled = true
  clearTimeout(entry.timeoutId)
  if (outcome.ok) {
    entry.resolve(outcome.result)
  } else {
    entry.reject(outcome.error)
  }
}

async function processQueue() {
  if (isProcessing) return
  isProcessing = true

  try {
    while (queue.length > 0) {
      const entry = queue[0]

      if (queue.length > 1) {
        toastManager.info(`${queue.length} transactions waiting for your approval`)
      }

      if (!kitRef) {
        settleEntry(entry, {
          ok: false,
          error: new Error("Wallet kit not initialized"),
        })
        queue.shift()
        continue
      }

      try {
        const result = await kitRef.signTransaction(entry.xdr, {
          networkPassphrase: entry.opts.networkPassphrase,
          ...(entry.opts.address ? { address: entry.opts.address } : {}),
        })
        settleEntry(entry, {
          ok: true,
          result: { signedTxXdr: result.signedTxXdr },
        })
      } catch (error) {
        settleEntry(entry, { ok: false, error })
      }

      // The entry may have already been removed by its own timeout firing
      // concurrently with the await above; only shift if it's still at the
      // front (guards against double-shift in that race).
      if (queue[0] === entry) {
        queue.shift()
      }
      notifyListeners()
    }
  } finally {
    isProcessing = false
  }
}

/**
 * Enqueues a transaction XDR for signing. Resolves with the signed XDR once
 * the wallet popup completes, in FIFO order relative to other pending
 * signing requests across the entire app.
 *
 * If the request is not confirmed (approved or rejected) within
 * SIGN_TIMEOUT_MS, it is rejected and removed from the queue — the wallet
 * popup itself is not force-closed (that's not possible from the page), but
 * the queue stops waiting on it so subsequent requests aren't blocked
 * indefinitely by an abandoned popup.
 */
export function enqueueSign(xdr: string, opts: EnqueueSignOptions): Promise<SignResult> {
  return new Promise<SignResult>((resolve, reject) => {
    const entry: QueueEntry = {
      xdr,
      opts,
      resolve,
      reject,
      settled: false,
      // Placeholder; replaced immediately below once `entry` exists, since
      // the timeout callback needs to reference `entry` itself.
      timeoutId: setTimeout(() => {}, 0),
    }
    clearTimeout(entry.timeoutId)

    entry.timeoutId = setTimeout(() => {
      if (entry.settled) return
      settleEntry(entry, {
        ok: false,
        error: new Error(
          "Signing request timed out after 2 minutes. The wallet popup may have been closed without a response."
        ),
      })
      toastManager.warning("A signing request timed out and was cancelled. Please try again.")
      const idx = queue.indexOf(entry)
      if (idx !== -1) {
        queue.splice(idx, 1)
        notifyListeners()
      }
    }, SIGN_TIMEOUT_MS)

    queue.push(entry)
    notifyListeners()
    void processQueue()
  })
}

/** Test-only escape hatch to reset module state between test cases. */
export function __resetQueueForTests() {
  for (const entry of queue) {
    settleEntry(entry, { ok: false, error: new Error("Queue reset") })
  }
  queue.length = 0
  isProcessing = false
  listeners.clear()
  kitRef = null
}
