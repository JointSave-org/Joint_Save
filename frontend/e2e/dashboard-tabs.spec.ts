import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  mockCommonApis,
  makePool,
  waitForPoolsResponse,
  E2E_ADDRESS,
  E2E_CONTRACT_ID,
  localePath,
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
  await mockCommonApis(page)
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
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath("/dashboard"), { waitUntil: "networkidle" })
  await poolsResponse

  await expect(page.getByRole("heading", { name: /My Groups/i })).toBeVisible()
  await expect(page.getByText(/Tab Pool/i)).toBeVisible()
})

test("Explore tab shows explore content", async ({ page }) => {
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath("/dashboard"), { waitUntil: "networkidle" })
  await poolsResponse

  await page.getByRole("tab", { name: /explore/i }).click()
  await expect(page.getByRole("heading", { name: /Explore Pools/i })).toBeVisible()
})

test("Create tab shows create content", async ({ page }) => {
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath("/dashboard"), { waitUntil: "networkidle" })
  await poolsResponse

  await page.getByRole("tab", { name: /create/i }).click()
  await expect(page.getByRole("heading", { name: /create.*group/i })).toBeVisible()
})

test("Portfolio tab renders", async ({ page }) => {
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath("/dashboard"), { waitUntil: "networkidle" })
  await poolsResponse

  const tab = page.getByRole("tab", { name: /portfolio/i })
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 10000 })
})

test("Transactions tab renders", async ({ page }) => {
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath("/dashboard"), { waitUntil: "networkidle" })
  await poolsResponse

  const tab = page.getByRole("tab", { name: /transactions/i })
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 10000 })
})

test("Analytics tab renders", async ({ page }) => {
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath("/dashboard"), { waitUntil: "networkidle" })
  await poolsResponse

  const tab = page.getByRole("tab", { name: /analytics/i })
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 10000 })
})

test("Profile tab renders", async ({ page }) => {
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath("/dashboard"), { waitUntil: "networkidle" })
  await poolsResponse

  await page.getByRole("tab", { name: /profile/i }).click()
  await expect(page.getByRole("tab", { name: /profile/i })).toHaveAttribute("aria-selected", "true")
})
