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
  await mockCommonApis(page)

  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath(`/dashboard/group/${POOL_ID}`), { waitUntil: "networkidle" })
  await poolsResponse
  await expect(page.getByRole("heading", { name: /Pause Pool/i })).toBeVisible()

  // Pause button is visible and enabled for admin (exact match to avoid "Unpause Pool")
  const pauseBtn = page.getByRole("button", { name: "Pause Pool", exact: true })
  await expect(pauseBtn).toBeVisible()
  await expect(pauseBtn).toBeEnabled()

  // Click pause
  await pauseBtn.click()

  // Toast confirms — use .text-sm.opacity-90 to target description, avoid strict mode
  await expect(page.locator(".text-sm.opacity-90").getByText(/paused/i)).toBeVisible({
    timeout: 10000,
  })
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
  await mockCommonApis(page)

  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath(`/dashboard/group/${POOL_ID}`), { waitUntil: "networkidle" })
  await poolsResponse
  await expect(page.getByRole("heading", { name: /Pause Pool/i })).toBeVisible()

  // Pause banner is shown
  await expect(page.getByText(/pool is paused/i)).toBeVisible()

  // Unpause button is visible (exact match)
  const unpauseBtn = page.getByRole("button", { name: "Unpause Pool", exact: true })
  await expect(unpauseBtn).toBeVisible()
  await expect(unpauseBtn).toBeEnabled()

  // Click unpause
  await unpauseBtn.click()

  // Toast confirms — use .text-sm.opacity-90 to target description, avoid strict mode
  await expect(page.locator(".text-sm.opacity-90").getByText(/unpaused/i)).toBeVisible({
    timeout: 10000,
  })
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
  await mockCommonApis(page)

  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(localePath(`/dashboard/group/${POOL_ID}`), { waitUntil: "networkidle" })
  await poolsResponse
  await expect(page.getByRole("heading", { name: /Pause Pool/i })).toBeVisible()

  // Admin Controls section shows the "only admin" message
  await expect(page.getByText("Only the pool admin can pause or unpause")).toBeVisible()

  // Both buttons are always in the DOM; use exact match to avoid "Unpause Pool"
  const pauseBtn = page.getByRole("button", { name: "Pause Pool", exact: true })
  await expect(pauseBtn).toBeDisabled()

  const unpauseBtn = page.getByRole("button", { name: "Unpause Pool", exact: true })
  await expect(unpauseBtn).toBeDisabled()
})
