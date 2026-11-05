import { describe, expect, it, vi } from "vitest";
import { JointSaveError } from "../errors";
import { isRetryable, mayHaveReachedServer, withRpcRetry } from "./retry";

describe("isRetryable", () => {
  it("retries transient network errors", () => {
    expect(isRetryable(new Error("fetch failed"))).toBe(true);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryable(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRetryable(new Error("txBadSeq"))).toBe(true);
  });

  it("does not retry deterministic errors", () => {
    expect(isRetryable(new Error("insufficient balance"))).toBe(false);
    expect(isRetryable(new Error("txTooLate"))).toBe(false);
    expect(isRetryable(new Error("user rejected"))).toBe(false);
    expect(isRetryable(new JointSaveError("INVALID_ARGUMENT", "bad amount"))).toBe(false);
    expect(isRetryable(new JointSaveError("SIMULATION_FAILED", "pool paused"))).toBe(false);
  });

  it("retries timeouts and transient RPC errors", () => {
    expect(isRetryable(new JointSaveError("TIMEOUT", "timed out"))).toBe(true);
    expect(isRetryable(new JointSaveError("RPC_ERROR", "service unavailable"))).toBe(true);
  });
});

describe("mayHaveReachedServer", () => {
  it("flags ambiguous transport failures", () => {
    expect(mayHaveReachedServer(new Error("timed out waiting for response"))).toBe(true);
    expect(mayHaveReachedServer(new Error("socket hang up"))).toBe(true);
    expect(mayHaveReachedServer(new JointSaveError("TIMEOUT", "timeout"))).toBe(true);
  });

  it("does not flag failures that never reached the server", () => {
    expect(mayHaveReachedServer(new Error("ECONNREFUSED"))).toBe(false);
    expect(mayHaveReachedServer(new Error("ENOTFOUND"))).toBe(false);
    expect(mayHaveReachedServer(new Error("user rejected"))).toBe(false);
    expect(mayHaveReachedServer(new Error("txTooLate"))).toBe(false);
    expect(mayHaveReachedServer(new Error("TRY_AGAIN_LATER"))).toBe(false);
    expect(mayHaveReachedServer(undefined)).toBe(false);
  });
});

describe("withRpcRetry", () => {
  it("retries until the operation succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();

    await expect(
      withRpcRetry(fn, { retries: 3, baseDelayMs: 0, jitter: false, onRetry })
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0]?.[1]).toBe(1);
  });

  it("stops after the configured retries", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("fetch failed"));
    await expect(
      withRpcRetry(fn, { retries: 2, baseDelayMs: 0, jitter: false })
    ).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry deterministic failures", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("user rejected"));
    await expect(
      withRpcRetry(fn, { retries: 3, baseDelayMs: 0, jitter: false })
    ).rejects.toThrow("user rejected");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
