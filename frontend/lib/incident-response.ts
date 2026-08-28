/**
 * Circuit breaker for critical security alerts.
 *
 * The monitoring rules in `lib/security-rules.ts` detect trouble and persist
 * alerts, but detection on its own never stops anything. This module decides
 * what to do about it: when a pool accumulates enough critical alerts, the
 * breaker trips and the pool is paused so no further money moves while a human
 * looks at it.
 *
 * Everything here is pure. It takes alerts, pool state and a count of recent
 * auto-pauses, and returns a decision. No database, no clock of its own, no
 * network. That is deliberate: an automated action that halts a live savings
 * pool is exactly the kind of logic that has to be exercised in tests without
 * standing up Supabase, and exactly the kind that must behave identically in
 * dry-run and for real.
 *
 * Two boundaries are load-bearing and are enforced by the type system rather
 * than by convention:
 *
 *  - **The only automatic action is a pause.** `IncidentAction` has no variant
 *    for withdrawing funds. `emergency_withdraw` stays admin-only and manual, as
 *    the issue requires, and no decision this module can return could reach it.
 *  - **A decision is always reported, even in dry-run.** `wouldFire` says what
 *    the breaker would have done; `executed` says what it was allowed to do.
 *    A dry-run period therefore produces real data about how the thresholds
 *    behave before anyone lets them act.
 */

import type { AlertSeverity, RuleId, SecurityAlert } from "@/lib/security-rules"

// ── Configuration ────────────────────────────────────────────────────────────

export interface IncidentConfig {
  /** Critical alerts against one pool needed to trip the breaker. */
  criticalThreshold: number
  /** How far back critical alerts are counted towards the threshold. */
  thresholdWindowMs: number
  /** Window over which auto-pauses are counted for the cooldown. */
  cooldownWindowMs: number
  /** Auto-pauses allowed per pool inside the cooldown window. */
  maxPausesPerWindow: number
  /** When true, decisions are recorded and reported but never acted on. */
  dryRun: boolean
}

export const DEFAULT_INCIDENT_CONFIG: IncidentConfig = {
  criticalThreshold: 2,
  thresholdWindowMs: 60 * 60 * 1000,
  cooldownWindowMs: 24 * 60 * 60 * 1000,
  maxPausesPerWindow: 1,
  // Off by default. Pausing a live pool is opt-in, per deployment, and the
  // README explains how to turn it on once a dry-run period looks sane.
  dryRun: true,
}

/** Upper bounds, so a fat-fingered env var cannot disable the safety rails. */
const LIMITS = {
  criticalThreshold: { min: 1, max: 100 },
  thresholdWindowMs: { min: 60_000, max: 7 * 24 * 60 * 60 * 1000 },
  cooldownWindowMs: { min: 60_000, max: 30 * 24 * 60 * 60 * 1000 },
  maxPausesPerWindow: { min: 1, max: 50 },
} as const

function readInt(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number }
): number {
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return fallback
  }
  return parsed
}

/**
 * Reads the breaker's configuration from the environment.
 *
 * Anything missing, unparseable or out of range falls back to the default
 * rather than throwing: a malformed variable must not take the security scan
 * down with it, and the safe default is "do less", never "do more".
 *
 * Dry-run is the only flag that has to be turned off explicitly. It is disabled
 * solely by the exact string "false", so a typo leaves the breaker in log-only
 * mode instead of silently arming it.
 */
