import { describe, it, expect, vi } from "vitest";
import { lookupTransaction } from "./lookup";
import { rpc } from "@stellar/stellar-sdk";
import type { SorobanServer } from "../client/base";

describe("Recovery: lookupTransaction", () => {
  it("resolves success when getTransaction succeeds", async () => {
    const mockServer: Partial<SorobanServer> = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 12345,
        resultXdr: { toXDR: () => "AAAA==" },
      }),
    };

    const res = await lookupTransaction("hash-123", {
      server: mockServer as SorobanServer,
      timeoutMs: 1000,
      pollIntervalMs: 10,
    });

    expect(res.status).toBe("success");
    expect(res.ledger).toBe(12345);
    expect(res.resultXdr).toBe("AAAA==");
  });

  it("resolves failed when transaction execution failed", async () => {
    const mockServer: Partial<SorobanServer> = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.FAILED,
        ledger: 12346,
      }),
    };

    const res = await lookupTransaction("hash-failed", {
      server: mockServer as SorobanServer,
      timeoutMs: 1000,
      pollIntervalMs: 10,
    });

    expect(res.status).toBe("failed");
    expect(res.ledger).toBe(12346);
    expect(res.error).toBeDefined();
  });

  it("returns timeout state when polling exhausts timeoutMs without throwing", async () => {
    const mockServer: Partial<SorobanServer> = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      }),
    };

    const res = await lookupTransaction("hash-pending", {
      server: mockServer as SorobanServer,
      timeoutMs: 50,
      pollIntervalMs: 10,
    });

    expect(res.status).toBe("timeout");
    expect(res.error).toContain("timed out");
  });
});
