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
  E2E_MEMBER_2,
  E2E_CONTRACT_ID,
  localePath,
} from "./fixtures/test-base"

/**
 * payout-flow.spec — trigger a rotational pool payout. The admin clicks
 * "Trigger Payout", the preview dialog opens with fee breakdown, then the
 * user confirms and sees a submitted toast.
 */

const POOL_ID = "payout-pool"

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    isPaused: false,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
    currentRound: 0,
    treasuryFeeBps: 100,
    relayerFeeBps: 50,
  })
  await mockCommonApis(page)
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Payout Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
      contribution_amount: 100,
      frequency: "weekly",
    }),
  ])
})

test("opens payout preview and confirms", async ({ page }) => {
  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath(`/dashboard/group/${POOL_ID}`), { waitUntil: "networkidle" })
  await poolsResponse
  await expect(page.getByRole("heading", { name: /Payout Pool/i })).toBeVisible()

  // Trigger payout button is present for rotational pools
  const payoutBtn = page.getByRole("button", { name: /trigger payout/i })
  await expect(payoutBtn).toBeVisible()
  await payoutBtn.click()

  // Preview dialog opens
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: /confirm rotational payout/i })).toBeVisible()

  // Fee breakdown rows are visible
  await expect(dialog.getByText("Total Collected")).toBeVisible()
  await expect(dialog.getByText(/treasury fee/i).first()).toBeVisible()
  await expect(dialog.getByText(/relayer fee/i).first()).toBeVisible()

  // Confirm and sign
  await dialog.getByRole("button", { name: /confirm & sign/i }).click()

  // Dialog closes and toast appears
  await expect(dialog).toBeHidden()
  await expect(page.locator(".text-sm.opacity-90").getByText(/payout/i)).toBeVisible({
    timeout: 10000,
  })
})
