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
 * withdraw-flow.spec — flexible pool withdrawal with fee preview dialog.
 * Enter an amount, click withdraw, review the fee breakdown, confirm.
 */

const POOL_ID = "withdraw-pool"
const XLM = 10_000_000

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    isPaused: false,
    totalBalance: 200 * XLM,
    balanceOf: 50 * XLM,
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Withdraw Pool",
      type: "flexible",
      contract_address: E2E_CONTRACT_ID,
      minimum_deposit: 1,
      withdrawal_fee: 5,
    }),
  ])
})

test("withdraws from a flexible pool with fee preview", async ({ page }) => {
  await page.goto(`/dashboard/group/${POOL_ID}`)
  await expect(page.getByRole("heading", { name: "Withdraw Pool" })).toBeVisible()

  // Enter withdrawal amount
  await page.locator("#withdraw").fill("20")
  await page.getByRole("button", { name: "Withdraw" }).click()

  // Preview dialog opens with fee breakdown
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Confirm Withdrawal" })).toBeVisible()
  await expect(dialog.getByText("Withdraw Amount")).toBeVisible()
  await expect(dialog.getByText(/withdrawal fee/i)).toBeVisible()
  await expect(dialog.getByText("Net Amount You Receive")).toBeVisible()

  // Confirm and sign
  await dialog.getByRole("button", { name: /confirm & sign/i }).click()

  // Dialog closes and toast appears
  await expect(dialog).toBeHidden()
  await expect(page.locator(".text-sm.opacity-90").getByText(/withdrawal/i)).toBeVisible()
})

test("target pool withdraw sends directly", async ({ page }) => {
  await page.goto(`/dashboard/group/${POOL_ID}`)

  // Set up a target pool instead by re-mocking
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Target Pool",
      type: "target",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])
  await seedChainState(page, {
    isActive: true,
    isPaused: false,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS],
    totalDeposited: 500 * XLM,
    targetAmount: 1000 * XLM,
  })

  // Navigate after re-mocking
  await page.goto(`/dashboard/group/${POOL_ID}`)
  await expect(page.getByRole("heading", { name: "Target Pool" })).toBeVisible()

  // Target pool has a direct withdraw button (no amount input)
  const withdrawBtn = page.getByRole("button", { name: /^withdraw$/i })
  await expect(withdrawBtn).toBeVisible()
  await withdrawBtn.click()

  // Toast appears directly (no preview dialog for target withdraw)
  await expect(page.locator(".text-sm.opacity-90").getByText(/withdrawal/i)).toBeVisible()
})

test("withdraw button disabled when paused", async ({ page }) => {
  await seedChainState(page, {
    isActive: true,
    isPaused: true,
    totalBalance: 200 * XLM,
    balanceOf: 50 * XLM,
  })

  await page.goto(`/dashboard/group/${POOL_ID}`)
  await expect(page.getByText("Pool is paused")).toBeVisible()

  // Withdraw button should be disabled
  const withdrawBtn = page.getByRole("button", { name: "Withdraw" })
  await expect(withdrawBtn).toBeDisabled()
})
