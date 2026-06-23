import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E config for JointSave.
 *
 * The suite runs against a local Next.js server started with NEXT_PUBLIC_E2E=true,
 * which activates the test-gated seam in web3-provider.tsx and useJointSaveContracts.ts.
 * Combined with `page.route()` mocks of /api/pools, this makes every flow fully
 * deterministic — no live Soroban network, wallet extension, or Supabase needed.
 *
 * See e2e/README.md for the rationale and how to run locally.
 */

const isCI = !!process.env.CI

// Public testnet config (same values as .env.example) plus the E2E flag.
// Supabase is never actually called — `page.route` intercepts /api/pools in the
// browser before requests reach the Next API route — so a placeholder URL is fine.
const E2E_ENV = {
  NEXT_PUBLIC_E2E: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://e2e-placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-placeholder-anon-key",
  NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  NEXT_PUBLIC_FACTORY_CONTRACT_ID:
    "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI",
  NEXT_PUBLIC_TOKEN_CONTRACT_ID: "native",
  NEXT_PUBLIC_ROTATIONAL_WASM_HASH:
    "d350a325d8734263a3d7150c875555d8956e13a527fb3497d5141b8b3f3d2c74",
  NEXT_PUBLIC_TARGET_WASM_HASH:
    "133a62226501fc5443e70007d79deeeb0b33fdf8c85c7fcd3cf16293bb5c7292",
  NEXT_PUBLIC_FLEXIBLE_WASM_HASH:
    "df6ff088fd79f13d8d03e72160434517fdb4a83b8c7bfdd887be4369805e0d6b",
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  // Flaky-test policy: retry twice in CI (documented in e2e/README.md) rather
  // than silently ignoring intermittent failures; zero retries locally so flakes
  // surface immediately during development.
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Dev locally for fast iteration; build+start in CI for stability/speed.
    command: isCI ? "pnpm build && pnpm start" : "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !isCI,
    timeout: 180_000,
    env: E2E_ENV,
  },
})
