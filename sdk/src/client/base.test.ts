import { Account, StrKey, nativeToScVal, rpc, type Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import type { TxLogEvent } from "../diagnostics/logger";
import { JointSaveError } from "../errors";
import { JointSaveClient, type SorobanServer } from "./base";

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const FACTORY = StrKey.encodeContract(Buffer.alloc(32, 1));
const GOVERNANCE = StrKey.encodeContract(Buffer.alloc(32, 2));
const REPUTATION = StrKey.encodeContract(Buffer.alloc(32, 3));

function successSimulation(result: unknown): rpc.Api.SimulateTransactionResponse {
  return {
    id: "1",
    latestLedger: 1,
    events: [],
    _parsed: true,
    transactionData: {},
    minResourceFee: "100",
    result: { auth: [], retval: nativeToScVal(result, { type: "u32" }) },
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

function errorSimulation(message: string): rpc.Api.SimulateTransactionResponse {
  return {
    id: "1",
    latestLedger: 1,
    events: [],
    _parsed: true,
    error: message,
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

class FakeServer implements SorobanServer {
  simulation: rpc.Api.SimulateTransactionResponse = successSimulation(1);
  sendResponse: rpc.Api.SendTransactionResponse = {
    status: "PENDING",
    hash: "abc",
    latestLedger: 1,
    latestLedgerCloseTime: 0,
  };
  txResponse: rpc.Api.GetTransactionResponse = {
    status: rpc.Api.GetTransactionStatus.SUCCESS,
    ledger: 7,
    txHash: "abc",
  } as unknown as rpc.Api.GetTransactionResponse;
  prepared: Transaction | undefined;

  async getAccount(accountId: string): Promise<Account> {
    return new Account(accountId, "0");
  }

  async prepareTransaction(tx: Transaction): Promise<Transaction> {
    this.prepared = tx;
    return tx;
  }

  async sendTransaction(): Promise<rpc.Api.SendTransactionResponse> {
    return this.sendResponse;
  }

  async getTransaction(): Promise<rpc.Api.GetTransactionResponse> {
    return this.txResponse;
  }

  async simulateTransaction(): Promise<rpc.Api.SimulateTransactionResponse> {
    return this.simulation;
  }
}

function buildClient(server: FakeServer, extra: Partial<ConstructorParameters<typeof JointSaveClient>[0]> = {}) {
  return new JointSaveClient({
    contractIds: { factory: FACTORY, governance: GOVERNANCE, reputation: REPUTATION },
    server,
    ...extra,
  });
}

const sendOptions = {
  accountId: ACCOUNT,
  signer: (xdr: string) => xdr,
};

describe("JointSaveClient construction", () => {
  it("requires a factory contract", () => {
    expect(() => new JointSaveClient({ contractIds: {}, server: new FakeServer() })).toThrow(
      JointSaveError
    );
    try {
      new JointSaveClient({ contractIds: {}, server: new FakeServer() });
    } catch (error) {
      expect((error as JointSaveError).code).toBe("MISSING_CONTRACT");
    }
  });

  it("exposes lazy sub-clients", () => {
    const client = buildClient(new FakeServer());
    expect(client.factory).toBe(client.factory);
    expect(client.pool).toBe(client.pool);
    expect(client.governance).toBe(client.governance);
    expect(client.reputation).toBe(client.reputation);
    expect(client.yieldVault).toBe(client.yieldVault);
  });

  it("throws for an unconfigured contract id", () => {
    const client = buildClient(new FakeServer());
    expect(() => client.requireContractId("microloan")).toThrow(/not configured/);
  });

  it("looks up transactions through the facade", async () => {
    const client = buildClient(new FakeServer());
    await expect(client.lookupTransaction("abc")).resolves.toEqual({
      hash: "abc",
      state: "success",
      ledger: 7,
    });
  });
});

describe("JointSaveClient.read", () => {
  it("simulates and decodes the return value", async () => {
    const server = new FakeServer();
    server.simulation = successSimulation(42);
    const client = buildClient(server);
    await expect(client.read(FACTORY, "get_version")).resolves.toBe(42);
  });

  it("surfaces simulation errors", async () => {
    const server = new FakeServer();
    server.simulation = errorSimulation("missing ledger entry");
    const client = buildClient(server);
    await expect(client.read(FACTORY, "get_version")).rejects.toMatchObject({
      code: "SIMULATION_FAILED",
      message: "missing ledger entry",
    });
  });

  it("rejects a simulation with no return value", async () => {
    const server = new FakeServer();
    server.simulation = { ...successSimulation(0), result: undefined } as unknown as
      rpc.Api.SimulateTransactionResponse;
    const client = buildClient(server);
    await expect(client.read(FACTORY, "get_version")).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });
  });
});

describe("JointSaveClient.send", () => {
  it("signs, submits, and confirms", async () => {
    const server = new FakeServer();
    const phases: TxLogEvent["phase"][] = [];
    const client = buildClient(server, { logger: (event) => phases.push(event.phase) });

    const result = await client.send(FACTORY, "register_rotational", [], sendOptions);

    expect(result).toEqual({ hash: "abc", status: "success", ledger: 7 });
    expect(server.prepared).toBeDefined();
    expect(phases).toEqual(["build", "simulate", "sign", "submit", "confirm"]);
  });

  it("returns failed when submission is rejected", async () => {
    const server = new FakeServer();
    server.sendResponse = { ...server.sendResponse, status: "ERROR" };
    const client = buildClient(server);
    await expect(client.send(FACTORY, "register_rotational", [], sendOptions)).resolves.toEqual({
      hash: "abc",
      status: "failed",
    });
  });

  it("returns failed when the network rejects the transaction", async () => {
    const server = new FakeServer();
    server.txResponse = {
      status: rpc.Api.GetTransactionStatus.FAILED,
      ledger: 9,
      txHash: "abc",
    } as unknown as rpc.Api.GetTransactionResponse;
    const client = buildClient(server);
    await expect(client.send(FACTORY, "register_rotational", [], sendOptions)).resolves.toEqual({
      hash: "abc",
      status: "failed",
      ledger: 9,
    });
  });

  it("returns timeout when confirmation never arrives", async () => {
    const server = new FakeServer();
    server.txResponse = {
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      txHash: "abc",
    } as unknown as rpc.Api.GetTransactionResponse;
    const client = buildClient(server, { confirmTimeoutMs: 0, pollIntervalMs: 1 });
    await expect(client.send(FACTORY, "register_rotational", [], sendOptions)).resolves.toEqual({
      hash: "abc",
      status: "timeout",
    });
  });

  it("wraps signer failures", async () => {
    const client = buildClient(new FakeServer());
    await expect(
      client.send(FACTORY, "register_rotational", [], {
        accountId: ACCOUNT,
        signer: () => {
          throw new Error("user rejected");
        },
      })
    ).rejects.toMatchObject({ code: "SIGN_FAILED", message: "Failed to sign register_rotational" });
  });

  it("wraps account load failures", async () => {
    const server = new FakeServer();
    const spy = vi.spyOn(server, "getAccount").mockRejectedValue(new Error("account not found"));
    const client = buildClient(server);
    await expect(client.send(FACTORY, "register_rotational", [], sendOptions)).rejects.toMatchObject({
      code: "ACCOUNT_ERROR",
    });
    spy.mockRestore();
  });
});
