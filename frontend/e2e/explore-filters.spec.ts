import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
  E2E_CONTRACT_ID,
} from "./fixtures/test-base"

/**
 * explore-filters.spec — /explore page with search, type filter, and
 * status filter. Verifies that the pool grid updates as filters change.
 */

const POOLS = [
  makePool({
    id: "explore-rot",
    name: "Alpha Rotational",
    type: "rotational",
    status: "active",
    contract_address: E2E_CONTRACT_ID,
    members_count: 5,
    total_saved: 500,
    frequency: "weekly",
  }),
  makePool({
    id: "explore-tgt",
    name: "Beta Target",
    type: "target",
    status: "active",
    contract_address: "CBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    members_count: 10,
    total_saved: 1000,
    target_amount: 5000,
  }),
  makePool({
    id: "explore-flx",
    name: "Gamma Flexible",
    type: "flexible",
    status: "completed",
    contract_address: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    members_count: 3,
    total_saved: 300,
  }),
]

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, { isActive: true })
  await mockPoolsApi(page, POOLS)

  await page.route("**/api/recommendations**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pools: [] }),
    })
  )
})

test("search filters by pool name", async ({ page }) => {
  await page.goto("/explore")
  await page.waitForResponse((resp) => resp.url().includes("/api/pools") && resp.status() === 200)

  await expect(page.getByRole("heading", { name: "Explore Pools" })).toBeVisible()
  await expect(page.getByText("Alpha Rotational")).toBeVisible()
  await expect(page.getByText("Beta Target")).toBeVisible()
  await expect(page.getByText("Gamma Flexible")).toBeVisible()

  await page.getByPlaceholder(/search by pool name/i).fill("Alpha")

  await expect(page.getByText("Alpha Rotational")).toBeVisible()
  await expect(page.getByText("Beta Target")).toBeHidden()
  await expect(page.getByText("Gamma Flexible")).toBeHidden()
})

test("type filter shows only matching pools", async ({ page }) => {
  await page.goto("/explore")
  await page.waitForResponse((resp) => resp.url().includes("/api/pools") && resp.status() === 200)
  await expect(page.getByText("Alpha Rotational")).toBeVisible()

  await page.locator('[role="combobox"]').first().click()
  await page.getByRole("option", { name: "Rotational" }).click()

  await expect(page.getByText("Alpha Rotational")).toBeVisible()
  await expect(page.getByText("Beta Target")).toBeHidden()
})

test("status filter shows only matching pools", async ({ page }) => {
  await page.goto("/explore")
  await page.waitForResponse((resp) => resp.url().includes("/api/pools") && resp.status() === 200)
  await expect(page.getByText("Alpha Rotational")).toBeVisible()

  await page.locator('[role="combobox"]').nth(1).click()
  await page.getByRole("option", { name: "Active" }).click()

  await expect(page.getByText("Alpha Rotational")).toBeVisible()
  await expect(page.getByText("Beta Target")).toBeVisible()
  await expect(page.getByText("Gamma Flexible")).toBeHidden()
})

test("empty state when no pools match", async ({ page }) => {
  await page.goto("/explore")
  await page.waitForResponse((resp) => resp.url().includes("/api/pools") && resp.status() === 200)
  await expect(page.getByText("Alpha Rotational")).toBeVisible()

  await page.getByPlaceholder(/search by pool name/i).fill("Nonexistent Pool")

  await expect(page.getByText("No pools found")).toBeVisible()
  await expect(page.getByText(/try adjusting your search/i)).toBeVisible()
})

test("pool cards have view and request to join buttons", async ({ page }) => {
  await page.goto("/explore")
  await page.waitForResponse((resp) => resp.url().includes("/api/pools") && resp.status() === 200)
  await expect(page.getByText("Alpha Rotational")).toBeVisible()

  const viewBtns = page.getByRole("link", { name: "View" })
  await expect(viewBtns.first()).toBeVisible()

  const joinBtns = page.getByRole("button", { name: /request to join/i })
  await expect(joinBtns.first()).toBeVisible()
})
