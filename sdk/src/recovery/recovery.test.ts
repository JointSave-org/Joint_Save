import { describe, it, expect } from "vitest";
import { isRetryable, mayHaveReachedServer, withRpcRetry } from "./retry";
import { classifyContractError } from "../diagnostics/simulation";
import { redactTxLogEvent } from "../diagnostics/logger";
import { lookupTransaction } from "./lookup";

describe("Recovery: retry & classification", () => {
  it("distinguishes transient from deterministic errors", () => {
    expect(isRetryable(new Error("RPC rate limit exceeded"))).toBe(true);
    expect(isRetryable(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryable(new Error("ETIMEDOUT connection lost"))).toBe(true);
    expect(isRetryable(new Error("txBadSeq sequence number mismatch"))).toBe(true);

    expect(isRetryable(new Error("insufficient balance to deposit"))).toBe(false);
    expect(isRetryable(new Error("unauthorized signer"))).toBe(false);
    expect(isRetryable(new Error("missing contract id"))).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });

  it("identifies ambiguous timeouts vs local validation", () => {
    expect(mayHaveReachedServer(new Error("Gateway timeout 504"))).toBe(true);
    expect(mayHaveReachedServer(new Error("ECONNRESET during stream"))).toBe(true);
    expect(mayHaveReachedServer(new Error("fetch failed"))).toBe(true);

    expect(mayHaveReachedServer(new Error("invalid argument"))).toBe(false);
    expect(mayHaveReachedServer(new Error("unauthorized"))).toBe(false);
    expect(mayHaveReachedServer(null)).toBe(false);
  });

  it("retries transient errors with exponential backoff and succeeds", async () => {
    let attempts = 0;
    const result = await withRpcRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("503 Service Unavailable");
        }
        return "ok";
      },
      { retries: 3, baseDelayMs: 10, maxDelayMs: 50, jitter: false }
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("classifies contract errors correctly", () => {
    const err1 = classifyContractError(new Error("HostError: assert failed: pool paused"));
    expect(err1?.code).toBe("POOL_PAUSED");

    const err2 = classifyContractError(new Error("Transaction rejected: not a member"));
    expect(err2?.code).toBe("NOT_A_MEMBER");

    const errUnknown = classifyContractError(new Error("random network glitch"));
    expect(errUnknown).toBeNull();
  });

  it("redacts sensitive fields in transaction log events", () => {
    const event = {
      phase: "error" as const,
      contract: "CA1234",
      error: "Failed to sign with secret SBV5E6Y7U8I9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D5E6F7G8H9I0J1",
    };
    const redacted = redactTxLogEvent(event);
    expect(redacted.error).toContain("[REDACTED_SECRET");
    expect(redacted.contract).toBe("CA1234");
  });

  it("recovers transaction status without throwing raw RPC exceptions", async () => {
    const mockServer = {
      getTransaction: async () => ({
        status: "SUCCESS",
        ledger: 123456,
        resultMetaXdr: { toXDR: () => "mock-meta-xdr" },
      }),
    };

    const result = await lookupTransaction("mock-hash-123", {
      server: mockServer as any,
      timeoutMs: 500,
      pollIntervalMs: 50,
    });

    expect(result.status).toBe("success");
    expect(result.ledger).toBe(123456);
  });
});
