import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
  E2E_ADDRESS,
  E2E_MEMBER_2,
  E2E_CONTRACT_ID,
} from "./fixtures/test-base"

/**
 * pause-unpause.spec — admin pauses and unpauses a pool, verifying
 * the pause banner and disabled action buttons.
 */

const POOL_ID = "pause-pool"

test("admin pauses an active pool", async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    isPaused: false,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Pause Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])

  await page.goto(`/dashboard/group/${POOL_ID}`)
  await expect(page.getByRole("heading", { name: "Pause Pool" })).toBeVisible()

  // Pause button is visible and enabled for admin
  const pauseBtn = page.getByRole("button", { name: "Pause Pool" })
  await expect(pauseBtn).toBeVisible()
  await expect(pauseBtn).toBeEnabled()

  // Click pause
  await pauseBtn.click()

  // Toast confirms
  await expect(page.locator(".text-sm.opacity-90").getByText(/paused/i)).toBeVisible()
})

test("admin unpauses a paused pool", async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    isPaused: true,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Pause Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])

  await page.goto(`/dashboard/group/${POOL_ID}`)
  await expect(page.getByRole("heading", { name: "Pause Pool" })).toBeVisible()

  // Pause banner is shown
  await expect(page.getByText(/pool is paused/i)).toBeVisible()

  // Unpause button is visible
  const unpauseBtn = page.getByRole("button", { name: "Unpause Pool" })
  await expect(unpauseBtn).toBeVisible()
  await expect(unpauseBtn).toBeEnabled()

  // Click unpause
  await unpauseBtn.click()

  // Toast confirms
  await expect(page.locator(".text-sm.opacity-90").getByText(/unpaused/i)).toBeVisible()
})

test("non-admin cannot see pause/unpause buttons", async ({ page }) => {
  await connectWallet(page)
  // Set admin to a different address so the connected wallet (E2E_ADDRESS) is NOT admin
  await seedChainState(page, {
    isActive: true,
    isPaused: false,
    admin: E2E_MEMBER_2,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Pause Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])

  await page.goto(`/dashboard/group/${POOL_ID}`)
  await expect(page.getByRole("heading", { name: "Pause Pool" })).toBeVisible()

  // Admin Controls section shows the "only admin" message
  await expect(page.getByText("Only the pool admin can pause or unpause")).toBeVisible()

  // The pause button should be disabled (non-admin)
  const pauseBtn = page.getByRole("button", { name: "Pause Pool" })
  await expect(pauseBtn).toBeDisabled()

  // The unpause button should also be disabled
  const unpauseBtn = page.getByRole("button", { name: "Unpause Pool" })
  await expect(unpauseBtn).toBeDisabled()
})
