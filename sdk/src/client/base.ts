import {
  Account,
  BASE_FEE,
  Contract,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { getNetworkConfig, resolveContractIds } from "../config";
import { classifyContractError } from "../diagnostics/contract-errors";
import { redactLogEvent, type TxLogEvent, type TxLogger } from "../diagnostics/logger";
import { JointSaveError, toJointSaveError } from "../errors";
import {
  lookupTransaction,
  type LookupTransactionOptions,
  type TxLookup,
} from "../recovery/lookup";
import { sleep } from "../utils/time";
import type {
  ContractIds,
  ContractIdsInput,
  NetworkConfig,
  NetworkName,
  TxResult,
} from "../types";
import { FactoryClient } from "./factory";
import { GovernanceClient } from "./governance";
import { PoolClient } from "./pool";
import { ReputationClient } from "./reputation";
import { YieldVaultClient } from "./yield-vault";

const DUMMY_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

export interface SorobanServer {
  getAccount(accountId: string): Promise<Account>;
  prepareTransaction(tx: Transaction): Promise<Transaction>;
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
  simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse>;
}

export interface SignTransactionOptions {
  networkPassphrase: string;
  accountId: string;
}

export type SignTransaction = (
  xdr: string,
  options: SignTransactionOptions
) => Promise<string> | string;

export interface SendOptions {
  accountId: string;
  signer: SignTransaction;
  fee?: string;
  timeoutSeconds?: number;
  confirmTimeoutMs?: number;
}

export interface JointSaveClientOptions {
  network?: NetworkName;
  contractIds: ContractIdsInput;
  rpcUrl?: string;
  horizonUrl?: string;
  networkPassphrase?: string;
  server?: SorobanServer;
  logger?: TxLogger | undefined;
  timeoutSeconds?: number;
  pollIntervalMs?: number;
  confirmTimeoutMs?: number;
}

export interface ContractCaller {
  readonly network: NetworkName;
  readonly networkConfig: NetworkConfig;
  readonly contractIds: ContractIds;
  read<T = unknown>(contractId: string, method: string, args?: xdr.ScVal[]): Promise<T>;
  send(contractId: string, method: string, args: xdr.ScVal[], options: SendOptions): Promise<TxResult>;
  requireContractId(key: keyof ContractIds): string;
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_CONFIRM_TIMEOUT_MS = 30_000;
const MAX_SUBMIT_ATTEMPTS = 3;

export class JointSaveClient implements ContractCaller {
  readonly network: NetworkName;
  readonly networkConfig: NetworkConfig;
  readonly contractIds: ContractIds;
  readonly server: SorobanServer;

  private readonly logger: TxLogger | undefined;
  private readonly timeoutSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly confirmTimeoutMs: number;

  private _factory: FactoryClient | undefined;
  private _pool: PoolClient | undefined;
  private _governance: GovernanceClient | undefined;
  private _reputation: ReputationClient | undefined;
  private _yieldVault: YieldVaultClient | undefined;

  constructor(options: JointSaveClientOptions) {
    const network = options.network ?? "testnet";
    const base = getNetworkConfig(network);

    this.network = network;
    this.networkConfig = {
      ...base,
      rpcUrl: options.rpcUrl ?? base.rpcUrl,
      horizonUrl: options.horizonUrl ?? base.horizonUrl,
      networkPassphrase: options.networkPassphrase ?? base.networkPassphrase,
    };

    const resolved = resolveContractIds(options.contractIds);
    if (!resolved.factory) {
      throw new JointSaveError("MISSING_CONTRACT", "A factory contract id is required", {
        contract: "factory",
      });
    }
    this.contractIds = resolved as ContractIds;

    this.server =
      options.server ??
      new rpc.Server(this.networkConfig.rpcUrl, {
        allowHttp: this.networkConfig.rpcUrl.startsWith("http://"),
      });

    this.logger = options.logger;
    this.timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  }

  get factory(): FactoryClient {
    return (this._factory ??= new FactoryClient(this));
  }

  get pool(): PoolClient {
    return (this._pool ??= new PoolClient(this));
  }

  get governance(): GovernanceClient {
    return (this._governance ??= new GovernanceClient(this));
  }

  get reputation(): ReputationClient {
    return (this._reputation ??= new ReputationClient(this));
  }

  get yieldVault(): YieldVaultClient {
    return (this._yieldVault ??= new YieldVaultClient(this));
  }

  requireContractId(key: keyof ContractIds): string {
    const id = this.contractIds[key];
    if (!id) {
      throw new JointSaveError("MISSING_CONTRACT", `Contract id "${key}" is not configured`, {
        contract: key,
      });
    }
    return id;
  }

  normalizeContractId(contractId: string): string {
    return contractId.toUpperCase();
  }

  /**
   * Look up a submitted transaction by hash without throwing raw RPC errors.
   *
   * Prefer this after `mayHaveReachedServer()` returns true instead of
   * blindly resubmitting.
   */
  async lookupTransaction(
    hash: string,
    options: Omit<LookupTransactionOptions, "server"> = {}
  ): Promise<TxLookup> {
    return lookupTransaction(hash, { ...options, server: this.server });
  }

  async read<T = unknown>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
    const started = Date.now();
    const tx = this.buildViewTransaction(contractId, method, args);
    this.log({ phase: "build", operation: method, durationMs: Date.now() - started });

    const simulateStarted = Date.now();
    let simulation: rpc.Api.SimulateTransactionResponse;
    try {
      simulation = await this.server.simulateTransaction(tx);
    } catch (error) {
      this.logError(method, error);
      throw toJointSaveError(error, {
        code: "RPC_ERROR",
        message: `Failed to simulate ${method}`,
        method,
        contract: contractId,
      });
    }

    if (rpc.Api.isSimulationError(simulation)) {
      this.logError(method, simulation.error);
      throw new JointSaveError("SIMULATION_FAILED", simulation.error || `Simulation failed for ${method}`, {
        method,
        contract: contractId,
      });
    }

    this.log({
      phase: "simulate",
      operation: method,
      durationMs: Date.now() - simulateStarted,
    });

    const retval = simulation.result?.retval;
    if (!retval) {
      throw new JointSaveError("DECODE_FAILED", `No return value from ${method}`, {
        method,
        contract: contractId,
      });
    }

    return scValToNative(retval) as T;
  }

  async send(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    options: SendOptions
  ): Promise<TxResult> {
    const started = Date.now();
    const timeoutSeconds = options.timeoutSeconds ?? this.timeoutSeconds;
    const confirmTimeoutMs = options.confirmTimeoutMs ?? this.confirmTimeoutMs;

    let account: Account;
    try {
      account = await this.server.getAccount(options.accountId);
    } catch (error) {
      this.logError(method, error);
      throw toJointSaveError(error, {
        code: "ACCOUNT_ERROR",
        message: `Failed to load account ${options.accountId}`,
        method,
        contract: contractId,
      });
    }

    const contract = new Contract(this.normalizeContractId(contractId));
    const tx = new TransactionBuilder(account, {
      fee: options.fee ?? BASE_FEE,
      networkPassphrase: this.networkConfig.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(timeoutSeconds)
      .build();
    this.log({ phase: "build", operation: method, durationMs: Date.now() - started });

    const simulateStarted = Date.now();
    let prepared: Transaction;
    try {
      prepared = await this.server.prepareTransaction(tx);
    } catch (error) {
      this.logError(method, error);
      throw toJointSaveError(error, {
        code: "SIMULATION_FAILED",
        message: `Failed to prepare ${method}`,
        method,
        contract: contractId,
      });
    }
    this.log({
      phase: "simulate",
      operation: method,
      durationMs: Date.now() - simulateStarted,
    });

    let signedXdr: string;
    try {
      signedXdr = await options.signer(prepared.toXDR(), {
        networkPassphrase: this.networkConfig.networkPassphrase,
        accountId: options.accountId,
      });
    } catch (error) {
      this.logError(method, error);
      throw toJointSaveError(error, {
        code: "SIGN_FAILED",
        message: `Failed to sign ${method}`,
        method,
        contract: contractId,
      });
    }
    this.log({ phase: "sign", operation: method, durationMs: Date.now() - started });

    const signed = TransactionBuilder.fromXDR(
      signedXdr,
      this.networkConfig.networkPassphrase
    ) as Transaction;

    let response: rpc.Api.SendTransactionResponse | undefined;
    for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt += 1) {
      try {
        response = await this.server.sendTransaction(signed);
      } catch (error) {
        this.logError(method, error);
        throw toJointSaveError(error, {
          code: "SUBMIT_FAILED",
          message: `Failed to submit ${method}`,
          method,
          contract: contractId,
        });
      }
      if (response.status !== "TRY_AGAIN_LATER") break;
      if (attempt < MAX_SUBMIT_ATTEMPTS) await sleep(this.pollIntervalMs);
    }

    if (!response) {
      throw new JointSaveError("SUBMIT_FAILED", `No response submitting ${method}`, {
        method,
        contract: contractId,
      });
    }

    this.log({
      phase: "submit",
      operation: method,
      hash: response.hash,
      durationMs: Date.now() - started,
    });

    if (response.status === "ERROR") {
      this.log({
        phase: "error",
        operation: method,
        hash: response.hash,
        error: "submission rejected by the network",
      });
      return { hash: response.hash, status: "failed" };
    }
    if (response.status === "TRY_AGAIN_LATER") {
      this.logError(method, `Network kept deferring ${method}`);
      throw new JointSaveError("SUBMIT_FAILED", `Network kept deferring ${method}`, {
        method,
        contract: contractId,
      });
    }

    return this.pollForConfirmation(response.hash, method, confirmTimeoutMs);
  }

  private buildViewTransaction(contractId: string, method: string, args: xdr.ScVal[]): Transaction {
    const account = new Account(DUMMY_ACCOUNT, "0");
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkConfig.networkPassphrase,
    })
      .addOperation(new Contract(this.normalizeContractId(contractId)).call(method, ...args))
      .setTimeout(this.timeoutSeconds)
      .build();
  }

  private async pollForConfirmation(
    hash: string,
    method: string,
    confirmTimeoutMs: number
  ): Promise<TxResult> {
    const started = Date.now();
    while (Date.now() - started <= confirmTimeoutMs) {
      let result: rpc.Api.GetTransactionResponse;
      try {
        result = await this.server.getTransaction(hash);
      } catch (error) {
        this.logError(method, error, { hash });
        if (Date.now() - started >= confirmTimeoutMs) break;
        await sleep(this.pollIntervalMs);
        continue;
      }

      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        this.log({
          phase: "confirm",
          operation: method,
          hash,
          ledger: result.ledger,
          durationMs: Date.now() - started,
        });
        return { hash, status: "success", ledger: result.ledger };
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        this.log({
          phase: "error",
          operation: method,
          hash,
          ledger: result.ledger,
          error: "transaction failed on-chain",
        });
        return { hash, status: "failed", ledger: result.ledger };
      }
      await sleep(this.pollIntervalMs);
    }

    this.log({
      phase: "error",
      operation: method,
      hash,
      durationMs: Date.now() - started,
      error: "confirmation timed out",
    });
    return { hash, status: "timeout" };
  }

  private logError(
    operation: string,
    error: unknown,
    extra: { hash?: string; ledger?: number } = {}
  ): void {
    const diagnostic = classifyContractError(error);
    const message =
      diagnostic !== null
        ? `${diagnostic.code}: ${diagnostic.message}`
        : errorMessage(error);

    const event: TxLogEvent = { phase: "error", operation, error: message };
    if (extra.hash !== undefined) event.hash = extra.hash;
    if (extra.ledger !== undefined) event.ledger = extra.ledger;
    this.log(event);
  }

  private log(event: TxLogEvent): void {
    if (!this.logger) return;
    try {
      this.logger(redactLogEvent(event));
    } catch {
      // Logging must never break a transaction.
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
