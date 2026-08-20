import {
  test,
  expect,
  connectWallet,
  seedChainState,
  mockPoolsApi,
  makePool,
  waitForPoolsResponse,
  E2E_CONTRACT_ID,
  E2E_ADDRESS,
  E2E_MEMBER_2,
} from "./fixtures/test-base"

/**
 * pool-join.spec — visit /join/[contractId] and verify the pool preview,
 * connect wallet flow, and request-to-join submission.
 */

const POOL_ID = "join-pool"

test.beforeEach(async ({ page }) => {
  await connectWallet(page)
  await seedChainState(page, {
    isActive: true,
    members: [E2E_ADDRESS, E2E_MEMBER_2],
  })
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Join Test Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
      contribution_amount: 100,
      frequency: "weekly",
      members_count: 3,
    }),
  ])

  await page.route("**/api/join-requests**", async (route) => {
    const req = route.request()
    if (req.method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  })
})

test("shows pool preview and request to join", async ({ page }) => {
  await page.goto(`/join/${E2E_CONTRACT_ID}`)
  await waitForPoolsResponse(page)

  await expect(page.getByRole("heading", { name: /Join Test Pool/ })).toBeVisible()

  await expect(page.getByText("Rotational Pool")).toBeVisible()
  await expect(page.getByText("3")).toBeVisible()
  await expect(page.getByText("Deposit Requirement")).toBeVisible()
  await expect(page.getByText("Creator Address")).toBeVisible()

  const joinBtn = page.getByRole("button", { name: "Request to Join" })
  await expect(joinBtn).toBeVisible()

  await joinBtn.click()

  await expect(page.locator(".text-sm.opacity-90").getByText(/request sent/i)).toBeVisible()
  await expect(page.getByRole("button", { name: /request pending/i })).toBeVisible()
})

test("shows pool not found for invalid contract", async ({ page }) => {
  await page.goto("/join/INVALIDCONTRACT123")
  // No waitForPoolsResponse here — the mock returns 404, not 200
  await expect(page.getByRole("heading", { name: /Pool Not Found/ })).toBeVisible()
  await expect(page.getByText("Explore Pools")).toBeVisible()
})

test("member already in pool sees go to pool details", async ({ page }) => {
  await mockPoolsApi(page, [
    makePool({
      id: POOL_ID,
      name: "Join Test Pool",
      type: "rotational",
      contract_address: E2E_CONTRACT_ID,
      pool_members: [
        { member_address: E2E_ADDRESS, contribution_amount: 100, status: "paid", joined_at: "" },
        {
          member_address: E2E_MEMBER_2,
          contribution_amount: 100,
          status: "paid",
          joined_at: "",
        },
      ],
    }),
  ])

  await page.goto(`/join/${E2E_CONTRACT_ID}`)
  await waitForPoolsResponse(page)

  await expect(page.getByRole("heading", { name: /Join Test Pool/ })).toBeVisible()
  await expect(page.getByText("You are already a member of this pool")).toBeVisible()
  await expect(page.getByRole("link", { name: /go to pool details/i })).toBeVisible()
})
