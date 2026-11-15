# Full-Stack Testnet Smoke Suite

This guide documents the opt-in end-to-end Testnet smoke suite (`scripts/testnet-smoke-suite.mjs` and `.github/workflows/testnet-smoke.yml`) that exercises **JointSave** money flows across the Soroban contracts, TypeScript SDK, API read models, indexer, and UI state indicators.

---

## 1. Covered Protocol Flows

The smoke suite executes and verifies 6 critical end-to-end flows:

1. **Rotational Pool (`rotational_pool_lifecycle`)**: Create pool -> member join -> deposit contribution -> trigger scheduled payout -> verify SDK state, API read model, and indexer event convergence.
2. **Target Pool (`target_pool_refund_flow`)**: Create target pool -> contribute -> execute refund -> assert zeroed balance and ledger transaction hash.
3. **Flexible Pool (`flexible_pool_withdraw_flow`)**: Create flexible pool -> deposit -> flexible withdraw -> assert share accounting and ledger effects.
4. **Governance (`governance_proposal_and_vote`)**: Create proposal -> cast member vote -> query proposal -> assert quorum tally consistency.
5. **Reputation Tracker (`reputation_score_and_leaderboard`)**: Record on-time payment -> query member score -> verify leaderboard ordering.
6. **Microloan (`microloan_request_and_repay`)**: Request loan -> repay principal and interest -> verify loan settled status.

---

## 2. Opt-In Design (Non-Blocking for PR CI)

To keep pull request CI fast and deterministic:
- Normal PR runs do **not** trigger live Testnet transactions.
- Running `node scripts/testnet-smoke-suite.mjs` without `RUN_TESTNET_SMOKE=true` exits cleanly as a no-op.
- `.github/workflows/testnet-smoke.yml` runs nightly at `02:30 UTC` or on demand via `workflow_dispatch`.

---

## 3. Environment Variables & Secrets

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RUN_TESTNET_SMOKE` | Must be set to `"true"` to enable live smoke execution | `"false"` |
| `TESTNET_SOROBAN_RPC_URL` | Soroban Testnet RPC endpoint | `https://soroban-testnet.stellar.org` |
| `TESTNET_DEPLOYER_SECRET` | Optional funded Testnet secret key (Friendbot used if omitted) | Ephemeral keypair |
| `TESTNET_API_BASE_URL` | Optional deployed staging/local API URL | `http://localhost:3000` |

---

## 4. Local Invocation & Verification

Run the built-in self-test (verifies all 6 flow assertions, idempotent cleanup, and failure artifact generation):
```bash
node scripts/testnet-smoke-suite.mjs --self-test
```

Execute a full smoke run and write manifests to `.smoke-artifacts/`:
```bash
RUN_TESTNET_SMOKE=true node scripts/testnet-smoke-suite.mjs --artifacts-dir .smoke-artifacts
```

---

## 5. Failure Artifacts & Idempotent Cleanup

- Every smoke execution generates a unique `runId` namespace (`smoke-<timestamp>-<nonce>`) so concurrent or repeated runs never collide.
- On completion or failure, a structured JSON manifest (`smoke-run-manifest.json` or `smoke-failure-manifest.json`) containing per-step transaction hashes, timestamps, and error diagnostics is written to `--artifacts-dir` and uploaded to GitHub Actions artifacts (`testnet-smoke-artifacts`).
