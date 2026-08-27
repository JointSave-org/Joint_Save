// Unit tests for the critical-alert circuit breaker.
//
// The behaviour under test decides whether a live savings pool gets paused
// automatically, so the cases that matter most are the ones where it must NOT
// act: below threshold, during cooldown, and while in dry-run.
import { test } from "node:test"
import assert from "node:assert"
import {
  DEFAULT_INCIDENT_CONFIG,
  decideAutoPause,
  decideIncidentResponse,
  groupCriticalAlertsByPool,
  loadIncidentConfig,
  summarizeDecisions,
  type IncidentAction,
  type IncidentConfig,
  type PoolAlertGroup,
  type PoolState,
} from "./incident-response"
import type { RuleId, SecurityAlert } from "./security-rules"

// ── Fixtures ────────────────────────────────────────────────────────────────

function alert(overrides: Partial<SecurityAlert> = {}): SecurityAlert {
  return {
    id: "a1",
    rule_id: "rapid_emergency_withdraw" as RuleId,
    severity: "critical",
    description: "3 emergency withdrawals in 1 hour",
    affected_pools: ["pool-1"],
    affected_wallets: ["GWALLET"],
    status: "new",
    resolved_by: null,
    resolution_notes: null,
    created_at: "2026-08-27T00:00:00.000Z",
    resolved_at: null,
    ...overrides,
  }
}

function group(overrides: Partial<PoolAlertGroup> = {}): PoolAlertGroup {
  return {
    poolId: "pool-1",
    ruleIds: ["rapid_emergency_withdraw"],
    descriptions: ["3 emergency withdrawals in 1 hour"],
    alertCount: 2,
    highestSeverity: "critical",
    ...overrides,
  }
}

function pool(overrides: Partial<PoolState> = {}): PoolState {
  return { id: "pool-1", name: "Ahorro familiar", status: "active", ...overrides }
}

/** Armed config: same thresholds as the default, but allowed to act. */
const ARMED: IncidentConfig = { ...DEFAULT_INCIDENT_CONFIG, dryRun: false }

// ── Grouping ────────────────────────────────────────────────────────────────

test("grouping: ignores anything below critical", () => {
  const groups = groupCriticalAlertsByPool([
    alert({ severity: "warning" }),
    alert({ severity: "info" }),
  ])
  assert.deepStrictEqual(groups, [])
})

test("grouping: counts every critical alert against the pool", () => {
  const groups = groupCriticalAlertsByPool([alert(), alert(), alert()])
  assert.strictEqual(groups.length, 1)
  assert.strictEqual(groups[0].alertCount, 3)
})

test("grouping: an alert naming several pools counts fully for each", () => {
  const groups = groupCriticalAlertsByPool([alert({ affected_pools: ["pool-1", "pool-2"] })])
  assert.strictEqual(groups.length, 2)
  assert.strictEqual(groups[0].alertCount, 1)
  assert.strictEqual(groups[1].alertCount, 1)
})

test("grouping: collects distinct rules without repeating them", () => {
  const groups = groupCriticalAlertsByPool([
    alert({ rule_id: "rapid_emergency_withdraw" }),
    alert({ rule_id: "mass_member_removal" }),
    alert({ rule_id: "rapid_emergency_withdraw" }),
  ])
  assert.deepStrictEqual(groups[0].ruleIds, ["rapid_emergency_withdraw", "mass_member_removal"])
  assert.strictEqual(groups[0].alertCount, 3)
})

test("grouping: is ordered by pool id, so decisions are reported stably", () => {
  const groups = groupCriticalAlertsByPool([
    alert({ affected_pools: ["pool-c"] }),
    alert({ affected_pools: ["pool-a"] }),
    alert({ affected_pools: ["pool-b"] }),
  ])
  assert.deepStrictEqual(
    groups.map((g) => g.poolId),
    ["pool-a", "pool-b", "pool-c"]
  )
})

test("grouping: skips empty pool ids instead of grouping under one", () => {
  const groups = groupCriticalAlertsByPool([alert({ affected_pools: ["", "pool-1"] })])
  assert.strictEqual(groups.length, 1)
  assert.strictEqual(groups[0].poolId, "pool-1")
})

// ── Escalation threshold ────────────────────────────────────────────────────

