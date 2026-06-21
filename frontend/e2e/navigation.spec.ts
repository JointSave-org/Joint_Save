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
 * navigation.spec — walk the primary path landing → dashboard → group detail →
 * back, asserting each route renders and that the app produces no real console
 * errors along the way.
 */

const POOL_ID = "nav-pool"

// Benign console noise we don't want to fail the run on (dev-only logs, 3rd-party
// analytics, resource 404s for optional assets, React devtools hint, etc.).
const BENIGN = [
  /Failed to load resource/i,
  /_vercel|vercel.*analytics/i,
  /favicon/i,
  /Download the React DevTools/i,
  /hydrat/i,
]

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS],
    currentRound: 0,
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Navigation Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])
})

test("landing → dashboard → group → back renders cleanly", async ({
  page,
  consoleErrors,
}) => {
  // Landing
  await page.goto("/")
  await expect(page.getByRole("link", { name: "JointSave" }).first()).toBeVisible()

  // → Dashboard (header link appears once the wallet is connected)
  const dashboardLink = page
    .getByRole("banner")
    .getByRole("link", { name: "Dashboard" })
  await expect(dashboardLink).toBeVisible()
  await dashboardLink.click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByRole("heading", { name: "My Groups" })).toBeVisible()

  // → Group detail
  await page.getByRole("link", { name: /view details/i }).first().click()
  await expect(page).toHaveURL(new RegExp(`/dashboard/group/${POOL_ID}`))
  await expect(
    page.getByRole("heading", { name: "Navigation Pool" })
  ).toBeVisible()

  // → Back to dashboard
  await page.getByRole("link", { name: /back to dashboard/i }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole("heading", { name: "My Groups" })).toBeVisible()

  // No real console errors accumulated across the journey
  const real = consoleErrors.filter((e) => !BENIGN.some((re) => re.test(e)))
  expect(real, `Unexpected console errors:\n${real.join("\n")}`).toEqual([])
})
