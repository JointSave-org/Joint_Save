/**
 * Carries out the circuit breaker's decisions.
 *
 * `lib/incident-response.ts` decides; this file acts. Splitting them keeps the
 * decision logic pure and unit-testable, and keeps every write that can halt a
 * live pool in one place where the ordering is explicit.
 *
 * Server-side only: it uses the service-role Supabase client. Never import from
 * a client component.
 *
 * ## What "auto-pause" actually does, and what it cannot do
 *
 * The pause has two halves, and only one of them can be automatic:
 *
 *  - **Platform pause (automatic).** The pool's `status` flips to `paused` with
 *    a reason. The app reads that status, so deposits and payouts stop being
 *    offered immediately. It is reversible from the admin endpoint.
 *  - **On-chain pause (never automatic).** `rotational::pause` asserts
 *    `admin.require_auth()` and that the caller equals the pool's stored admin,
 *    which is the creator's own wallet. The platform holds no key that satisfies
 *    that (`SPONSOR_SECRET_KEY` only pays fees; a fee bump authorises nothing).
 *    So the incident is marked `onchain_status = 'pending'` and the admin signs
 *    the real contract call from the review screen.
 *
 * Automating the on-chain half would mean adding a platform guardian role to a
 * deployed, funds-holding contract. That is a security decision for the
 * maintainers, not something to slip into this layer; see
 * `docs/INCIDENT_RESPONSE.md`.
 *
 * `emergency_withdraw` is not touched here, by anything, ever.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/supabase"
import type { SecurityAlert } from "@/lib/security-rules"
import {
  decideIncidentResponse,
  groupCriticalAlertsByPool,
  loadIncidentConfig,
  summarizeDecisions,
  type IncidentConfig,
  type IncidentDecision,
  type IncidentSummary,
  type PoolState,
} from "@/lib/incident-response"

type AdminClient = SupabaseClient<Database>

export type ScanSource = "cron" | "admin"

/** The activity type written to `pool_activity` so auto-actions show up in the audit log. */
export const AUTO_PAUSE_ACTIVITY_TYPE = "security_auto_pause"

export interface IncidentResponseResult extends IncidentSummary {
  /** Incident rows written by this run. */
  incidentIds: string[]
}

const EMPTY_RESULT = (config: IncidentConfig): IncidentResponseResult => ({
  ...summarizeDecisions([], config),
  incidentIds: [],
})

// ── Reads ────────────────────────────────────────────────────────────────────

async function loadPoolStates(
  admin: AdminClient,
  poolIds: string[]
): Promise<Map<string, PoolState>> {
  const { data, error } = await admin.from("pools").select("id, name, status").in("id", poolIds)

  if (error) throw error

  return new Map(
    (data ?? []).map((p) => [
      p.id,
      { id: p.id, name: p.name, status: p.status as PoolState["status"] },
    ])
  )
}

/**
 * How many times each pool has already been auto-paused inside the cooldown
 * window. Only executed pauses count: a dry-run decision must not consume a
 * pool's allowance, or arming the breaker later would find it already spent.
 */
async function countRecentAutoPauses(
  admin: AdminClient,
  poolIds: string[],
  since: Date
): Promise<Map<string, number>> {
  const { data, error } = await admin
    .from("incidents")
    .select("pool_id")
    .in("pool_id", poolIds)
    .eq("action", "pause")
    .eq("executed", true)
    .gte("created_at", since.toISOString())

  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    counts.set(row.pool_id, (counts.get(row.pool_id) ?? 0) + 1)
  }
  return counts
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Writes the incident before anything is paused.
 *
 * The row starts as "decided but not carried out". If the process dies between
 * here and the pause, what is left behind is an incident saying no action was
 * taken, which is true and recoverable. The opposite ordering would leave a
 * paused pool with no record of why.
 */
async function recordIncident(
  admin: AdminClient,
  decision: IncidentDecision,
  source: ScanSource,
  config: IncidentConfig
): Promise<string | null> {
  const { data, error } = await admin
    .from("incidents")
    .insert({
      pool_id: decision.poolId,
      trigger_rule_ids: decision.ruleIds,
      severity: decision.severity,
      alert_count: decision.alertCount,
      reason: decision.reason,
      created_by_scan: true,
      scan_source: source,
      action: decision.action,
      executed: false,
      dry_run: config.dryRun,
      skip_reason: decision.skipReason,
      platform_paused: false,
      onchain_status: "not_required",
      status: "open",
    })
    .select("id")
    .single()

  if (error) {
    console.error("Failed to record incident:", error)
    return null
  }
  return data?.id ?? null
}

