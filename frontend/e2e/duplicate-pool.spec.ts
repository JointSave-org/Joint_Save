import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
  E2E_MEMBER_2,
  E2E_CONTRACT_ID,
} from "./fixtures/test-base"

/**
 * duplicate-pool.spec — verifies the "Duplicate Pool / Start New Cycle" flow:
 *   1. Group detail page shows the button for active non-pending pools.
 *   2. Clicking navigates to /dashboard/create/<type>?duplicate=1&…
 *   3. The create form is pre-filled with the original pool's name + amount.
 *   4. Submitting creates a new pool and redirects to its group page.
 *   5. The button is hidden for pending-deployment pools.
 */

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page)
})

const cases = [
  {
    type: "rotational" as const,
    overrides: { name: "Dup Rotational", type: "rotational" as const, frequency: "weekly", contribution_amount: 100 },
    amountId: "#amount",
    expectedValue: "100",
    submit: "Create Rotational Group",
    extraFill: async (_page: import("@playwright/test").Page) => {},
  },
  {
    type: "target" as const,
    overrides: { name: "Dup Target", type: "target" as const, target_amount: 5000, contribution_amount: null },
    amountId: "#target",
    expectedValue: "5000",
    submit: "Create Target Pool",
    extraFill: async (page: import("@playwright/test").Page) => {
      await page.locator("#deadline").fill("2027-12-31")
    },
  },
  {
    type: "flexible" as const,
    overrides: { name: "Dup Flexible", type: "flexible" as const, minimum_deposit: 50, contribution_amount: null },
    amountId: "#minimum",
    expectedValue: "50",
    submit: "Create Flexible Pool",
    extraFill: async (_page: import("@playwright/test").Page) => {},
  },
] as const

for (const c of cases) {
  test(`duplicate ${c.type} pool pre-fills form and creates new pool`, async ({ page }) => {
    const pool = makePool({
      ...c.overrides,
      contract_address: E2E_CONTRACT_ID,
      status: "active",
      pool_members: [
        { id: "m1", member_address: E2E_MEMBER_2, contribution_amount: 0, status: "active" },
      ],
      members_count: 2,
    })
    await mockPoolsApi(page, [pool])

    // 1. Group detail page loads and shows the duplicate button
    await page.goto(`/dashboard/group/${pool.id}`)
    await expect(page.getByRole("heading", { name: pool.name })).toBeVisible()

    const dupLink = page.getByRole("link", { name: /duplicate pool|new cycle/i })
    await expect(dupLink).toBeVisible()

    // 2. Click navigates to create page with ?duplicate=1
    await dupLink.click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/create/${c.type}.*duplicate=1`), { timeout: 10_000 })

    // 3. Name and amount are pre-filled
    await expect(page.locator("#name")).toHaveValue(pool.name)
    await expect(page.locator(c.amountId)).toHaveValue(c.expectedValue)

    // 4. Original member is pre-populated
    await expect(page.getByPlaceholder(/56-character Stellar address/i).first()).toHaveValue(E2E_MEMBER_2)

    await c.extraFill(page)

    // 5. Submit creates pool and redirects to its group page
    await page.getByRole("button", { name: c.submit }).click()
    await expect(page).toHaveURL(/\/dashboard\/group\//, { timeout: 15_000 })
    await expect(page.getByRole("heading", { name: pool.name })).toBeVisible()
  })
}

test("duplicate button is hidden for pending-deployment pools", async ({ page }) => {
  const pool = makePool({ name: "Pending Pool", contract_address: "pending_deployment", status: "active" })
  await mockPoolsApi(page, [pool])

  await page.goto(`/dashboard/group/${pool.id}`)
  await expect(page.getByRole("heading", { name: "Pending Pool" })).toBeVisible()
  await expect(page.getByRole("link", { name: /duplicate pool|new cycle/i })).toHaveCount(0)
})
