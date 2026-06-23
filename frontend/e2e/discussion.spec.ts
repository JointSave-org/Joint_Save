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

test.describe("Pool Discussion / Chat", () => {
  const POOL_ID = "chat-pool-id"

  test.beforeEach(async ({ page }) => {
    // 1. Connect wallet
    await connectWallet(page)

    // 2. Seed chain state so we are a member
    await seedChainState(page, {
      isActive: true,
      admin: E2E_ADDRESS,
      members: [E2E_ADDRESS],
    })

    // 3. Mock the pools API, showing us as a member in the DB
    await mockPoolsApi(page, [
      makePool({
        id: POOL_ID,
        name: "Chat Test Pool",
        type: "rotational",
        contract_address: E2E_CONTRACT_ID,
        pool_members: [
          {
            id: "pm-1",
            member_address: E2E_ADDRESS,
            contribution_amount: 100,
            status: "paid",
            joined_at: new Date().toISOString(),
          },
        ],
      }),
    ])
  })

  test("can load, view and send messages, and enforces rate limit", async ({ page }) => {
    const messages = [
      {
        id: "msg-1",
        pool_id: POOL_ID,
        sender_address: E2E_ADDRESS,
        message: "Hello world!",
        created_at: new Date(Date.now() - 60000).toISOString(),
      },
    ]

    // Mock the Supabase REST GET for pool_messages
    await page.route("**/rest/v1/pool_messages?**", async (route) => {
      const method = route.request().method()
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(messages),
        })
      } else {
        await route.continue()
      }
    })

    // Mock the Supabase REST POST for inserting a message
    await page.route("**/rest/v1/pool_messages", async (route) => {
      const method = route.request().method()
      if (method === "POST") {
        const body = route.request().postDataJSON()
        const newMsg = {
          id: `msg-${Date.now()}`,
          pool_id: POOL_ID,
          sender_address: E2E_ADDRESS,
          message: body[0].message,
          created_at: new Date().toISOString(),
        }
        messages.push(newMsg)
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify([newMsg]),
        })
      } else {
        await route.continue()
      }
    })

    // Navigate to the pool details page
    await page.goto(`/dashboard/group/${POOL_ID}`)

    // Click the Discussion tab
    await page.click("role=tab[name='Discussion']")

    // Check that existing message is visible
    await expect(page.locator("text=Hello world!")).toBeVisible()

    // Type a new message
    await page.fill("textarea[placeholder='Type a message...']", "This is an E2E test message!")

    // Click send
    await page.click("button:has(svg)")

    // Verify it is visible in the chat feed
    await expect(page.locator("text=This is an E2E test message!")).toBeVisible()

    // Verify rate limit: textarea should have wait text or be disabled, showing warning label
    await expect(page.locator("text=Rate limited: 3s remaining")).toBeVisible()
    await expect(page.locator("textarea")).toBeDisabled()
  })

  test("restricted access shows restriction alert if user is not in pool", async ({ page }) => {
    // Intercept with an error to simulate RLS access denied
    await page.route("**/rest/v1/pool_messages?**", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "permission denied" }),
      })
    })

    await page.goto(`/dashboard/group/${POOL_ID}`)
    await page.click("role=tab[name='Discussion']")

    // Should show the restricted access card/alert
    await expect(page.locator("text=Access Restricted")).toBeVisible()
  })
})
