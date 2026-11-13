#!/usr/bin/env bash
# JointSave – Deployment Verification Script
# Verifies that every recorded contract and template WASM hash in stellar-testnet.json exists on-chain
# and matches its ledger entry code hash.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MANIFEST="${1:-${ROOT_DIR}/smartcontract/deployments/stellar-testnet.json}"
NETWORK="testnet"

if [ ! -f "$MANIFEST" ]; then
  echo "❌ Error: Manifest file not found at $MANIFEST"
  exit 1
fi

echo "================================================================="
echo "🔍 JointSave Testnet Deployment Verification"
echo "Manifest: $MANIFEST"
echo "Network:  $NETWORK"
echo "================================================================="

FAILED=0
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

verify_contract() {
  local name="$1"
  local contract_id="$2"
  local expected_hash="${3:-}"

  echo -n "Checking $name ($contract_id)... "
  local tmp_wasm="${TMP_DIR}/${name}.wasm"
  
  if ! stellar contract fetch --id "$contract_id" --network "$NETWORK" -o "$tmp_wasm" >/dev/null 2>&1; then
    echo "❌ FAILED (Contract not found on ledger)"
    FAILED=$((FAILED + 1))
    return
  fi

  local fetched_hash
  fetched_hash=$(sha256sum "$tmp_wasm" | awk '{print $1}')

  if [ -n "$expected_hash" ] && [ "$expected_hash" != "$fetched_hash" ]; then
    echo "❌ HASH MISMATCH"
    echo "   Expected: $expected_hash"
    echo "   On-chain: $fetched_hash"
    FAILED=$((FAILED + 1))
    return
  fi

  echo "✅ VERIFIED (hash: ${fetched_hash:0:16}...)"
}

verify_wasm_hash() {
  local name="$1"
  local expected_hash="$2"

  echo -n "Checking Template $name ($expected_hash)... "
  local tmp_wasm="${TMP_DIR}/${name}.wasm"

  if ! stellar contract fetch --wasm-hash "$expected_hash" --network "$NETWORK" -o "$tmp_wasm" >/dev/null 2>&1; then
    echo "❌ FAILED (WASM hash not found on ledger)"
    FAILED=$((FAILED + 1))
    return
  fi

  local fetched_hash
  fetched_hash=$(sha256sum "$tmp_wasm" | awk '{print $1}')

  if [ "$expected_hash" != "$fetched_hash" ]; then
    echo "❌ HASH MISMATCH"
    echo "   Expected: $expected_hash"
    echo "   On-chain: $fetched_hash"
    FAILED=$((FAILED + 1))
    return
  fi

  echo "✅ VERIFIED"
}

# 1. Verify Instantiated Deployed Contracts
FACTORY_ID=$(jq -r '.contracts.JointSaveFactory.contractId // .contracts.JointSaveFactory' "$MANIFEST")
FACTORY_HASH=$(jq -r '.contracts.JointSaveFactory.wasmHash // empty' "$MANIFEST")
verify_contract "JointSaveFactory" "$FACTORY_ID" "$FACTORY_HASH"

REPUTATION_ID=$(jq -r '.contracts.ReputationTracker.contractId // .contracts.ReputationContractId' "$MANIFEST")
REPUTATION_HASH=$(jq -r '.contracts.ReputationTracker.wasmHash // empty' "$MANIFEST")
verify_contract "ReputationTracker" "$REPUTATION_ID" "$REPUTATION_HASH"

GOVERNANCE_ID=$(jq -r '.contracts.Governance.contractId // .contracts.GovernanceContractId' "$MANIFEST")
GOVERNANCE_HASH=$(jq -r '.contracts.Governance.wasmHash // empty' "$MANIFEST")
verify_contract "Governance" "$GOVERNANCE_ID" "$GOVERNANCE_HASH"

MICROLOAN_ID=$(jq -r '.contracts.Microloan.contractId // .contracts.MicroloanContractId' "$MANIFEST")
MICROLOAN_HASH=$(jq -r '.contracts.Microloan.wasmHash // empty' "$MANIFEST")
verify_contract "Microloan" "$MICROLOAN_ID" "$MICROLOAN_HASH"

YIELD_VAULT_ID=$(jq -r '.contracts.YieldVault.contractId // .contracts.YieldVaultContractId' "$MANIFEST")
YIELD_VAULT_HASH=$(jq -r '.contracts.YieldVault.wasmHash // empty' "$MANIFEST")
verify_contract "YieldVault" "$YIELD_VAULT_ID" "$YIELD_VAULT_HASH"

YIELD_STRATEGY_ID=$(jq -r '.contracts.YieldStrategy.contractId // .contracts.YieldStrategyContractId' "$MANIFEST")
YIELD_STRATEGY_HASH=$(jq -r '.contracts.YieldStrategy.wasmHash // empty' "$MANIFEST")
verify_contract "YieldStrategy" "$YIELD_STRATEGY_ID" "$YIELD_STRATEGY_HASH"

# 2. Verify Template WASM Uploads
ROTATIONAL_HASH=$(jq -r '.contracts.RotationalWasmHash' "$MANIFEST")
verify_wasm_hash "Rotational" "$ROTATIONAL_HASH"

TARGET_HASH=$(jq -r '.contracts.TargetWasmHash' "$MANIFEST")
verify_wasm_hash "Target" "$TARGET_HASH"

FLEXIBLE_HASH=$(jq -r '.contracts.FlexibleWasmHash' "$MANIFEST")
verify_wasm_hash "Flexible" "$FLEXIBLE_HASH"

echo "================================================================="
if [ $FAILED -eq 0 ]; then
  echo "🎉 SUCCESS: All 9 supported contracts verified on Stellar testnet!"
  exit 0
else
  echo "❌ FAILURE: $FAILED contract(s) failed on-chain verification."
  exit 1
fi
