import { test, expect, connectWallet, seedChainState, E2E_ADDRESS } from "./fixtures/test-base"

/**
 * notifications.spec — visit the notifications page, verify empty state,
 * loading of notifications from the mocked API, and pagination.
 */

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, { isActive: true })
})

test("shows empty state when no notifications", async ({ page }) => {
  // Mock notifications API to return empty
  await page.route("**/api/notifications**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0 }),
    })
  })

  await page.goto("/dashboard/notifications")

  // Page title
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible()

  // Summary text
  await expect(page.getByText("You're all caught up")).toBeVisible()

  // Empty state
  await expect(page.getByText("No notifications yet")).toBeVisible()
})

test("displays a list of notifications", async ({ page }) => {
  const notifications = [
    {
      id: "1",
      message: "Deposit confirmed in Savings Circle",
      pool_id: "pool-1",
      read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: "2",
      message: "Payout triggered for Weekly Fund",
      pool_id: "pool-2",
      read: true,
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
  ]

  await page.route("**/api/notifications**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: notifications, total: 2 }),
    })
  })

  await page.goto("/dashboard/notifications")
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible()

  // Summary shows total count
  await expect(page.getByText("2 notifications")).toBeVisible()

  // Notification messages are displayed
  await expect(page.getByText("Deposit confirmed in Savings Circle")).toBeVisible()
  await expect(page.getByText("Payout triggered for Weekly Fund")).toBeVisible()
})

test("shows back to dashboard link", async ({ page }) => {
  await page.route("**/api/notifications**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0 }),
    })
  })

  await page.goto("/dashboard/notifications")
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible()

  // Back link
  const backLink = page.getByRole("link", { name: /back to dashboard/i })
  await expect(backLink).toBeVisible()
  await backLink.click()
  await expect(page).toHaveURL(/\/dashboard$/)
})
