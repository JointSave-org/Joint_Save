# Changelog

All notable changes to `@jointsave/sdk` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with the `0.x` policy described below.

## [Unreleased]

## [0.1.0] - 2026-11-05

### Added

- Standalone TypeScript package with CommonJS output, declarations, Vitest,
  and a public-API guard.
- Network config for testnet/mainnet, contract-id resolution, protocol
  constants, and typed domain models.
- BigInt-safe amount conversion/formatting, zero-subscript display, Stellar
  address validation, and ledger/time helpers.
- ScVal encoders, `JointSaveClient` facade, and clients for factory, pools,
  governance, reputation, and yield vaults.
- Deterministic action-eligibility gating with stable reason codes.
- Contract-error diagnostics, redacted transaction logging, simulation
  summaries, retry classification, and transaction-hash recovery.
- `DataClient` for paginated HTTP read models and a versioned OpenAPI 3.1
  contract in `docs/api/`.
- Runnable examples, integration guide, and API documentation.

## Versioning policy

- Releases follow semver: `MAJOR.MINOR.PATCH`.
- **Before `1.0`:** breaking changes may land in a **minor** release
  (`0.x.0`). Additive changes are minor; fixes are patch releases.
- **From `1.0`:** breaking changes require a major release; additive changes
  are minor; fixes are patch releases.
- The public surface is exactly what `src/index.ts` exports. Deep imports
  (`@jointsave/sdk/dist/...`) are unsupported.
- `pnpm check:api` runs in CI and fails when an internal symbol leaks from the
  root barrel.

## Deprecation policy

- Deprecated APIs are marked `@deprecated` in TSDoc and listed in this file.
- A deprecated API remains available for at least one minor release before
  removal. After `1.0`, removal happens only in a major release.
- Deprecation entries state the replacement and the earliest removal version.
