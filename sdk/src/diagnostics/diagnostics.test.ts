import { describe, it, expect, vi } from "vitest";
import { summarizeSimulation, classifyContractError } from "./simulation";
import { redactSensitiveData, createSafeLogEvent, consoleTxLogger } from "./logger";
import { rpc } from "@stellar/stellar-sdk";

describe("Diagnostics: summarizeSimulation", () => {
  it("summarizes simulation response into numeric metrics without XDR blobs", () => {
    const mockSim = {
      status: "SUCCESS",
      minResourceFee: 1500,
      transactionData: {
        resources: () => ({
          instructions: () => 120000,
          readBytes: () => 500,
          writeBytes: () => 300,
        }),
      },
    };

    const summary = summarizeSimulation(mockSim as unknown as rpc.Api.SimulateTransactionResponse);
    expect(summary.instructions).toBe(120000);
    expect(summary.readBytes).toBe(500);
    expect(summary.writeBytes).toBe(300);
    expect(summary.feeStroops).toBe("1500");
    // Ensure no raw objects or XDR leaked
    expect(JSON.stringify(summary)).not.toContain("transactionData");
  });
});

describe("Diagnostics: classifyContractError", () => {
  it("classifies known contract error strings correctly", () => {
    const diag = classifyContractError(new Error("HostError: assert failed: pool paused"));
    expect(diag).not.toBeNull();
    expect(diag?.code).toBe("POOL_PAUSED");
    expect(diag?.message).toContain("paused");
  });

  it("classifies insufficient balance errors", () => {
    const diag = classifyContractError(new Error("insufficient balance for transfer"));
    expect(diag?.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("classifies unknown contract errors gracefully", () => {
    const diag = classifyContractError(new Error("HostError: contract error 99"));
    expect(diag?.code).toBe("UNKNOWN_CONTRACT_ERROR");
  });

  it("returns null for non-contract errors", () => {
    expect(classifyContractError(new Error("random network glitch"))).toBeNull();
    expect(classifyContractError(null)).toBeNull();
  });
});

describe("Diagnostics: Logging & Redaction", () => {
  it("redacts secret keys and bearer tokens", () => {
    const raw = "Failed with key SB3K2QNZQO62VDF2OQJ5XUDFX44M57Z43F25ZZZ3O47R3EAE2ZJ5AAAA and Bearer secret123";
    const redacted = redactSensitiveData(raw);
    expect(redacted).not.toContain("SB3K2QNZ");
    expect(redacted).toContain("S[REDACTED_SECRET_KEY]");
  });

  it("creates log-safe event objects", () => {
    const event = createSafeLogEvent({
      phase: "error",
      hash: "abc12345",
      error: "Error with SB3K2QNZQO62VDF2OQJ5XUDFX44M57Z43F25ZZZ3O47R3EAE2ZJ5AAAA",
    });
    expect(event.error).toContain("S[REDACTED_SECRET_KEY]");
  });

  it("consoleTxLogger logs without throwing", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleTxLogger({ phase: "build", contract: "CC123", method: "deposit" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
