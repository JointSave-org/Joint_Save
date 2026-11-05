import { describe, it, expect, vi } from "vitest";
import { JointSaveClient } from "./base";
import type { SorobanServer } from "./base";

describe("JointSaveClient", () => {
  const dummyServer: Partial<SorobanServer> = {
    getAccount: vi.fn(),
    prepareTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    simulateTransaction: vi.fn(),
  };

  it("initializes with valid contract IDs", () => {
    const client = new JointSaveClient({
      contractIds: {
        factory: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      },
      server: dummyServer as SorobanServer,
    });
    expect(client.network).toBe("testnet");
    expect(client.requireContractId("factory")).toBe(
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"
    );
  });

  it("throws when missing factory contract", () => {
    expect(() => {
      new JointSaveClient({
        contractIds: {} as any,
        server: dummyServer as SorobanServer,
      });
    }).toThrow("A factory contract id is required");
  });

  it("instantiates sub-clients lazily when contract IDs are configured", () => {
    const client = new JointSaveClient({
      contractIds: {
        factory: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        governance: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBD2KM",
        reputation: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCD2KM",
        yieldVault: "CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD2KM",
      },
      server: dummyServer as SorobanServer,
    });

    expect(client.factory).toBeDefined();
    expect(client.pool).toBeDefined();
    expect(client.governance).toBeDefined();
    expect(client.reputation).toBeDefined();
    expect(client.yieldVault).toBeDefined();
  });
});
