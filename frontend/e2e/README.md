# E2E tests (Playwright)

End-to-end coverage for JointSave's critical user flows, built with
[Playwright](https://playwright.dev/).

## What's covered

| Spec                        | Flow                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-pool.spec.ts`       | Create each pool type (rotational / target / flexible) → redirect to the group page → read on-chain state back → pool appears in **My Groups** |
| `deposit-flow.spec.ts`      | Open a pool, deposit, see the submitted/confirming state, the updated balance, and a Deposit row in the activity feed                          |
| `payout-flow.spec.ts`       | Rotational payout trigger → preview dialog with fee breakdown → confirm & sign → toast                                                        |
| `withdraw-flow.spec.ts`     | Flexible pool withdraw with fee preview dialog; target pool direct withdraw; paused-pool button disabled                                      |
| `member-management.spec.ts` | Admin adds a member, removes a member via confirmation dialog, non-admin sees "Leave Pool" instead                                           |
| `pause-unpause.spec.ts`     | Admin pauses/unpauses a pool with toast confirmation; non-admin sees disabled buttons and admin-only notice                                   |
| `pool-join.spec.ts`         | Visit /join/[contractId] → pool preview, request to join, already-a-member state, invalid contract 404                                       |
| `notifications.spec.ts`     | Notifications page empty state, list of notifications, back-to-dashboard link                                                                  |
| `explore-filters.spec.ts`   | Explore page search-by-name, type filter, status filter, empty state, pool card buttons                                                         |
| `pool-comparison.spec.ts`   | Select pools on explore → floating compare bar → comparison page via URL → clear selection                                                    |
| `dashboard-tabs.spec.ts`    | Switch between all 7 dashboard tabs (groups, portfolio, explore, create, transactions, analytics, profile)                                    |
| `wallet-connection.spec.ts` | Connect wallet → truncated address renders → disconnect → back to the landing page                                                             |
| `navigation.spec.ts`        | Landing → dashboard → group detail → back, asserting no console errors                                                                         |
| `responsive.spec.ts`        | Dashboard & group pages render with no horizontal overflow at 375 / 768 / 1440 px                                                              |

## How it works — mocked boundary + a test-gated seam

Automating a real wallet popup is impossible, and CI has neither a Stellar wallet
extension nor a Supabase project. Rather than stand up a live chain (which would be
slow and flaky and still couldn't sign), the suite mocks the **edges** and runs
everything else for real:

- **Wallet & RPC** — the app reads `NEXT_PUBLIC_E2E=true` and activates a small,
  test-only seam in [`components/web3-provider.tsx`](../components/web3-provider.tsx)
  (a stub signer that auto-connects) and
  [`hooks/useJointSaveContracts.ts`](../hooks/useJointSaveContracts.ts) (stubbed
  `deploy`/`submitTx`/view-calls). These branches are **dead code** in production
  builds (the flag is unset).
- **Database** — `page.route()` intercepts every `/api/pools` request in the
  browser and serves it from an in-memory store, so the real Next API route and
  Supabase never run.
- **On-chain state** — tests inject `window.__E2E_STATE__` (balances, members,
  paused, etc.) which the read seam returns, making every screen deterministic.

The result: the full UI/logic — forms, validation, optimistic updates, balance
math, routing, responsiveness — is exercised for real, while only the
un-automatable network/wallet edges are stubbed. Runs in well under a minute with
no secrets and no flakiness.

Fixtures live in [`fixtures/`](./fixtures): `wallet.ts` (seed connection +
chain state), `mock-pools.ts` (the `/api/pools` mock), `constants.ts` (shared
ids/addresses, kept in sync with the seam), and `test-base.ts` (extends `test`
with a console-error collector).

## Running locally

```bash
cd frontend
pnpm install
pnpm exec playwright install chromium   # one-time browser download
pnpm test:e2e                           # headless run
pnpm test:e2e:ui                        # interactive UI mode
pnpm test:e2e:report                    # open the last HTML report
```

Playwright starts the dev server itself (with the E2E env baked into
`playwright.config.ts`) — you don't need a server running first.

## Flaky-test policy

Tests are designed to be deterministic (mocked boundary, no real network). To
guard against occasional CI hiccups (cold compiles, hydration timing), the config
in [`playwright.config.ts`](../playwright.config.ts) sets `retries: 2` **in CI
only** (`retries: 0` locally, so flakes surface immediately during development).
Any genuinely flaky test should be fixed or documented here — never silently
`test.skip`-ped.

One known timing nuance is handled explicitly: the wallet kit is wired in a mount
effect, so `wallet-connection.spec.ts` retries the initial connect click via
`expect(...).toPass()` until the address appears, rather than relying on a fixed
wait.
