import {
  Account,
  StrKey,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { JointSaveClient, type SorobanServer } from "./base";
import { buildYieldAllocationParams, decodeYieldAllocationParams } from "./governance";

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const FACTORY = StrKey.encodeContract(Buffer.alloc(32, 1));
const POOL = StrKey.encodeContract(Buffer.alloc(32, 2));
const GOVERNANCE = StrKey.encodeContract(Buffer.alloc(32, 3));
const REPUTATION = StrKey.encodeContract(Buffer.alloc(32, 4));
const VAULT = StrKey.encodeContract(Buffer.alloc(32, 5));

interface Invocation {
  method: string;
  args: unknown[];
}

class MethodServer implements SorobanServer {
  responses: Record<string, unknown> = {};
  invocation: Invocation | undefined;
  sendStatus: rpc.Api.SendTransactionStatus = "PENDING";

  async getAccount(accountId: string): Promise<Account> {
    return new Account(accountId, "0");
  }

  async prepareTransaction(tx: Transaction): Promise<Transaction> {
    this.invocation = extractInvocation(tx);
    return tx;
  }

  async sendTransaction(): Promise<rpc.Api.SendTransactionResponse> {
    return {
      status: this.sendStatus,
      hash: "hash",
      latestLedger: 1,
      latestLedgerCloseTime: 0,
    };
  }

  async getTransaction(): Promise<rpc.Api.GetTransactionResponse> {
    return {
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      ledger: 12,
      txHash: "hash",
    } as unknown as rpc.Api.GetTransactionResponse;
  }

  async simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    const invocation = extractInvocation(tx);
    this.invocation = invocation;
    return {
      id: "1",
      latestLedger: 1,
      events: [],
      _parsed: true,
      transactionData: {},
      minResourceFee: "100",
      result: { auth: [], retval: nativeToScVal(this.responses[invocation.method]) },
    } as unknown as rpc.Api.SimulateTransactionResponse;
  }
}

function extractInvocation(tx: Transaction): Invocation {
  const operation = tx.operations[0] as unknown as { func: xdr.HostFunction };
  const invoke = operation.func.invokeContract();
  return {
    method: invoke.functionName().toString(),
    args: invoke.args().map((arg) => scValToNative(arg)),
  };
}

function buildClient(server: MethodServer): JointSaveClient {
  return new JointSaveClient({
    contractIds: {
      factory: FACTORY,
      governance: GOVERNANCE,
      reputation: REPUTATION,
      token: VAULT,
    },
    server,
  });
}

const sendOptions = { accountId: ACCOUNT, signer: (xdrValue: string) => xdrValue };

describe("FactoryClient", () => {
  it("aggregates the pool registry and locates a pool", async () => {
    const server = new MethodServer();
    const poolHex = Buffer.from(StrKey.decodeContract(POOL)).toString("hex");
    server.responses.all_rotational = [Buffer.from(StrKey.decodeContract(POOL))];
    server.responses.all_target = [];
    server.responses.all_flexible = [];
    const client = buildClient(server);

    await expect(client.factory.getPools()).resolves.toEqual({
      rotational: [poolHex],
      target: [],
      flexible: [],
    });
    await expect(client.factory.getPool(poolHex)).resolves.toEqual({
      id: poolHex,
      type: "rotational",
    });
    await expect(client.factory.getPool(Buffer.alloc(32, 9).toString("hex"))).resolves.toBeNull();
  });

  it("registers a rotational pool with address and bytes32 args", async () => {
    const server = new MethodServer();
    const client = buildClient(server);
    const result = await client.factory.registerRotational(ACCOUNT, POOL, sendOptions);

    expect(result).toEqual({ hash: "hash", status: "success", ledger: 12 });
    expect(server.invocation?.method).toBe("register_rotational");
    expect(server.invocation?.args[0]).toBe(ACCOUNT);
    expect(server.invocation?.args[1]).toEqual(Buffer.from(StrKey.decodeContract(POOL)));
  });
});