test("threshold: one alert below the threshold does not fire", () => {
  const decision = decideAutoPause(group({ alertCount: 1 }), pool(), 0, ARMED)
  assert.strictEqual(decision.action, "none")
  assert.strictEqual(decision.skipReason, "below_threshold")
  assert.strictEqual(decision.wouldFire, false)
  assert.strictEqual(decision.executed, false)
})

test("threshold: reaching it exactly fires", () => {
  const decision = decideAutoPause(group({ alertCount: 2 }), pool(), 0, ARMED)
  assert.strictEqual(decision.action, "pause")
  assert.strictEqual(decision.wouldFire, true)
  assert.strictEqual(decision.executed, true)
  assert.strictEqual(decision.skipReason, null)
})

test("threshold: the reason names the rules and the count", () => {
  const decision = decideAutoPause(
    group({ alertCount: 3, ruleIds: ["mass_member_removal"] }),
    pool(),
    0,
    ARMED
  )
  assert.match(decision.reason, /3 critical alert/)
  assert.match(decision.reason, /mass_member_removal/)
})

// ── Cooldown, the anti-flap gate ────────────────────────────────────────────

test("cooldown: a pool already auto-paused in the window is not paused again", () => {
  const decision = decideAutoPause(group(), pool(), 1, ARMED)
  assert.strictEqual(decision.action, "none")
  assert.strictEqual(decision.skipReason, "cooldown")
  assert.strictEqual(decision.executed, false)
})

test("cooldown: a blocked pool still reports that it would have fired", () => {
  // Otherwise a dry run would under-report exactly the pools that keep tripping.
  const decision = decideAutoPause(group(), pool(), 5, ARMED)
  assert.strictEqual(decision.wouldFire, true)
  assert.strictEqual(decision.recentPauses, 5)
})

test("cooldown: a higher allowance lets a second pause through", () => {
  const config: IncidentConfig = { ...ARMED, maxPausesPerWindow: 2 }
  assert.strictEqual(decideAutoPause(group(), pool(), 1, config).action, "pause")
  assert.strictEqual(decideAutoPause(group(), pool(), 2, config).skipReason, "cooldown")
})

test("cooldown: the message says how many pauses and over what window", () => {
  const decision = decideAutoPause(group(), pool(), 1, ARMED)
  assert.match(decision.reason, /1 auto-pause/)
  assert.match(decision.reason, /24h/)
})

test("cooldown: is checked before the action, never paused then reverted", () => {
  const decision = decideAutoPause(group({ alertCount: 99 }), pool(), 1, ARMED)
  assert.strictEqual(decision.action, "none")
  assert.strictEqual(decision.executed, false)
})

// ── Pool state ──────────────────────────────────────────────────────────────

test("pool state: an already paused pool is left alone", () => {
  const decision = decideAutoPause(group(), pool({ status: "paused" }), 0, ARMED)
  assert.strictEqual(decision.skipReason, "already_paused")
  assert.strictEqual(decision.executed, false)
})

test("pool state: a completed pool is not paused", () => {
  const decision = decideAutoPause(group(), pool({ status: "completed" }), 0, ARMED)
  assert.strictEqual(decision.skipReason, "pool_not_active")
})

test("pool state: an alert naming an unknown pool is reported, not acted on", () => {
  const decision = decideAutoPause(group(), null, 0, ARMED)
  assert.strictEqual(decision.skipReason, "unknown_pool")
  assert.strictEqual(decision.executed, false)
  assert.strictEqual(decision.wouldFire, true)
})

// ── Dry run ─────────────────────────────────────────────────────────────────

test("dry run: decides to pause but does not execute", () => {
  const decision = decideAutoPause(group(), pool(), 0, DEFAULT_INCIDENT_CONFIG)
  assert.strictEqual(decision.action, "pause")
  assert.strictEqual(decision.wouldFire, true)
  assert.strictEqual(decision.executed, false)
})

test("dry run: changes nothing except execution", () => {
  const dry = decideAutoPause(group(), pool(), 0, DEFAULT_INCIDENT_CONFIG)
  const armed = decideAutoPause(group(), pool(), 0, ARMED)
  assert.deepStrictEqual({ ...dry, executed: null }, { ...armed, executed: null })
})

test("dry run: is the default, so a fresh deployment cannot pause a pool", () => {
  assert.strictEqual(DEFAULT_INCIDENT_CONFIG.dryRun, true)
})

// ── Configuration ───────────────────────────────────────────────────────────

test("config: an empty environment yields the safe defaults", () => {
  assert.deepStrictEqual(loadIncidentConfig({}), DEFAULT_INCIDENT_CONFIG)
})

