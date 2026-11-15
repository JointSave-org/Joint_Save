# Mainnet Deployment Readiness, Verification & Rollback Runbook

This guide defines the end-to-end procedure, multi-party custody controls, artifact hash verification, rollback rehearsal, and incident response runbook for deploying **JointSave** Soroban smart contracts to Stellar Mainnet.

---

## 1. Mainnet Configuration & Tamper-Evident Manifest

Mainnet configuration is isolated from Testnet in `smartcontract/mainnet.manifest.json`:

- **Network Passphrase**: `Public Global Stellar Network ; September 2015`
- **RPC Endpoint**: `https://mainnet.sorobanrpc.com`
- **Pinned Toolchain**: Rust `1.85.0` (`wasm32-unknown-unknown`) and `stellar-cli 22.8.1`
- **Covered Contracts**: `factory`, `rotational`, `target`, `flexible`, `governance`, `reputation`

---

## 2. Preflight Go/No-Go Checklist

Before initiating `.github/workflows/deploy-mainnet.yml`, the release lead must verify all preflight gates:

- [ ] **Automated Preflight Check**: `node scripts/mainnet-verify.mjs --preflight` passes with zero errors.
- [ ] **Contract Unit & Property Fuzz Suite**: All 6 Soroban contracts pass unit tests and `proptest` fuzzing in `.github/workflows/test.yml`.
- [ ] **Supply-Chain & Secret Gate**: `.github/workflows/supply-chain.yml` passes and CycloneDX SBOM is archived.
- [ ] **Admin Custody (3-of-5 Multisig)**: Production admin account is configured with 5 hardware-backed signers and a `3-of-5` medium/high threshold (with `2-of-5` emergency pause threshold).
- [ ] **Treasury & Token Addresses**: Mainnet USDC (`CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`) and protocol treasury address are verified by at least two signers independently.
- [ ] **TTL Policy**: Minimum instance/persistent TTL threshold (`535,680` ledgers, ~30 days) and auto-extension target (`1,071,360`–`2,142,720` ledgers) are active.

---

## 3. Reproducible Build & Code Hash Verification

1. Build all contract WASMs reproducibly using the pinned Rust `1.85.0` toolchain:
   ```bash
   cd smartcontract
   cargo build --target wasm32-unknown-unknown --release
   ```
2. Record the SHA-256 digest of each compiled `.wasm` binary into `smartcontract/mainnet.manifest.json` (`expectedSha256`) alongside the git commit SHA.
3. After deployment, query the on-chain contract WASM hash via `stellar contract info` and verify it matches `expectedSha256` byte-for-byte via `scripts/mainnet-verify.mjs`.

---

## 4. Human Approval Gate (`mainnet-production`)

No mainnet write can execute without passing the **`mainnet-production` GitHub Environment** protection gate in `.github/workflows/deploy-mainnet.yml`:
1. Trigger `Deploy Soroban Contracts (Mainnet Readiness & Verification)` first with `dry_run: true`.
2. Require review and sign-off from at least **2 designated protocol guardians** in the GitHub Environment gate.
3. Execute post-deploy smoke checks (`node scripts/mainnet-verify.mjs --post-deploy`).

---

## 5. Rollback & Upgrade Plan (Rehearsed on Testnet)

If a post-deploy check or live invariant fails:

1. **Immediate Containment (< 5 Minutes)**:
   - Execute `pause` on affected pool/factory contracts using the `2-of-5` emergency guardian threshold.
2. **Rollback / Wasm Upgrade (< 30 Minutes)**:
   - Submit a `3-of-5` multisig transaction invoking `update_current_contract_wasm` (or pointing `factory` to the previous verified `expectedSha256` WASM hash recorded in `mainnet.manifest.json`).
   - Re-run `node scripts/mainnet-verify.mjs --post-deploy` to confirm state and read views match pre-upgrade snapshots.
3. **Testnet Rehearsal Requirement**:
   - Every contract upgrade must first execute the full deploy -> verify -> pause -> rollback cycle on Testnet and attach the transaction hashes to the `approver_ticket`.

---

## 6. Incident Contacts & On-Call Routing

- **Primary On-Call Channel**: `#protocol-incidents` (PagerDuty / Slack bridge)
- **Security Escalation**: `SECURITY.md` & `docs/INCIDENT_RESPONSE.md`
- **Severity 1 SLA**: Acknowledge within **15 minutes**; emergency pause decision within **30 minutes**.
