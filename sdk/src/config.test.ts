import { describe, expect, it } from "vitest";
import {
  DEFAULT_NETWORK,
  getNetworkConfig,
  isValidNetwork,
  resolveContractIds,
} from "./config";
import { MAINNET_NATIVE_SAC_ID, TESTNET_NATIVE_SAC_ID } from "./constants";

describe("network config", () => {
  it("defaults to testnet", () => {
    expect(DEFAULT_NETWORK).toBe("testnet");
  });

  it("resolves testnet endpoints and passphrase", () => {
    const config = getNetworkConfig("testnet");
    expect(config).toMatchObject({
      name: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrl: "https://soroban-testnet.stellar.org",
      horizonUrl: "https://horizon-testnet.stellar.org",
      explorerUrl: "https://stellar.expert/explorer/testnet",
      nativeSacId: TESTNET_NATIVE_SAC_ID,
    });
  });

  it("resolves mainnet endpoints and passphrase", () => {
    const config = getNetworkConfig("mainnet");
    expect(config).toMatchObject({
      name: "mainnet",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      rpcUrl: "https://mainnet.sorobanrpc.com",
      horizonUrl: "https://horizon.stellar.org",
      explorerUrl: "https://stellar.expert/explorer/public",
      nativeSacId: MAINNET_NATIVE_SAC_ID,
    });
  });

  it("rejects unknown networks", () => {
    expect(() => getNetworkConfig("staging")).toThrow(/Unknown network/);
  });

  it("narrows valid network names", () => {
    expect(isValidNetwork("testnet")).toBe(true);
    expect(isValidNetwork("mainnet")).toBe(true);
    expect(isValidNetwork("futurenet")).toBe(false);
    expect(isValidNetwork("")).toBe(false);
  });
});

describe("resolveContractIds", () => {
  const factory = "C" + "A".repeat(55);

  it("returns only provided, non-empty ids", () => {
    const resolved = resolveContractIds({
      factory,
      reputation: "",
      governance: "C" + "B".repeat(55),
    });
    expect(resolved).toEqual({
      factory,
      governance: "C" + "B".repeat(55),
    });
  });

  it("returns an empty map when nothing is provided", () => {
    expect(resolveContractIds()).toEqual({});
    expect(resolveContractIds({})).toEqual({});
  });

  it("does not mutate its input", () => {
    const input = { factory };
    const frozen = Object.freeze({ ...input });
    expect(() => resolveContractIds(frozen)).not.toThrow();
    expect(input).toEqual({ factory });
  });
});