test("config: auto-pause arms only on the exact string 'true'", () => {
  assert.strictEqual(loadIncidentConfig({ INCIDENT_AUTO_PAUSE_ENABLED: "true" }).dryRun, false)
  for (const value of ["True", "TRUE", "1", "yes", "", " true"]) {
    assert.strictEqual(
      loadIncidentConfig({ INCIDENT_AUTO_PAUSE_ENABLED: value }).dryRun,
      true,
      `"${value}" must not arm the breaker`
    )
  }
})

test("config: reads valid overrides", () => {
  const config = loadIncidentConfig({
    INCIDENT_CRITICAL_THRESHOLD: "5",
    INCIDENT_MAX_PAUSES_PER_WINDOW: "3",
  })
  assert.strictEqual(config.criticalThreshold, 5)
  assert.strictEqual(config.maxPausesPerWindow, 3)
})

test("config: a malformed or out-of-range value falls back instead of throwing", () => {
  for (const bad of ["0", "-1", "abc", "2.5", "1000000"]) {
    assert.strictEqual(
      loadIncidentConfig({ INCIDENT_CRITICAL_THRESHOLD: bad }).criticalThreshold,
      DEFAULT_INCIDENT_CONFIG.criticalThreshold,
      `"${bad}" must fall back to the default`
    )
  }
})

// ── Whole-scan behaviour ────────────────────────────────────────────────────

test("scan: decides per pool, mixing fired, cooled down and skipped", () => {
  const groups = [
    group({ poolId: "pool-1", alertCount: 2 }),
    group({ poolId: "pool-2", alertCount: 2 }),
    group({ poolId: "pool-3", alertCount: 1 }),
  ]
  const pools = new Map<string, PoolState>([
    ["pool-1", pool({ id: "pool-1" })],
    ["pool-2", pool({ id: "pool-2" })],
    ["pool-3", pool({ id: "pool-3" })],
  ])
  const recent = new Map<string, number>([["pool-2", 1]])

  const decisions = decideIncidentResponse(groups, pools, recent, ARMED)
  assert.deepStrictEqual(
    decisions.map((d) => [d.poolId, d.action, d.skipReason]),
    [
      ["pool-1", "pause", null],
      ["pool-2", "none", "cooldown"],
      ["pool-3", "none", "below_threshold"],
    ]
  )
})

test("summary: reports what would have fired, not just what did", () => {
  const groups = [group({ poolId: "pool-1" }), group({ poolId: "pool-2" })]
  const pools = new Map<string, PoolState>([
    ["pool-1", pool({ id: "pool-1" })],
    ["pool-2", pool({ id: "pool-2" })],
  ])
  const recent = new Map<string, number>([["pool-2", 1]])

  const dry = summarizeDecisions(
    decideIncidentResponse(groups, pools, recent, DEFAULT_INCIDENT_CONFIG),
    DEFAULT_INCIDENT_CONFIG
  )
  assert.strictEqual(dry.dryRun, true)
  assert.strictEqual(dry.wouldFire, 2)
  assert.strictEqual(dry.paused, 0)
  assert.strictEqual(dry.cooldownBlocked, 1)

  const armed = summarizeDecisions(decideIncidentResponse(groups, pools, recent, ARMED), ARMED)
  assert.strictEqual(armed.paused, 1)
  assert.strictEqual(armed.wouldFire, 2)
})

// ── The hard boundary ───────────────────────────────────────────────────────

test("boundary: pausing is the only action the breaker can ever return", () => {
  // emergency_withdraw moves member funds and stays admin-only and manual. It
  // is not reachable from here, and this asserts the action set has not grown:
  // adding a funds-moving variant would fail this test before review.
  const allowed: IncidentAction[] = ["pause", "none"]

  const states: (PoolState | null)[] = [
    pool(),
    pool({ status: "paused" }),
    pool({ status: "completed" }),
    null,
  ]
  const actions = new Set<string>()
  for (const state of states) {
    for (const count of [0, 1, 2, 99]) {
      for (const config of [ARMED, DEFAULT_INCIDENT_CONFIG]) {
        actions.add(decideAutoPause(group({ alertCount: count }), state, count, config).action)
      }
    }
  }

  for (const action of actions) {
    assert.ok(allowed.includes(action as IncidentAction), `unexpected automatic action: ${action}`)
  }
})
