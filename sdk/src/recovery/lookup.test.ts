import { nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { lookupTransaction, type TransactionLookupServer } from "./lookup";

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

function success(ledger = 7): rpc.Api.GetTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    ledger,
    txHash: "abc",
  } as unknown as rpc.Api.GetTransactionResponse;
}

function missing(): rpc.Api.GetTransactionResponse {
  return {
    status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    txHash: "abc",
  } as unknown as rpc.Api.GetTransactionResponse;
}

function diagnosticEvent(text: string): xdr.DiagnosticEvent {
  const body = new xdr.ContractEventV0({
    topics: [nativeToScVal(text)],
    data: nativeToScVal(""),
  });
  const event = new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: null,
    type: xdr.ContractEventType.diagnostic(),
    body: new xdr.ContractEventBody(0, body),
  });
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: false, event });
}

function server(get: () => Promise<rpc.Api.GetTransactionResponse>): TransactionLookupServer {
  return { getTransaction: get };
}

describe("lookupTransaction", () => {
  it("resolves a successful transaction", async () => {
    await expect(
      lookupTransaction("abc", { server: server(async () => success(7)) })
    ).resolves.toEqual({ hash: "abc", state: "success", ledger: 7 });
  });

  it("resolves a failed transaction with result code and contract error", async () => {
    const resultXdr = {
      result: () => ({ switch: () => ({ name: "txFailed" }) }),
    } as unknown as xdr.TransactionResult;
    const response = {
      status: rpc.Api.GetTransactionStatus.FAILED,
      ledger: 9,
      txHash: "abc",
      resultXdr,
      diagnosticEventsXdr: [diagnosticEvent("pool paused")],
    } as unknown as rpc.Api.GetTransactionResponse;

    const lookup = await lookupTransaction("abc", { server: server(async () => response) });
    expect(lookup).toMatchObject({
      hash: "abc",
      state: "failed",
      ledger: 9,
      resultCode: "txFailed",
      contractError: { code: "POOL_PAUSED" },
    });
  });

  it("extracts contract errors from result meta diagnostics", async () => {
    const resultMetaXdr = {
      v3: () => ({
        sorobanMeta: () => ({ diagnosticEvents: () => [diagnosticEvent("deadline passed")] }),
      }),
    } as unknown as xdr.TransactionMeta;
    const response = {
      status: rpc.Api.GetTransactionStatus.FAILED,
      ledger: 9,
      txHash: "abc",
      resultMetaXdr,
    } as unknown as rpc.Api.GetTransactionResponse;

    const lookup = await lookupTransaction("abc", { server: server(async () => response) });
    expect(lookup.contractError?.code).toBe("DEADLINE_PASSED");
  });

  it("returns not_found for a single check", async () => {
    await expect(
      lookupTransaction("abc", { server: server(async () => missing()), timeoutMs: 0 })
    ).resolves.toEqual({ hash: "abc", state: "not_found" });
  });

  it("returns pending when polling expires without a result", async () => {
    await expect(
      lookupTransaction("abc", {
        server: server(async () => missing()),
        timeoutMs: 5,
        pollIntervalMs: 1,
      })
    ).resolves.toEqual({ hash: "abc", state: "pending" });
  });

  it("retries transient RPC errors", async () => {
    let calls = 0;
    const response = await lookupTransaction("abc", {
      server: server(async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        return success(11);
      }),
      timeoutMs: 1_000,
      pollIntervalMs: 0,
    });

    expect(calls).toBe(2);
    expect(response).toMatchObject({ state: "success", ledger: 11 });
  });

  it("never throws and redacts transport errors", async () => {
    const lookup = await lookupTransaction("abc", {
      server: server(async () => {
        throw new Error(`timed out for ${ACCOUNT}`);
      }),
      timeoutMs: 0,
    });

    expect(lookup.state).toBe("timeout");
    expect(lookup.error).toContain("G…[redacted]");
    expect(lookup.error).not.toContain(ACCOUNT);
  });
});
