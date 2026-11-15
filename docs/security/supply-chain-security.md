# Supply-Chain & Dependency Security Policy

This document describes the automated supply-chain security gates, toolchain pinning standards, SBOM generation workflow, and vulnerability response runbook for **JointSave**.

---

## 1. Automated Dependency Updates (Dependabot)

`.github/dependabot.yml` automates weekly dependency updates across all four project ecosystems:

- **Frontend (`frontend/`, npm/pnpm)**: Grouped minor and patch updates every Monday; major updates opened as standalone PRs.
- **SDK (`sdk/`, npm/pnpm)**: Grouped minor and patch updates every Monday.
- **Soroban Smart Contracts (`smartcontract/`, Cargo)**: Grouped minor and patch updates for Rust crates every Monday.
- **GitHub Actions (`/`, github-actions)**: Weekly workflow action version checks.

---

## 2. Reproducible Toolchain Pinning Policy

To prevent unreviewed upstream drift across CI and deployment environments:

| Component | Pinned Version | Enforcement Location |
| :--- | :--- | :--- |
| **Rust Toolchain** | `1.85.0` (`wasm32-unknown-unknown`) | `.github/workflows/test.yml`, `.github/workflows/deploy.yml` |
| **Stellar / Soroban CLI** | `stellar-cli 22.8.1` | Deployment & contract verification scripts |
| **Node.js Runtime** | `22.x` LTS | `.github/workflows/*.yml`, `sdk/package.json` (`engines`) |
| **Package Manager** | `pnpm 10.33.0` (`frontend`), `pnpm 9.15.9` (`sdk`) | `--frozen-lockfile` enforced in CI |

### Updating Pinned Toolchains
1. Open a dedicated pull request updating the version in workflow definitions and lockfiles.
2. Verify all contract WASM builds, fuzz suites, SDK API guards, and frontend tests pass before merging.

---

## 3. Secret Scanning Gate

Every push and pull request runs `scripts/check-secrets.mjs` (`.github/workflows/supply-chain.yml`), which scans tracked files for:
- PEM / OpenSSH private key blocks
- GitHub personal access and fine-grained tokens (`ghp_*`, `github_pat_*`)
- npm publish/automation tokens (`npm_*`)
- AWS access keys (`AKIA*`)

Local verification:
```bash
node scripts/check-secrets.mjs --self-test
node scripts/check-secrets.mjs
```

---

## 4. Software Bill of Materials (SBOM)

Every CI run generates a **CycloneDX 1.5 JSON SBOM** spanning `frontend/package.json`, `sdk/package.json`, and `smartcontract/Cargo.lock` via `scripts/generate-sbom.mjs` and uploads it as a build artifact (`jointsave-cyclonedx-sbom`).

Generate locally:
```bash
node scripts/generate-sbom.mjs --output sbom.cdx.json
```

---

## 5. Critical Vulnerability Advisory Response Runbook

When a `CRITICAL` or `HIGH` advisory is reported against an npm package or Cargo crate:

1. **Triage (< 4 Hours)**:
   - Determine whether the vulnerable code path is reachable in production (`frontend`, `@jointsave/sdk`, or compiled Soroban WASM contracts).
2. **Remediate (< 24 Hours for Critical, < 72 Hours for High)**:
   - Apply the patched version in `pnpm-lock.yaml` or `smartcontract/Cargo.lock` (`cargo update <crate> --precise <safe-version>`).
   - Re-run `node scripts/generate-sbom.mjs` and full CI test suites.
3. **Release & Notify**:
   - If `@jointsave/sdk` is affected, cut a patch release (`sdk-vX.Y.Z`) with provenance and note the security fix in `sdk/CHANGELOG.md`.
   - If a deployed Soroban contract is affected, follow the emergency pause and contract migration procedure in `docs/INCIDENT_RESPONSE.md`.
