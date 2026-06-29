import { test, expect, truncate, E2E_ADDRESS } from "./fixtures/test-base"

/**
 * wallet-connection.spec — connect via the landing header (driven by the stub
 * kit), verify the truncated address renders, then disconnect and verify we land
 * back on the marketing site with the Connect button restored.
 *
 * Note: we intentionally do NOT pre-seed the wallet here — this spec drives the
 * real connect→disconnect cycle through the UI.
 */

test("connects, shows the truncated address, then disconnects", async ({ page }) => {
  await page.goto("/")

  // The marketing page has multiple "Connect Wallet" CTAs — drive the one in
  // the header (banner) to keep the assertion unambiguous.
  const header = page.getByRole("banner")
  const connectBtn = header.getByRole("button", { name: "Connect Wallet" })
  await expect(connectBtn).toBeVisible()

  // Connect (stub kit auto-selects Freighter and returns the test address).
  // The kit is wired in a mount effect, so a very fast first click can land
  // before `connect` is ready — retry until the address appears (idiomatic and
  // race-free; the isVisible guard prevents re-clicking once connected).
  const truncated = truncate(E2E_ADDRESS)
  const addressLabel = header.getByText(truncated).first()
  await expect(async () => {
    if (await connectBtn.isVisible().catch(() => false)) {
      await connectBtn.click().catch(() => {})
    }
    await expect(addressLabel).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15_000 })

  // Open the account dropdown and disconnect
  await header.getByRole("button", { name: new RegExp(truncated) }).click()
  await page.getByRole("menuitem", { name: /disconnect/i }).click()

  // Back on the landing page with the Connect button restored
  await expect(page).toHaveURL(/\/$/)
  await expect(header.getByRole("button", { name: "Connect Wallet" })).toBeVisible()
})
