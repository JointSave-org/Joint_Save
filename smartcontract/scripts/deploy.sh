#!/bin/bash
# JointSave – Soroban deployment script (Stellar Testnet)
# Prerequisites: stellar CLI installed, funded testnet account

set -e

NETWORK="testnet"
SOURCE="deployer"   # stellar CLI identity name

echo "Building contracts..."
stellar contract build

echo ""
echo "Deploying JointSave Factory..."
FACTORY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/jointsave_factory.wasm \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "Factory contract ID: $FACTORY_ID"

echo ""
echo "Deploying Reputation Tracker..."
REPUTATION_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/jointsave_reputation.wasm \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "Reputation Tracker contract ID: $REPUTATION_ID"

echo ""
echo "Uploading Rotational Pool wasm..."
ROTATIONAL_WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/jointsave_rotational.wasm \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "Rotational wasm hash: $ROTATIONAL_WASM_HASH"

echo ""
echo "Uploading Target Pool wasm..."
TARGET_WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/jointsave_target.wasm \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "Target wasm hash: $TARGET_WASM_HASH"

echo ""
echo "Uploading Flexible Pool wasm..."
FLEXIBLE_WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/jointsave_flexible.wasm \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "Flexible wasm hash: $FLEXIBLE_WASM_HASH"

echo ""
echo "Building Yield Vault (mock feature)..."
# The mock vault implements the VaultAdapter interface and is only intended for
# testnet demos. Production groups point at a real external vault instead.
cargo build --release --target wasm32v1-none \
  --manifest-path=contracts/yield-vault/Cargo.toml --features mock

echo ""
echo "Uploading Yield Vault (mock) wasm..."
YIELD_VAULT_WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/jointsave_yield_vault.wasm \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "Yield vault wasm hash: $YIELD_VAULT_WASM_HASH"

echo ""
echo "Deploying Yield Vault (mock)..."
YIELD_VAULT_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/jointsave_yield_vault.wasm \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "Yield vault contract ID: $YIELD_VAULT_ID"

echo ""
echo "Initializing factory..."
# XLM native token contract on Stellar testnet
NATIVE_TOKEN="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
DEPLOYER_ADDRESS=$(stellar keys address "$SOURCE" --network "$NETWORK")
stellar contract invoke \
  --id "$FACTORY_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER_ADDRESS" \
  --token "$NATIVE_TOKEN" \
  --treasury "$DEPLOYER_ADDRESS"
echo "Factory initialized."

echo ""
echo "Initializing Yield Vault (mock)..."
stellar contract invoke \
  --id "$YIELD_VAULT_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER_ADDRESS" \
  --token "$NATIVE_TOKEN"
echo "Yield vault initialized."

echo ""
echo "Deployment complete. Update your .env with:"
echo "NEXT_PUBLIC_FACTORY_CONTRACT_ID=$FACTORY_ID"
echo "NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REPUTATION_ID"
echo "NEXT_PUBLIC_ROTATIONAL_WASM_HASH=$ROTATIONAL_WASM_HASH"
echo "NEXT_PUBLIC_TARGET_WASM_HASH=$TARGET_WASM_HASH"
echo "NEXT_PUBLIC_FLEXIBLE_WASM_HASH=$FLEXIBLE_WASM_HASH"
echo "NEXT_PUBLIC_YIELD_VAULT_WASM_HASH=$YIELD_VAULT_WASM_HASH"
echo "NEXT_PUBLIC_YIELD_VAULT_ID=$YIELD_VAULT_ID"
