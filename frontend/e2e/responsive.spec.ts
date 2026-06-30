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
 * responsive.spec — render the dashboard and a group detail page at mobile,
 * tablet and desktop widths, asserting the key content is visible and there is
 * no horizontal overflow at any breakpoint.
 */

const POOL_ID = "responsive-pool"

const VIEWPORTS = [
  { label: "mobile", width: 375, height: 812 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 },
] as const

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
      name: "Responsive Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])
})

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return el.scrollWidth - el.clientWidth
  })
  // Allow 1px for sub-pixel rounding
  expect(overflow).toBeLessThanOrEqual(1)
}

for (const vp of VIEWPORTS) {
  test(`dashboard renders without overflow at ${vp.label} (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto("/dashboard")
    await expect(page.getByRole("heading", { name: "My Groups" })).toBeVisible()
    await expect(page.getByText("Responsive Pool")).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test(`group detail renders without overflow at ${vp.label} (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto(`/dashboard/group/${POOL_ID}`)
    await expect(page.getByRole("heading", { name: "Responsive Pool" })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
}