describe("PoolClient", () => {
  it("reads target pool state", async () => {
    const server = new MethodServer();
    server.responses.is_unlocked = true;
    server.responses.total_deposited = 500n;
    server.responses.target_amount = 1_000n;
    server.responses.deadline = 99;
    server.responses.get_version = 3;
    server.responses.balance_of = 500n;
    const client = buildClient(server);

    await expect(client.pool.getTargetState(POOL, ACCOUNT)).resolves.toEqual({
      isUnlocked: true,
      totalDeposited: 500n,
      targetAmount: 1_000n,
      userBalance: 500n,
      deadlineLedger: 99,
      contractVersion: 3,
    });
  });

  it("requires an amount for flexible deposits", async () => {
    const server = new MethodServer();
    const client = buildClient(server);
    await expect(
      client.pool.deposit("flexible", POOL, { member: ACCOUNT }, sendOptions)
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("sends member and amount for flexible deposits", async () => {
    const server = new MethodServer();
    const client = buildClient(server);
    await client.pool.deposit("flexible", POOL, { member: ACCOUNT, amount: 25n }, sendOptions);

    expect(server.invocation?.method).toBe("deposit");
    expect(server.invocation?.args).toEqual([ACCOUNT, 25n]);
  });

  it("rejects direct rotational withdrawals", async () => {
    const client = buildClient(new MethodServer());
    await expect(
      client.pool.withdraw("rotational", POOL, { member: ACCOUNT }, sendOptions)
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});

describe("GovernanceClient", () => {
  it("encodes yield-allocation params like the frontend helper", () => {
    const params = buildYieldAllocationParams({
      action: "alloc",
      vault: VAULT,
      amountBaseUnits: 1_500_000n,
    });

    expect(Buffer.from(params.action as string, "hex").toString("utf8")).toBe("alloc");
    expect(Buffer.from(params.vault as string, "hex").toString("utf8")).toBe(VAULT);
    expect(params.amount as string).toBe("0000000000000000000000000016e360");
    expect(decodeYieldAllocationParams(params)).toEqual({
      action: "alloc",
      vault: VAULT,
      amountBaseUnits: 1_500_000n,
    });
  });

  it("maps YieldAllocation to the on-chain Custom variant", async () => {
    const server = new MethodServer();
    const client = buildClient(server);

    await client.governance.createYieldAllocationProposal(
      ACCOUNT,
      { action: "dealloc", amountBaseUnits: 42n },
      "Pull capital back",
      sendOptions
    );

    expect(server.invocation?.method).toBe("create_proposal");
    expect(server.invocation?.args[0]).toBe(ACCOUNT);
    expect(server.invocation?.args[1]).toEqual(["Custom"]);
    expect(server.invocation?.args[2]).toBe("Pull capital back");
    const params = server.invocation?.args[3] as Record<string, Buffer>;
    expect(Buffer.from(params.action as Buffer).toString("utf8")).toBe("dealloc");
    expect(BigInt("0x" + Buffer.from(params.amount as Buffer).toString("hex"))).toBe(42n);
  });

  it("decodes proposals and detects yield-allocation metadata", async () => {
    const server = new MethodServer();
    const params = buildYieldAllocationParams({ action: "dealloc", amountBaseUnits: 42n });
    server.responses.get_proposal = {
      id: Buffer.alloc(32, 1),
      proposer: ACCOUNT,
      proposal_type: ["Custom"],
      description: "pull",
      votes_for: [ACCOUNT],
      votes_against: [],
      status: ["Active"],
      created_at: 10,
      expires_at: 20,
      parameters: {
        action: Buffer.from(params.action as string, "hex"),
        amount: Buffer.from(params.amount as string, "hex"),
      },
    };
    const client = buildClient(server);

    const proposal = await client.governance.getProposal("11".repeat(32));
    expect(proposal.proposalType).toBe("YieldAllocation");
    expect(proposal.status).toBe("Active");
    expect(proposal.votesFor).toEqual([ACCOUNT]);
    expect(decodeYieldAllocationParams(proposal.parameters)).toEqual({
      action: "dealloc",
      amountBaseUnits: 42n,
    });
  });
});

describe("ReputationClient", () => {
  it("decodes the leaderboard tuples", async () => {
    const server = new MethodServer();
    server.responses.get_score_leaderboard = [
      [
        ACCOUNT,
        {
          total_score: 900,
          deposit_reliability: 950,
          pools_completed: 4,
          pools_joined: 5,
          total_deposits: 12,
          missed_deposits: 1,
          total_deposit_amount: 7_000n,
          last_activity: 100,
          score_updated_at: 200,
        },
      ],
    ];
    const client = buildClient(server);

    const board = await client.reputation.getLeaderboard(10);
    expect(board).toHaveLength(1);
    expect(board[0]?.address).toBe(ACCOUNT);
    expect(board[0]?.data).toMatchObject({
      totalScore: 900,
      totalDeposits: 12,
      missedDeposits: 1,
      totalDepositAmount: 7_000n,
      isProvisional: false,
    });
  });
});

describe("YieldVaultClient", () => {
  it("reads the flexible-pool allocation state", async () => {
    const server = new MethodServer();
    server.responses.yield_vault = VAULT;
    server.responses.yield_shares = 10n;
    server.responses.yield_cost_basis = 100n;
    server.responses.yield_buffer_bps = 2_000;
    server.responses.yield_locked = false;
    server.responses.yield_position = 110n;
    server.responses.unrealised_yield = 10n;
    server.responses.max_allocatable_amount = 50n;
    const client = buildClient(server);

    await expect(client.yieldVault.getState(POOL)).resolves.toEqual({
      vault: VAULT,
      shares: 10n,
      costBasis: 100n,
      bufferBps: 2_000,
      locked: false,
      position: 110n,
      unrealised: 10n,
      maxAllocatable: 50n,
    });
  });

  it("sends allocation args in order", async () => {
    const server = new MethodServer();
    const client = buildClient(server);
    await client.yieldVault.allocate(POOL, ACCOUNT, VAULT, 100n, sendOptions);

    expect(server.invocation?.method).toBe("apply_yield_allocation");
    expect(server.invocation?.args).toEqual([ACCOUNT, VAULT, 100n]);
  });
});
