import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
  waitForPoolsResponse,
  E2E_ADDRESS,
  E2E_MEMBER_2,
  E2E_CONTRACT_ID,
} from "./fixtures/test-base"

/**
 * member-management.spec — admin adds and removes members from a pool.
 * Non-admin users see a "Leave Pool" button instead of member management.
 */

const POOL_ID = "member-pool"

async function mockGroupApis(page: import("@playwright/test").Page) {
  await page.route("**/api/admin/audit-log**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0 }),
    })
  )
  await page.route("**/api/admin/actions**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0 }),
    })
  )
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  )
}

test("admin can add a member", async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Member Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])
  await mockGroupApis(page)

  await page.goto(`/dashboard/group/${POOL_ID}`)
  await waitForPoolsResponse(page)
  await expect(page.getByRole("heading", { name: /Member Pool/ })).toBeVisible()

  // Admin sees "Manage Members" section
  await expect(page.getByText("Manage Members")).toBeVisible()

  // Fill in a new member address
  await page.locator("#new-member").fill("GDXOINK23J7YV2E3ZHKWKW6CWYD2OYBWYO7GWAJ3H5XQ6SJBXMZ6IYJH")

  // Click the add member button (UserPlus icon button with aria-label)
  await page.getByRole("button", { name: "Add member" }).click()

  // Toast confirms
  await expect(page.locator(".text-sm.opacity-90").getByText(/member added/i)).toBeVisible()
})

test("admin can remove a member", async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    admin: E2E_ADDRESS,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Member Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])
  await mockGroupApis(page)

  await page.goto(`/dashboard/group/${POOL_ID}`)
  await waitForPoolsResponse(page)
  await expect(page.getByText("Manage Members")).toBeVisible()

  // Find the remove button for the second member
  const removeBtn = page.getByRole("button", { name: `Remove ${E2E_MEMBER_2}` })
  await expect(removeBtn).toBeVisible()
  await removeBtn.click()

  // Confirmation dialog opens
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Remove Member" })).toBeVisible()

  // Confirm removal
  await dialog.getByRole("button", { name: "Remove" }).click()

  // Toast confirms
  await expect(page.locator(".text-sm.opacity-90").getByText(/member removed/i)).toBeVisible()
})

test("non-admin sees leave pool button", async ({ page }) => {
  await connectWallet(page)
  // Set admin to a different address so the connected wallet (E2E_ADDRESS) is NOT admin
  await seedChainState(page, {
    isActive: true,
    admin: E2E_MEMBER_2,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Member Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
    }),
  ])
  await mockGroupApis(page)

  await page.goto(`/dashboard/group/${POOL_ID}`)
  await waitForPoolsResponse(page)
  await expect(page.getByRole("heading", { name: /Member Pool/ })).toBeVisible()

  // Non-admin sees Leave Pool section
  await expect(page.getByText("Leave Pool")).toBeVisible()
  const leaveBtn = page.getByRole("button", { name: "Leave Pool" })
  await expect(leaveBtn).toBeVisible()

  // Non-admin does NOT see "Manage Members" section
  await expect(page.getByText("Manage Members")).toBeHidden()
})
