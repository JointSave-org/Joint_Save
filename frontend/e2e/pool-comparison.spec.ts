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
 * pool-comparison.spec — select pools on the explore page, open the
 * comparison page, and verify the comparison table renders.
 */

const POOL_A = makePool({
  id: "cmp-a",
  name: "Compare Pool A",
  type: "rotational",
  status: "active",
  contract_address: E2E_CONTRACT_ID,
  members_count: 5,
  total_saved: 500,
  frequency: "weekly",
  contribution_amount: 100,
})

const POOL_B = makePool({
  id: "cmp-b",
  name: "Compare Pool B",
  type: "target",
  status: "active",
  contract_address: "CBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  members_count: 8,
  total_saved: 1200,
  target_amount: 5000,
  contribution_amount: 200,
})

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, { isActive: true })
  await mockPoolsApi(page, [POOL_A, POOL_B])
})

test("compare bar appears when pools are selected", async ({ page }) => {
  await page.goto("/explore")
  await expect(page.getByText("Compare Pool A")).toBeVisible()
  await expect(page.getByText("Compare Pool B")).toBeVisible()

  // Select first pool for comparison
  await page.getByRole("checkbox", { name: /compare compare pool a/i }).click()

  // Floating compare bar appears
  await expect(page.getByText("1 pool selected")).toBeVisible()
  await expect(page.getByRole("button", { name: /compare \(1\)/i })).toBeVisible()
})

test("compare page shows comparison table via URL", async ({ page }) => {
  // Navigate directly to compare page with pools in query string
  await page.goto(
    `/explore/compare?pools=${POOL_A.contract_address},${POOL_B.contract_address}`
  )

  // Compare page heading
  await expect(page.getByRole("heading", { name: "Compare Pools" })).toBeVisible()

  // Pool names appear in the page
  await expect(page.getByText("Compare Pool A")).toBeVisible()
  await expect(page.getByText("Compare Pool B")).toBeVisible()
})

test("clear selection removes compare bar", async ({ page }) => {
  await page.goto("/explore")
  await expect(page.getByText("Compare Pool A")).toBeVisible()

  // Select a pool
  await page.getByRole("checkbox", { name: /compare compare pool a/i }).click()
  await expect(page.getByText("1 pool selected")).toBeVisible()

  // Click Clear
  await page.getByRole("button", { name: "Clear" }).click()

  // Compare bar disappears
  await expect(page.getByText("1 pool selected")).toBeHidden()
})

test("compare button is disabled with only one pool selected", async ({ page }) => {
  await page.goto("/explore")
  await expect(page.getByText("Compare Pool A")).toBeVisible()

  // Select one pool
  await page.getByRole("checkbox", { name: /compare compare pool a/i }).click()
  await expect(page.getByText("1 pool selected")).toBeVisible()

  // Compare button exists but is disabled (< 2 pools)
  const compareBtn = page.getByRole("button", { name: /compare \(1\)/i })
  await expect(compareBtn).toBeVisible()
  await expect(compareBtn).toBeDisabled()
})
