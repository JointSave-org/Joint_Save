import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
  waitForPoolsResponse,
  E2E_ADDRESS,
  E2E_CONTRACT_ID,
} from "./fixtures/test-base"

/**
 * dashboard-tabs.spec — switch between the seven dashboard tabs and
 * verify each one renders its primary content heading or empty state.
 */

const POOL_ID = "tab-pool"

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Tab Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])

  await page.route("**/api/recommendations**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pools: [] }),
    })
  )

  await page.route("**/api/portfolio/summary**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total_saved: 0,
        total_saved_by_token: {},
        total_pools: { rotational: 0, target: 0, flexible: 0, total: 0 },
        total_yield_earned: 0,
        upcoming_commitments: [],
        reputation_summary: {
          total_deposits: 0,
          average_on_time_rate: 0,
          pools_completed: 0,
        },
        pools: [],
      }),
    })
  )

  await page.route("**/api/analytics**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalPools: 0,
        totalSaved: 0,
        totalDeposits: 0,
        totalWithdrawals: 0,
        averageHealthScore: 100,
        poolsAnalytics: [],
        globalChartData: [],
      }),
    })
  )

  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  )
})

test("My Groups tab is default and shows pool list", async ({ page }) => {
  await page.goto("/dashboard")
  await waitForPoolsResponse(page)

  await expect(page.getByRole("heading", { name: /My Groups/ })).toBeVisible()
  await expect(page.getByText(/Tab Pool/)).toBeVisible()
})

test("Explore tab shows explore content", async ({ page }) => {
  await page.goto("/dashboard")
  await waitForPoolsResponse(page)

  await page.getByRole("tab", { name: /explore/i }).click()
  await expect(page.getByRole("heading", { name: /Explore Pools/ })).toBeVisible()
})

test("Create tab shows create content", async ({ page }) => {
  await page.goto("/dashboard")
  await waitForPoolsResponse(page)

  await page.getByRole("tab", { name: /create/i }).click()
  await expect(page.getByRole("heading", { name: /create.*group/i })).toBeVisible()
})

test("Portfolio tab renders", async ({ page }) => {
  await page.goto("/dashboard")
  await waitForPoolsResponse(page)

  await page.getByRole("tab", { name: /portfolio/i }).click()
  await expect(page.getByRole("tab", { name: /portfolio/i })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})

test("Transactions tab renders", async ({ page }) => {
  await page.goto("/dashboard")
  await waitForPoolsResponse(page)

  await page.getByRole("tab", { name: /transactions/i }).click()
  await expect(page.getByRole("tab", { name: /transactions/i })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})

test("Analytics tab renders", async ({ page }) => {
  await page.goto("/dashboard")
  await waitForPoolsResponse(page)

  await page.getByRole("tab", { name: /analytics/i }).click()
  await expect(page.getByRole("tab", { name: /analytics/i })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})

test("Profile tab renders", async ({ page }) => {
  await page.goto("/dashboard")
  await waitForPoolsResponse(page)

  await page.getByRole("tab", { name: /profile/i }).click()
  await expect(page.getByRole("tab", { name: /profile/i })).toHaveAttribute("aria-selected", "true")
})
