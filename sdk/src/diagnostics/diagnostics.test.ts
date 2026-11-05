import {
  Keypair,
  SorobanDataBuilder,
  StrKey,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { JointSaveError } from "../errors";
import {
  classifyContractError,
  mapContractError,
} from "./contract-errors";
import {
  consoleTxLogger,
  createRedactingLogger,
  redactLogEvent,
  redactSecrets,
  redactText,
} from "./logger";
import { summarizeSimulation } from "./simulation";

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 1));

describe("mapContractError", () => {
  it.each([
    ["Pool is paused", "POOL_PAUSED"],
    ["not a member of this pool", "NOT_A_MEMBER"],
    ["already deposited for this round", "ALREADY_DEPOSITED"],
    ["deadline passed", "DEADLINE_PASSED"],
    ["deadline not passed", "DEADLINE_NOT_PASSED"],
    ["target not reached", "TARGET_NOT_REACHED"],
    ["nothing to withdraw", "NOTHING_TO_WITHDRAW"],
    ["insufficient pool balance", "INSUFFICIENT_POOL_BALANCE"],
    ["insufficient balance", "INSUFFICIENT_BALANCE"],
    ["below minimum deposit", "BELOW_MINIMUM_DEPOSIT"],
    ["not admin", "UNAUTHORIZED"],
    ["pool not paused", "POOL_NOT_PAUSED"],
    ["already a member", "ALREADY_A_MEMBER"],
    ["pool inactive", "POOL_INACTIVE"],
    ["amount must be positive", "AMOUNT_MUST_BE_POSITIVE"],
    ["yield disabled", "YIELD_DISABLED"],
    ["token not supported", "TOKEN_NOT_SUPPORTED"],
    ["pool unlocked", "POOL_UNLOCKED"],
  ])("maps %s", (raw, code) => {
    expect(mapContractError(raw).code).toBe(code);
    expect(mapContractError(raw).message.length).toBeGreaterThan(0);
  });

  it("falls back to UNKNOWN", () => {
    const diagnostic = mapContractError("something exploded");
    expect(diagnostic.code).toBe("UNKNOWN");
    expect(diagnostic.message).toContain("something exploded");
  });
});

describe("classifyContractError", () => {
  it("classifies known contract text", () => {
    expect(classifyContractError("HostError: pool paused")?.code).toBe("POOL_PAUSED");
  });

  it("returns UNKNOWN for an unidentified contract failure", () => {
    const diagnostic = classifyContractError("Simulation failed: host trapped");
    expect(diagnostic?.code).toBe("UNKNOWN");
  });

  it("preserves contract and method context", () => {
    const error = new JointSaveError("SIMULATION_FAILED", "pool paused", {
      contract: CONTRACT,
      method: "deposit",
    });
    expect(classifyContractError(error)).toMatchObject({
      code: "POOL_PAUSED",
      contract: CONTRACT,
      method: "deposit",
    });
  });

  it("returns null for non-contract failures", () => {
    expect(classifyContractError(new Error("User rejected the request"))).toBeNull();
    expect(classifyContractError(new Error("fetch failed"))).toBeNull();
    expect(classifyContractError(undefined)).toBeNull();
  });
});

function successSimulation(): rpc.Api.SimulateTransactionResponse {
  const transactionData = new SorobanDataBuilder()
    .setResources(1500, 2048, 4096)
    .setResourceFee(100);

  return {
    id: "1",
    latestLedger: 1,
    events: [],
    _parsed: true,
    transactionData,
    minResourceFee: "12345",
    result: { auth: [], retval: nativeToScVal(1, { type: "u32" }) },
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

describe("summarizeSimulation", () => {
  it("summarizes resources and fee", () => {
    expect(summarizeSimulation(successSimulation())).toEqual({
      instructions: 1500,
      readBytes: 2048,
      writeBytes: 4096,
      feeStroops: 12345,
    });
  });

  it("returns zeroes for failed simulations", () => {
    const failed = { id: "1", error: "missing entry" } as unknown as
      rpc.Api.SimulateTransactionResponse;
    expect(summarizeSimulation(failed)).toEqual({
      instructions: 0,
      readBytes: 0,
      writeBytes: 0,
      feeStroops: 0,
    });
  });
});

describe("log redaction", () => {
  const secret = Keypair.random().secret();

  it("redacts accounts, contracts, and secrets", () => {
    const redacted = redactText(`from ${ACCOUNT} to ${CONTRACT} key ${secret}`);
    expect(redacted).not.toContain(ACCOUNT);
    expect(redacted).not.toContain(CONTRACT);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("G…[redacted]");
    expect(redacted).toContain("C…[redacted]");
    expect(redacted).toContain("[redacted-secret]");
  });

  it("redacts only secrets when explicitly requested", () => {
    expect(redactSecrets(`key ${secret}`)).toBe("key [redacted-secret]");
  });

  it("returns a redacted copy of an event", () => {
    const event = redactLogEvent({
      phase: "error",
      operation: "deposit",
      hash: "abc",
      error: `failed for ${ACCOUNT}`,
    });
    expect(event).toEqual({
      phase: "error",
      operation: "deposit",
      hash: "abc",
      error: "failed for G…[redacted]",
    });
  });

  it("lets a logger opt in to addresses", () => {
    const seen: string[] = [];
    const logger = createRedactingLogger(
      (event) => seen.push(event.error ?? ""),
      { includeAddresses: true }
    );
    logger({ phase: "error", error: `${ACCOUNT} ${secret}` });
    expect(seen[0]).toContain(ACCOUNT);
    expect(seen[0]).not.toContain(secret);
  });

  it("writes a single redacted line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleTxLogger({ phase: "submit", operation: "deposit", hash: "abc", durationMs: 12 });
    expect(info).toHaveBeenCalledWith(
      "[jointsave:sdk] phase=submit operation=deposit hash=abc durationMs=12"
    );
    info.mockRestore();
  });
});
