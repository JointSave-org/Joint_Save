#!/usr/bin/env bash
# Example migration script: Rotational Pool v1 -> v2
#
# This script demonstrates the migration workflow for upgrading a
# JointSave Rotational Pool contract from version 1 to version 2.
#
# Prerequisites:
#   - Stellar CLI (soroban) installed
#   - Contract WASM uploaded for the new version
#   - Admin secret key configured
#
# Usage:
#   ./migrate_rotational_v1_to_v2.sh <CONTRACT_ID> <NEW_WASM_HASH> <ADMIN_SECRET>

set -euo pipefail

CONTRACT_ID="${1:?Usage: $0 <CONTRACT_ID> <NEW_WASM_HASH> <ADMIN_SECRET>}"
NEW_WASM_HASH="${2:?Usage: $0 <CONTRACT_ID> <NEW_WASM_HASH> <ADMIN_SECRET>}"
ADMIN_SECRET="${3:?Usage: $0 <CONTRACT_ID> <NEW_WASM_HASH> <ADMIN_SECRET>}"

NETWORK="--network testnet"
RPC_URL="https://soroban-testnet.stellar.org"

echo "=== JointSave Migration: Rotational Pool v1 -> v2 ==="
echo "Contract: ${CONTRACT_ID}"
echo "New WASM: ${NEW_WASM_HASH}"
echo ""

# Step 1: Verify current version
echo "Step 1: Checking current contract version..."
CURRENT_VERSION=$(soroban contract invoke \
    --id "${CONTRACT_ID}" \
    --fn get_version \
    --rpc-url "${RPC_URL}" \
    ${NETWORK} \
    2>/dev/null || echo "unknown")
echo "  Current version: ${CURRENT_VERSION}"

if [ "${CURRENT_VERSION}" != "1" ]; then
    echo "  ERROR: Expected version 1, got ${CURRENT_VERSION}"
    exit 1
fi

# Step 2: Upload new WASM
echo ""
echo "Step 2: Uploading new contract WASM..."
UPLOAD_RESULT=$(soroban contract upload \
    --wasm "target/wasm32-unknown-unknown/release/jointsave_rotational.wasm" \
    --secret-key "${ADMIN_SECRET}" \
    --rpc-url "${RPC_URL}" \
    ${NETWORK} 2>&1)
echo "  ${UPLOAD_RESULT}"

# Step 3: Upgrade the contract
echo ""
echo "Step 3: Upgrading contract to new WASM..."
soroban contract upgrade \
    --id "${CONTRACT_ID}" \
    --wasm-hash "${NEW_WASM_HASH}" \
    --secret-key "${ADMIN_SECRET}" \
    --rpc-url "${RPC_URL}" \
    ${NETWORK}
echo "  Contract upgraded successfully."

# Step 4: Verify new version
echo ""
echo "Step 4: Verifying new contract version..."
NEW_VERSION=$(soroban contract invoke \
    --id "${CONTRACT_ID}" \
    --fn get_version \
    --rpc-url "${RPC_URL}" \
    ${NETWORK} 2>/dev/null || echo "unknown")
echo "  New version: ${NEW_VERSION}"

# Step 5: Run basic smoke test
echo ""
echo "Step 5: Running smoke tests..."
PAUSED=$(soroban contract invoke \
    --id "${CONTRACT_ID}" \
    --fn is_paused \
    --rpc-url "${RPC_URL}" \
    ${NETWORK} 2>/dev/null || echo "unknown")
echo "  is_paused: ${PAUSED}"

ACTIVE=$(soroban contract invoke \
    --id "${CONTRACT_ID}" \
    --fn is_active \
    --rpc-url "${RPC_URL}" \
    ${NETWORK} 2>/dev/null || echo "unknown")
echo "  is_active: ${ACTIVE}"

echo ""
echo "=== Migration Complete ==="
echo "Contract ${CONTRACT_ID} migrated from v1 to v${NEW_VERSION}"