/** Flips the pool to paused, but only if it is still active. */
async function pausePool(admin: AdminClient, poolId: string, reason: string): Promise<boolean> {
  const { data, error } = await admin
    .from("pools")
    .update({
      status: "paused",
      pause_reason: reason,
      paused_at: new Date().toISOString(),
    })
    .eq("id", poolId)
    // Guards against a race with an admin pausing or completing the pool
    // between the decision and this write.
    .eq("status", "active")
    .select("id")

  if (error) {
    console.error("Failed to pause pool:", error)
    return false
  }
  return (data ?? []).length > 0
}

/**
 * Promotes the incident from "decided" to "carried out", once the pool is
 * actually paused. `executed` is what the cooldown counts, so it must reflect
 * pauses that really happened and nothing else.
 *
 * `onchain_status` becomes 'pending': the platform half is done, the contract
 * half is waiting for the admin's signature.
 */
async function markIncidentExecuted(admin: AdminClient, incidentId: string): Promise<void> {
  const { error } = await admin
    .from("incidents")
    .update({
      executed: true,
      platform_paused: true,
      onchain_status: "pending",
      // Maintained by hand, matching the rest of the schema, which has no
      // updated_at triggers.
      updated_at: new Date().toISOString(),
    })
    .eq("id", incidentId)

  if (error) console.error("Failed to mark incident executed:", error)
}

/** Records the action where the existing admin audit log will show it. */
async function writeAuditTrail(
  admin: AdminClient,
  decision: IncidentDecision,
  incidentId: string | null
): Promise<void> {
  const { error } = await admin.from("pool_activity").insert({
    pool_id: decision.poolId,
    activity_type: AUTO_PAUSE_ACTIVITY_TYPE,
    description: incidentId ? `${decision.reason} (incident ${incidentId})` : decision.reason,
  })

  if (error) console.error("Failed to write audit trail:", error)
}

/**
 * Tells the people who can do something about it.
 *
 * The pool creator is the admin: they hold the key the on-chain pause needs, so
 * the notification is both an alert and a call to action.
 */
async function notifyPoolAdmin(
  admin: AdminClient,
  poolId: string,
  decision: IncidentDecision,
  config: IncidentConfig
): Promise<void> {
  const { data: pool, error } = await admin
    .from("pools")
    .select("creator_address, name")
    .eq("id", poolId)
    .single()

  if (error || !pool) return

  const prefix = config.dryRun ? "[SECURITY DRY-RUN]" : "[SECURITY]"
  const action = config.dryRun ? "would have been paused automatically" : "was paused automatically"

  const { error: notifyError } = await admin.from("notifications").insert({
    wallet_address: pool.creator_address,
    pool_id: poolId,
    activity_type: "security_auto_pause",
    message: `${prefix} "${pool.name}" ${action}. ${decision.reason} Review it in the admin panel.`,
    read: false,
  })

  if (notifyError) console.error("Failed to notify pool admin:", notifyError)
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Runs the breaker over a scan's alerts and carries out what it decides.
 *
 * An incident row is written for every decision that met the thresholds,
 * including the ones held back by cooldown or by dry-run, because those are the
 * events worth auditing. Decisions below the threshold are not recorded: every
 * scan would otherwise write a row for every pool with a single alert, and the
 * table would stop being a list of incidents.
 *
 * Failures are contained per pool. One pool's failed write must not stop the
 * breaker from protecting the next one.
 */
export async function runIncidentResponse(
  admin: AdminClient,
  alerts: readonly SecurityAlert[],
  source: ScanSource,
  config: IncidentConfig = loadIncidentConfig()
): Promise<IncidentResponseResult> {
  const groups = groupCriticalAlertsByPool(alerts)
  if (groups.length === 0) return EMPTY_RESULT(config)

  const poolIds = groups.map((g) => g.poolId)
  const since = new Date(Date.now() - config.cooldownWindowMs)

  const [pools, recentPauses] = await Promise.all([
    loadPoolStates(admin, poolIds),
    countRecentAutoPauses(admin, poolIds, since),
  ])

  const decisions = decideIncidentResponse(groups, pools, recentPauses, config)
  const incidentIds: string[] = []

  for (const decision of decisions) {
    if (!decision.wouldFire) continue

    const incidentId = await recordIncident(admin, decision, source, config)
    if (incidentId) incidentIds.push(incidentId)

    if (!decision.executed) {
      // Dry-run, cooldown or an inactive pool: the record and the notification
      // are the whole point, so admins see what the breaker wanted to do.
      await notifyPoolAdmin(admin, decision.poolId, decision, config)
      continue
    }

    const paused = await pausePool(admin, decision.poolId, decision.reason)
    if (!paused) {
      // Lost the race, or the write failed. The incident stays on record as
      // not executed, which is exactly what happened.
      continue
    }

    if (incidentId) await markIncidentExecuted(admin, incidentId)
    await writeAuditTrail(admin, decision, incidentId)
    await notifyPoolAdmin(admin, decision.poolId, decision, config)
  }

  return { ...summarizeDecisions(decisions, config), incidentIds }
}
