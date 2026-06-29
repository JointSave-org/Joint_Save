import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  E2E_MEMBER_2,
} from "./fixtures/test-base"

/**
 * create-pool.spec — exercises the full create flow for all three pool types:
 * fill the dashboard form → deploy/init/register (stubbed) → save metadata
 * (mocked) → redirect to the group page, where on-chain state is read back via a
 * (stubbed) view call. Finally the pool appears in "My Groups".
 */

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page) // sane on-chain defaults for the new pool
  await mockPoolsApi(page)
})

const cases = [
  {
    type: "rotational",
    name: "E2E Rotational Circle",
    submit: "Create Rotational Group",
    fill: async (page: import("@playwright/test").Page) => {
      await page.locator("#amount").fill("100")
    },
  },
  {
    type: "target",
    name: "E2E Target Fund",
    submit: "Create Target Pool",
    fill: async (page: import("@playwright/test").Page) => {
      await page.locator("#target").fill("5000")
      await page.locator("#deadlineDays").fill("365")
    },
  },
  {
    type: "flexible",
    name: "E2E Flexible Vault",
    submit: "Create Flexible Pool",
    fill: async (page: import("@playwright/test").Page) => {
      await page.locator("#minimum").fill("50")
      // #fee defaults to "1" — leave as-is
    },
  },
] as const

for (const c of cases) {
  test(`creates a ${c.type} pool and surfaces it everywhere`, async ({ page }) => {
    await page.goto(`/dashboard/create/${c.type}`)

    // Heading confirms the right form rendered
    await expect(page.getByRole("heading", { name: new RegExp(c.type, "i") })).toBeVisible()

    await page.locator("#name").fill(c.name)
    await c.fill(page)

    // Add the required 2nd member (creator is auto-included as the 1st)
    await page
      .getByPlaceholder(/56-character Stellar address/i)
      .first()
      .fill(E2E_MEMBER_2)

    await page.getByRole("button", { name: c.submit }).click()

    // 1) Redirected to the new pool's detail page
    await expect(page).toHaveURL(/\/dashboard\/group\//, { timeout: 15_000 })

    // 2) Group page shows the name and reads on-chain state back via a view call
    await expect(page.getByRole("heading", { name: c.name })).toBeVisible()
    await expect(page.getByText("Live onchain")).toBeVisible()

    // 3) Pool now appears in "My Groups"
    await page.goto("/dashboard")
    await expect(page.getByRole("heading", { name: "My Groups" })).toBeVisible()
    await expect(page.getByText(c.name)).toBeVisible()
  })
}
