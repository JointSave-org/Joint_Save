/**
 * Network configuration and contract-id resolution.
 *
 * The library never reads `process.env`: integrators pass values in. This
 * keeps the SDK usable in the browser, Node, workers, and tests without
 * hidden global state.
 */
import {
  MAINNET_NATIVE_SAC_ID,
  TESTNET_NATIVE_SAC_ID,
} from "./constants";
import type {
  ContractIds,
  ContractIdsInput,
  NetworkConfig,
  NetworkName,
} from "./types";

/** Resolved configuration for every supported network. */
export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/testnet",
    nativeSacId: TESTNET_NATIVE_SAC_ID,
  },
  mainnet: {
    name: "mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    explorerUrl: "https://stellar.expert/explorer/public",
    nativeSacId: MAINNET_NATIVE_SAC_ID,
  },
};

/** Default network used when none is specified. */
export const DEFAULT_NETWORK: NetworkName = "testnet";

/** All contract-id keys, in a stable order. */
export const CONTRACT_ID_KEYS = [
  "factory",
  "reputation",
  "governance",
  "microloan",
  "yieldVault",
  "yieldStrategy",
  "token",
] as const satisfies readonly (keyof ContractIds)[];

/**
 * Narrow an arbitrary string to a supported network name.
 *
 * @example
 * ```ts
 * const raw = "testnet";
 * if (isValidNetwork(raw)) getNetworkConfig(raw);
 * ```
 */
export function isValidNetwork(value: string): value is NetworkName {
  return value === "testnet" || value === "mainnet";
}

/**
 * Resolve a network's endpoints and identifiers.
 *
 * @throws {Error} when `name` is not a supported network.
 */
export function getNetworkConfig(name: string): NetworkConfig {
  if (!isValidNetwork(name)) {
    throw new Error(
      `Unknown network "${name}". Expected "testnet" or "mainnet".`,
    );
  }
  return NETWORKS[name];
}

/**
 * Return only the contract ids that were actually provided.
 *
 * Does **not** read `process.env`; empty strings are dropped. Useful for
 * callers that build the input from environment variables with gaps.
 */
export function resolveContractIds(
  source?: ContractIdsInput,
): Partial<ContractIds> {
  if (!source) return {};

  const resolved: Partial<ContractIds> = {};
  for (const key of CONTRACT_ID_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      (resolved as Record<string, string>)[key] = value;
    }
  }
  return resolved;
}
