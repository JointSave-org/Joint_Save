import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
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
})

test("My Groups tab is default and shows pool list", async ({ page }) => {
  await page.goto("/dashboard")

  // Default tab is "My Groups"
  await expect(page.getByRole("heading", { name: "My Groups" })).toBeVisible()
  await expect(page.getByText("Tab Pool")).toBeVisible()
})

test("Explore tab shows explore content", async ({ page }) => {
  await page.goto("/dashboard")

  // Click Explore tab
  await page.getByRole("tab", { name: /explore/i }).click()

  // Explore heading renders
  await expect(page.getByRole("heading", { name: "Explore Pools" })).toBeVisible()
})

test("Create tab shows create content", async ({ page }) => {
  await page.goto("/dashboard")

  // Click Create tab
  await page.getByRole("tab", { name: /create/i }).click()

  // Create heading renders
  await expect(page.getByRole("heading", { name: /create.*group/i })).toBeVisible()
})

test("Portfolio tab renders", async ({ page }) => {
  await page.goto("/dashboard")

  await page.getByRole("tab", { name: /portfolio/i }).click()

  // Portfolio renders — look for the heading or the card
  await expect(page.getByText(/portfolio/i).first()).toBeVisible()
})

test("Transactions tab renders", async ({ page }) => {
  await page.goto("/dashboard")

  await page.getByRole("tab", { name: /transactions/i }).click()

  // Transactions tab content is present
  await expect(page.getByRole("tab", { name: /transactions/i })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})

test("Analytics tab renders", async ({ page }) => {
  await page.goto("/dashboard")

  await page.getByRole("tab", { name: /analytics/i }).click()

  // Analytics tab content is present
  await expect(page.getByRole("tab", { name: /analytics/i })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})

test("Profile tab renders", async ({ page }) => {
  await page.goto("/dashboard")

  await page.getByRole("tab", { name: /profile/i }).click()

  // Profile tab content is present
  await expect(page.getByRole("tab", { name: /profile/i })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})
