import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
  E2E_ADDRESS,
  E2E_MEMBER_2,
} from "./fixtures/test-base"

/**
 * batch-deposit.spec — proves the headline from the outside: a wallet that owes
 * deposits to several rotational pools opens the dashboard, sees the Batch
 * Deposit panel, selects pools, and deposits to all of them in one run.
 *
 * Every pool is deposited to in its own Soroban transaction (one host-function
 * invocation per transaction is a protocol limit), so the run is a queue of
 * independent transactions — which is exactly what the progress list shows.
 */

/** Three rotational pools the connected wallet is a member of. */
function memberPools() {
  const membership = [
    { member_address: E2E_ADDRESS.toLowerCase() },
    { member_address: E2E_MEMBER_2.toLowerCase() },
  ]
  return [
    makePool({
      id: "batch-pool-1",
      name: "Batch Circle One",
      contribution_amount: 50,
      pool_members: membership,
    }),
    makePool({
      id: "batch-pool-2",
      name: "Batch Circle Two",
      contribution_amount: 75,
      pool_members: membership,
    }),
    makePool({
      id: "batch-pool-3",
      name: "Batch Circle Three",
      contribution_amount: 25,
      pool_members: membership,
    }),
  ]
}

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
})

test("deposits to every selected pool from the dashboard in one run", async ({ page }) => {
  await seedChainState(page, {
    isActive: true,
    isPaused: false,
    hasDeposited: false,
    currentRound: 2,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
    nextPayoutTime: Math.floor(Date.now() / 1000) + 2 * 3600,
  })
  await mockPoolsApi(page, memberPools())

  await page.goto("/dashboard")

  // 1) The panel surfaces what is owed.
  const panel = page.getByTestId("batch-deposit-panel")
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("3 pools need a deposit")
  await expect(panel).toContainText("Depositing to 3 pools: 150 XLM total")

  // 2) The selection dialog lists each pool with its amount and urgency.
  await page.getByRole("button", { name: "Batch Deposit" }).click()
  const dialog = page.getByTestId("batch-deposit-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("Batch Circle One")).toBeVisible()
  await expect(dialog.getByText("Batch Circle Two")).toBeVisible()
  await expect(dialog.getByText("Batch Circle Three")).toBeVisible()
  await expect(dialog.getByTestId("batch-total")).toHaveText(
    "Depositing to 3 pools: 150 XLM total"
  )

  // 3) Deselecting a pool updates the running total.
  await dialog.getByTestId("batch-pool-row-batch-pool-3").click()
  await expect(dialog.getByTestId("batch-total")).toHaveText(
    "Depositing to 2 pools: 125 XLM total"
  )

  // …and Select All puts it back.
  await dialog.getByRole("button", { name: "Select All", exact: true }).click()
  await expect(dialog.getByTestId("batch-total")).toHaveText(
    "Depositing to 3 pools: 150 XLM total"
  )

  // 4) The run submits one transaction per pool and confirms each.
  await dialog.getByTestId("batch-deposit-now").click()

  const progress = page.getByTestId("batch-deposit-progress")
  await expect(progress).toBeVisible()
  await expect(progress.getByTestId("batch-progress-label")).toHaveText("Deposited to 3 pools")
  await expect(progress.getByTestId("batch-status-confirmed")).toHaveCount(3)

  for (const id of ["batch-pool-1", "batch-pool-2", "batch-pool-3"]) {
    await expect(progress.getByTestId(`batch-progress-item-${id}`)).toContainText("Confirmed")
  }
})

test("hides the panel when every pool is already paid up", async ({ page }) => {
  await seedChainState(page, {
    isActive: true,
    hasDeposited: true,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, memberPools())

  await page.goto("/dashboard")

  // The dashboard itself renders…
  await expect(page.getByRole("heading", { name: "My Groups" })).toBeVisible()
  // …but nothing is owed, so the panel never appears.
  await expect(page.getByTestId("batch-deposit-panel")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Batch Deposit" })).toHaveCount(0)
})

test("batch deposit UI is usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedChainState(page, {
    isActive: true,
    hasDeposited: false,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
    nextPayoutTime: Math.floor(Date.now() / 1000) + 2 * 3600,
  })
  await mockPoolsApi(page, memberPools())

  await page.goto("/dashboard")

  const panel = page.getByTestId("batch-deposit-panel")
  await expect(panel).toBeVisible()

  // Nothing overflows the viewport horizontally.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  )
  expect(overflows).toBe(false)

  await page.getByRole("button", { name: "Batch Deposit" }).click()
  const dialog = page.getByTestId("batch-deposit-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId("batch-deposit-now")).toBeVisible()

  const box = await dialog.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(390)
})