export function loadIncidentConfig(
  env: Record<string, string | undefined> = process.env
): IncidentConfig {
  return {
    criticalThreshold: readInt(
      env.INCIDENT_CRITICAL_THRESHOLD,
      DEFAULT_INCIDENT_CONFIG.criticalThreshold,
      LIMITS.criticalThreshold
    ),
    thresholdWindowMs: readInt(
      env.INCIDENT_THRESHOLD_WINDOW_MS,
      DEFAULT_INCIDENT_CONFIG.thresholdWindowMs,
      LIMITS.thresholdWindowMs
    ),
    cooldownWindowMs: readInt(
      env.INCIDENT_COOLDOWN_WINDOW_MS,
      DEFAULT_INCIDENT_CONFIG.cooldownWindowMs,
      LIMITS.cooldownWindowMs
    ),
    maxPausesPerWindow: readInt(
      env.INCIDENT_MAX_PAUSES_PER_WINDOW,
      DEFAULT_INCIDENT_CONFIG.maxPausesPerWindow,
      LIMITS.maxPausesPerWindow
    ),
    dryRun: env.INCIDENT_AUTO_PAUSE_ENABLED !== "true",
  }
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The critical alerts raised against a single pool by one scan. */
export interface PoolAlertGroup {
  poolId: string
  ruleIds: RuleId[]
  descriptions: string[]
  alertCount: number
  highestSeverity: AlertSeverity
}

/** What the breaker needs to know about the pool it is about to act on. */
export interface PoolState {
  id: string
  name: string | null
  status: "active" | "completed" | "paused"
}

// ── Decisions ────────────────────────────────────────────────────────────────

/**
 * The complete set of actions the breaker may take on its own.
 *
 * Adding anything that moves funds here would be a mistake, and a test asserts
 * this union stays exactly as it is.
 */
export type IncidentAction = "pause" | "none"

export type SkipReason =
  "below_threshold" | "already_paused" | "pool_not_active" | "cooldown" | "unknown_pool"

export interface IncidentDecision {
  poolId: string
  /** What the breaker concluded, independent of whether it is allowed to act. */
  action: IncidentAction
  /** True when the thresholds were met, reported even in dry-run. */
  wouldFire: boolean
  /** True only when the action is actually carried out (armed and not skipped). */
  executed: boolean
  /** Present when `action` is "none": why the breaker held off. */
  skipReason: SkipReason | null
  /** Human-readable, persisted on the incident and on the pool. */
  reason: string
  ruleIds: RuleId[]
  alertCount: number
  severity: AlertSeverity
  /** Auto-pauses already recorded for this pool inside the cooldown window. */
  recentPauses: number
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Groups a scan's critical alerts by the pool they affect.
 *
 * An alert can name several pools, and each named pool carries the alert's full
 * weight: an incident that touches three pools is critical for all three, not a
 * third as bad for each. Alerts below critical never reach the breaker.
 */
export function groupCriticalAlertsByPool(alerts: readonly SecurityAlert[]): PoolAlertGroup[] {
  const byPool = new Map<string, PoolAlertGroup>()

  for (const alert of alerts) {
    if (alert.severity !== "critical") continue

    for (const poolId of alert.affected_pools) {
      if (!poolId) continue
      const existing = byPool.get(poolId)
      if (existing) {
        existing.alertCount += 1
        if (!existing.ruleIds.includes(alert.rule_id)) {
          existing.ruleIds.push(alert.rule_id)
        }
        existing.descriptions.push(alert.description)
      } else {
        byPool.set(poolId, {
          poolId,
          ruleIds: [alert.rule_id],
          descriptions: [alert.description],
          alertCount: 1,
          highestSeverity: "critical",
        })
      }
    }
  }

  // Sorted by pool id so a scan's decisions are reported in a stable order.
  return [...byPool.values()].sort((a, b) => (a.poolId < b.poolId ? -1 : 1))
}

// ── The decision ─────────────────────────────────────────────────────────────

function buildReason(group: PoolAlertGroup, config: IncidentConfig): string {
  const rules = group.ruleIds.join(", ")
  const windowMinutes = Math.round(config.thresholdWindowMs / 60_000)
  return (
    `Auto-paused: ${group.alertCount} critical alert(s) ` +
    `(${rules}) within ${windowMinutes} min, threshold ${config.criticalThreshold}.`
  )
}

/**
 * Decides whether one pool's critical alerts should trip the breaker.
 *
 * The checks run in a deliberate order, because the answer to "why did nothing
 * happen?" has to be a single, honest reason:
 *
 *  1. Below the threshold: not enough critical alerts to act on.
 *  2. Unknown pool: an alert naming a pool that is not in the database.
 *  3. Already paused, or not active: nothing left to stop.
 *  4. Cooldown: the pool has been auto-paused too recently. This is the gate
 *     that prevents pause-flap, and it is checked *before* the action is
 *     produced, so a pool in cooldown is never paused and then reverted.
 *
 * Dry-run is applied last and only to `executed`. The decision itself, and
 * `wouldFire` with it, is identical either way.
 */
export function decideAutoPause(
  group: PoolAlertGroup,
  pool: PoolState | null,
  recentPauses: number,
  config: IncidentConfig
): IncidentDecision {
  const base = {
    poolId: group.poolId,
    ruleIds: group.ruleIds,
    alertCount: group.alertCount,
    severity: group.highestSeverity,
    recentPauses,
  }

  const skip = (skipReason: SkipReason, reason: string): IncidentDecision => ({
    ...base,
    action: "none",
    // A pool skipped for cooldown or because it is already paused DID meet the
    // thresholds; saying otherwise would hide real signal during a dry run.
    wouldFire: skipReason !== "below_threshold",
    executed: false,
    skipReason,
    reason,
  })

  if (group.alertCount < config.criticalThreshold) {
    return skip(
      "below_threshold",
      `No action: ${group.alertCount} critical alert(s), threshold is ${config.criticalThreshold}.`
    )
  }

  if (!pool) {
    return skip("unknown_pool", `No action: pool ${group.poolId} was not found in the database.`)
  }

  if (pool.status === "paused") {
    return skip("already_paused", "No action: the pool is already paused.")
  }

  if (pool.status !== "active") {
    return skip("pool_not_active", `No action: the pool is ${pool.status}.`)
  }

  if (recentPauses >= config.maxPausesPerWindow) {
    const windowHours = Math.round(config.cooldownWindowMs / 3_600_000)
    return skip(
      "cooldown",
      `No action: ${recentPauses} auto-pause(s) already in the last ${windowHours}h ` +
        `(max ${config.maxPausesPerWindow}). Needs admin review.`
    )
  }

  return {
    ...base,
    action: "pause",
    wouldFire: true,
    // The one place dry-run changes anything.
    executed: !config.dryRun,
    skipReason: null,
    reason: buildReason(group, config),
  }
}

/** Runs the breaker over a whole scan. */
export function decideIncidentResponse(
  groups: readonly PoolAlertGroup[],
  pools: ReadonlyMap<string, PoolState>,
  recentPausesByPool: ReadonlyMap<string, number>,
  config: IncidentConfig
): IncidentDecision[] {
  return groups.map((group) =>
    decideAutoPause(
      group,
      pools.get(group.poolId) ?? null,
      recentPausesByPool.get(group.poolId) ?? 0,
      config
    )
  )
}

// ── Reporting ────────────────────────────────────────────────────────────────

export interface IncidentSummary {
  /** True while the breaker is armed but only logging. */
  dryRun: boolean
  /** Pools whose alerts met the thresholds, whether or not action was taken. */
  wouldFire: number
  /** Pools actually paused by this scan. */
  paused: number
  /** Pools held back by the cooldown. */
  cooldownBlocked: number
  decisions: IncidentDecision[]
}

/**
 * The shape the scan endpoints report. It always answers "would this have
 * fired", which is what makes a dry-run period useful rather than decorative.
 */
export function summarizeDecisions(
  decisions: readonly IncidentDecision[],
  config: IncidentConfig
): IncidentSummary {
  return {
    dryRun: config.dryRun,
    wouldFire: decisions.filter((d) => d.wouldFire).length,
    paused: decisions.filter((d) => d.executed).length,
    cooldownBlocked: decisions.filter((d) => d.skipReason === "cooldown").length,
    decisions: [...decisions],
  }
}

// ── On-chain authorization ───────────────────────────────────────────────────

/**
 * An admin-signed authorization for `pause` on one pool, as stored.
 *
 * The contract asserts `admin.require_auth()`, and a
 * `SorobanAuthorizationEntry` is signed independently of the transaction
 * envelope, so the admin can sign one ahead of time and the platform can submit
 * it later without ever holding the admin's key. The entry commits to the exact
 * invocation, so it can authorise nothing except the pause the admin agreed to.
 */
export interface StoredPauseAuthorization {
  id: string
  contractAddress: string
  adminAddress: string
  /** Ledger the signature stops being valid at. */
  expirationLedger: number
  usedAt: string | null
  revokedAt: string | null
}

export type AuthorizationRejection =
  "used" | "revoked" | "expired" | "expiring_too_soon" | "wrong_contract" | "wrong_admin"

export interface AuthorizationChoice {
  authorization: StoredPauseAuthorization | null
  /** Every candidate that was passed over, and why. */
  rejected: Array<{ id: string; reason: AuthorizationRejection }>
}

/**
 * Ledgers of headroom required before an entry is considered usable.
 *
 * Building, simulating and submitting takes a few seconds, and ledgers close
 * about every six. An entry expiring inside this window would very likely be
 * rejected by the time it lands, wasting its nonce for nothing.
 */
export const AUTH_LEDGER_SAFETY_MARGIN = 20

/**
 * Picks the authorization to spend on this pause, if any.
 *
 * Candidates are rejected for stated reasons rather than silently filtered, so
 * an admin whose pool did not auto-pause can be told why: their authorization
 * expired, or was already spent, or was signed for an admin address that has
 * since changed.
 *
 * Among usable entries it takes the one expiring soonest. They are perishable
 * and single-use, so spending the most perishable first wastes the least.
 */
export function selectPauseAuthorization(
  candidates: readonly StoredPauseAuthorization[],
  currentLedger: number,
  expected: { contractAddress: string; adminAddress: string },
  safetyMargin: number = AUTH_LEDGER_SAFETY_MARGIN
): AuthorizationChoice {
  const rejected: AuthorizationChoice["rejected"] = []
  const usable: StoredPauseAuthorization[] = []

  for (const candidate of candidates) {
    const reason = rejectionFor(candidate, currentLedger, expected, safetyMargin)
    if (reason) rejected.push({ id: candidate.id, reason })
    else usable.push(candidate)
  }

  usable.sort(
    (a, b) => a.expirationLedger - b.expirationLedger || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )

  return { authorization: usable[0] ?? null, rejected }
}

function rejectionFor(
  candidate: StoredPauseAuthorization,
  currentLedger: number,
  expected: { contractAddress: string; adminAddress: string },
  safetyMargin: number
): AuthorizationRejection | null {
  if (candidate.usedAt !== null) return "used"
  if (candidate.revokedAt !== null) return "revoked"
  // Checked before expiry so a mismatch is never reported as a stale entry:
  // an authorization for another pool is a different problem entirely.
  if (candidate.contractAddress !== expected.contractAddress) return "wrong_contract"
  if (candidate.adminAddress.toLowerCase() !== expected.adminAddress.toLowerCase()) {
    return "wrong_admin"
  }
  if (candidate.expirationLedger <= currentLedger) return "expired"
  if (candidate.expirationLedger - currentLedger < safetyMargin) return "expiring_too_soon"
  return null
}
