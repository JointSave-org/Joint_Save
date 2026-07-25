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
 * deposit-flow.spec — join (view) a flexible pool, submit a deposit, and verify
 * the UI reflects it: an inline submitted/confirming message, then — after the
 * chain "catches up" and the user refreshes — the new balance and a Deposit row
 * in the activity feed.
 */

const POOL_ID = "deposit-pool"
const XLM = 10_000_000 // stroops per XLM

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    isPaused: false,
    totalBalance: 100 * XLM, // 100 XLM in the pool
    balanceOf: 10 * XLM, //  10 XLM is the user's
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Deposit Pool",
      type: "flexible",
      contract_address: E2E_CONTRACT_ID,
      minimum_deposit: 1,
      withdrawal_fee: 1,
    }),
  ])
})

test("deposits into a flexible pool and reflects it in the UI", async ({ page }) => {
  await page.goto(`/dashboard/group/${POOL_ID}`)

  // Pool detail loads with the user's starting balance
  await expect(page.getByRole("heading", { name: "Deposit Pool" })).toBeVisible()
  await expect(page.getByText("Your Balance")).toBeVisible()

  // Submit a 25 XLM deposit
  await page.locator("#deposit").fill("25")
  await page.getByRole("button", { name: "Deposit" }).click()

  // The submit path completed (signed + sent via the stub) and was logged
  // Use ToastDescription selector to avoid strict mode violation (toast has ARIA live region duplicate)
  await expect(page.locator(".text-sm.opacity-90").getByText(/Deposit submitted/i)).toBeVisible()

  // Simulate the chain reflecting the deposit, then refresh from on-chain state
  await page.evaluate((xlm) => {
    const s = (window as any).__E2E_STATE__ ?? {}
    s.balanceOf = 35 * xlm
    s.totalBalance = 125 * xlm
    ;(window as any).__E2E_STATE__ = s
  }, XLM)

  // The activity feed refresh (icon-only button beside the heading) re-reads
  // both /api/pools and on-chain state.
  await expect(page.getByText("Recent Activity")).toBeVisible()
  await page
    .locator("h3", { hasText: "Recent Activity" })
    .locator("xpath=following-sibling::button")
    .click()
  await expect(page.getByText("Deposit", { exact: true }).first()).toBeVisible()

  // Updated balance is reflected
  await expect(page.getByText("35.00").first()).toBeVisible()
})
