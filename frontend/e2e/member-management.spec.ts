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
} from "./fixtures/test-base"

/**
 * member-management.spec — admin adds and removes members from a pool.
 * Non-admin users see a "Leave Pool" button instead of member management.
 */

const POOL_ID = "member-pool"

/**
 * Checksum-valid address (passes StrKey.isValidEd25519PublicKey). The add-member
 * handler encodes the input with nativeToScVal({type:"address"}), which throws
 * on malformed strkeys — so this input must be a real, decodable address.
 */
const NEW_MEMBER = "GADUCKBBLGEFTAGKVQRK4FYPX4MLE7XL5TZQQI4E7BATRROUE2L2UVDJ"

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
  await mockCommonApis(page)

  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(`/dashboard/group/${POOL_ID}`, { waitUntil: "networkidle" })
  await poolsResponse
  await expect(page.getByRole("heading", { name: /Member Pool/i })).toBeVisible()

  // Admin sees "Manage Members" section
  await expect(page.getByText("Manage Members")).toBeVisible()

  // Fill in a new member address
  await page.locator("#new-member").fill(NEW_MEMBER)

  // Click the add member button (UserPlus icon button with aria-label)
  await page.getByRole("button", { name: "Add member" }).click()

  // Toast confirms
  await expect(page.getByText(/member added/i).first()).toBeVisible({ timeout: 10000 })
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
  await mockCommonApis(page)

  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(`/dashboard/group/${POOL_ID}`, { waitUntil: "networkidle" })
  await poolsResponse
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

  // Toast confirms — use .text-sm.opacity-90 to target description, avoid strict mode
  await expect(page.locator(".text-sm.opacity-90").getByText(/member removed/i)).toBeVisible({
    timeout: 10000,
  })
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
  await mockCommonApis(page)

  const poolsResponse = waitForPoolsResponse(page)
  await page.goto(`/dashboard/group/${POOL_ID}`, { waitUntil: "networkidle" })
  await poolsResponse
  await expect(page.getByRole("heading", { name: /Member Pool/i })).toBeVisible()

  // Non-admin sees Leave Pool button (text matches both heading and button, use .first())
  await expect(page.getByText("Leave Pool").first()).toBeVisible()
  const leaveBtn = page.getByRole("button", { name: "Leave Pool" })
  await expect(leaveBtn).toBeVisible()

  // Non-admin does NOT see "Manage Members" section
  await expect(page.getByText("Manage Members")).toBeHidden()
})
