import { test as base, expect } from "@playwright/test"

/**
 * Extended Playwright `test` that collects browser-side errors for every test.
 *
 * `consoleErrors` accumulates `console.error` output and uncaught page errors so
 * specs (notably navigation.spec) can assert the app runs clean. We deliberately
 * do NOT auto-fail — a spec opts in by asserting on the array — because some
 * third-party libs log benign warnings we filter explicitly.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    page.on("pageerror", (err) => errors.push(err.message))
    await use(errors)
  },
})

import type { Page } from "@playwright/test"

/**
 * Default locale used by every spec unless a test is specifically exercising
 * the language switcher. Routes are locale-prefixed after issue #216
 * (next-intl) — this is the single place that prefix is defined so specs
 * don't hardcode "/en" individually.
 */
export const DEFAULT_LOCALE = "en"

/**
 * Prefixes a path with the locale segment (e.g. "/dashboard" -> "/en/dashboard").
 * Use this instead of raw `page.goto("/some/path")` everywhere in the suite —
 * navigating to an unprefixed path still works (the middleware redirects), but
 * going directly to the prefixed path avoids an extra redirect hop and keeps
 * tests explicit about which locale they're exercising.
 */
export function localePath(path: string, locale: string = DEFAULT_LOCALE): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return normalized === "/" ? `/${locale}` : `/${locale}${normalized}`
}

/**
 * Wait until the browser has received a successful `/api/pools` response
 * (not sub-paths like `/api/pools/messages`).
 * Call this right after `page.goto(...)` to eliminate the race where
 * assertions run before the mocked pool data is applied in the UI.
 */
export function waitForPoolsResponse(page: Page, timeout = 15_000) {
  return page.waitForResponse(
    (r) => {
      if (r.status() !== 200) return false
      try {
        const pathname = new URL(r.url()).pathname
        // Match /api/pools exactly, but NOT sub-paths like /api/pools/messages
        return pathname === "/api/pools" || pathname === "/api/pools/"
      } catch {
        return false
      }
    },
    { timeout }
  )
}

/**
 * Catch-all mock for every API endpoint the app may hit during E2E tests,
 * EXCEPT `/api/pools` (which should be mocked per-spec via `mockPoolsApi`).
 *
 * Without this, unmocked server-side routes (e.g. `/api/notifications`,
 * `/api/analytics`, `/api/user-profile`) hit the real Next.js API handlers,
 * which try to connect to Supabase — causing either slow failures, 500s,
 * or hanging requests that prevent Playwright's `networkidle` from resolving.
 *
 * Call once per test in `beforeEach`, BEFORE `page.goto()`.
 */
export async function mockCommonApis(page: Page) {
  const json = (route: import("@playwright/test").Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })

  // Notifications — empty by default; specs that need data can re-route.
  await page.route("**/api/notifications**", (route) => json(route, { data: [], total: 0 }))

  // Analytics — return empty/safe defaults.
  await page.route("**/api/analytics**", (route) =>
    json(route, {
      totalPools: 0,
      totalSaved: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      averageHealthScore: 100,
      poolsAnalytics: [],
      globalChartData: [],
    })
  )

  // Portfolio summary — return safe defaults.
  await page.route("**/api/portfolio/summary**", (route) =>
    json(route, {
      total_saved: 0,
      total_saved_by_token: {},
      total_pools: { rotational: 0, target: 0, flexible: 0, total: 0 },
      total_yield_earned: 0,
      upcoming_commitments: [],
      reputation_summary: { total_deposits: 0, average_on_time_rate: 100, pools_completed: 0 },
      pools: [],
    })
  )

  // Recommendations — empty by default.
  await page.route("**/api/recommendations**", (route) => json(route, { pools: [] }))

  // User profile — return a safe default profile.
  await page.route("**/api/user-profile**", (route) =>
    json(route, {
      wallet_address: "",
      email: null,
      notification_preferences: {
        email_on_payout: true,
        email_on_deposit: true,
        email_on_round: true,
        email_on_target: true,
        email_on_deposit_reminder: true,
      },
      muted_pools: [],
    })
  )

  // Admin endpoints — return data in the shape each component expects.
  await page.route("**/api/admin/audit-log**", (route) =>
    json(route, { rows: [], inconsistent: false, activityNet: 0, recorded: 0 })
  )
  await page.route("**/api/admin/actions**", (route) => json(route, { actions: [] }))

  // Pool messages — return empty array.
  await page.route("**/api/pools/messages**", (route) => json(route, []))

  // Error reporting — silently accept.
  await page.route("**/api/errors**", (route) => json(route, { ok: true }))

  // Supabase REST calls (from client-side supabase-js) — return empty.
  await page.route("**/rest/v1/**", (route) => json(route, []))
}

export { expect }
export * from "./wallet"
export * from "./mock-pools"
export * from "./constants"
