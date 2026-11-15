# `@jointsave/sdk` Pre-Release Checklist & Versioning Policy

This document defines the release readiness requirements, semantic versioning policy, and step-by-step verification process for publishing `@jointsave/sdk`.

---

## 1. Semantic Versioning Expectations

`@jointsave/sdk` follows [Semantic Versioning 2.0.0](https://semver.org/):

- **Patch (`0.1.x`)**: Backward-compatible bug fixes, diagnostic refinements, or internal optimizations that do not alter the public TypeScript declaration surface (`dist/index.d.ts`).
- **Minor (`0.x.0`)**: Backward-compatible additions of new read/write methods, contract clients, or utility helpers.
- **Major (`x.0.0`)**: Breaking changes to method signatures, return types, error codes, or removal of exported symbols.

---

## 2. Automated Release Gates

Every release candidate must pass all automated gates enforced by `.github/workflows/sdk.yml` and `.github/workflows/sdk-release.yml`:

1. **Typecheck**: `pnpm --dir sdk typecheck` (`tsc --noEmit`) passes with zero errors.
2. **Build**: `pnpm --dir sdk build` emits clean JavaScript and `.d.ts` declarations into `sdk/dist/`.
3. **Examples Verification**: `pnpm --dir sdk typecheck:examples` compiles all consumer examples in `sdk/examples/` against the built `dist/` declarations.
4. **Unit & Contract Suite**: `pnpm --dir sdk test` runs the Vitest suite across ScVal encoders, contract clients, diagnostics, recovery, gating, and data clients.
5. **Public API Guard**: `pnpm --dir sdk check:api` verifies that no internal denylisted symbols leak into `dist/index.d.ts`.
6. **Pack & Clean Consumer Smoke Test**: `pnpm --dir sdk test:pack` runs `npm pack`, verifies the tarball file whitelist (`dist/`, `README.md`, `CHANGELOG.md`, `package.json`), extracts the tarball into an isolated temporary consumer directory, and imports the package entry point.

---

## 3. Pre-Release Checklist

Before tagging a new `sdk-vX.Y.Z` release:

- [ ] Confirm root `LICENSE` (MIT) and `sdk/package.json` metadata (`repository`, `homepage`, `bugs`, `license`, `publishConfig`, `exports`, `files`) are accurate.
- [ ] Update `sdk/package.json` `"version"` and `sdk/src/version.ts` (`SDK_VERSION`) to match the target version.
- [ ] Document all notable additions, fixes, and breaking changes under a dated heading in `sdk/CHANGELOG.md`.
- [ ] Verify install instructions in `sdk/README.md` and `docs/sdk.md` match `@jointsave/sdk`.
- [ ] Run the full local gate sequence from `sdk/`:
  ```bash
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm build
  pnpm typecheck:examples
  pnpm test
  pnpm check:api
  pnpm test:pack
  ```
- [ ] Trigger `.github/workflows/sdk-release.yml` via `workflow_dispatch` with `dry_run: true` and inspect the workflow logs.
- [ ] Push annotated git tag `sdk-vX.Y.Z` to trigger provenance-attested publication (`npm publish --provenance --access public`).
