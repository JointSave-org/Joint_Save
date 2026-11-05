import type { xdr } from "@stellar/stellar-sdk";
import { JointSaveError } from "../errors";
import { scAddress, scI128 } from "../scval";
import type {
  FlexiblePoolState,
  PoolState,
  PoolType,
  RotationalPoolState,
  TargetPoolState,
  TxResult,
} from "../types";
import type { ContractCaller, SendOptions } from "./base";

export interface RoundSummary {
  index: number;
  nextPayoutTime: number;
  depositAmount: bigint;
  roundDuration: number;
}

export interface DepositParams {
  member: string;
  /** Required for target and flexible pools; ignored for rotational pools. */
  amount?: bigint;
}

export interface WithdrawParams {
  member: string;
  /** Required for flexible pools. */
  amount?: bigint;
}

function toNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(String(value));
}

export class PoolClient {
  private readonly client: ContractCaller;

  constructor(client: ContractCaller) {
    this.client = client;
  }

  async getState(
    poolType: PoolType,
    poolId: string,
    options: { member?: string } = {}
  ): Promise<PoolState> {
    switch (poolType) {
      case "rotational":
        return this.getRotationalState(poolId, options.member);
      case "target":
        return this.getTargetState(poolId, options.member);
      case "flexible":
        return this.getFlexibleState(poolId, options.member);
      default: {
        const exhaustive: never = poolType;
        throw new JointSaveError("INVALID_ARGUMENT", `Unknown pool type: ${String(exhaustive)}`, {
          method: "getState",
          contract: poolId,
        });
      }
    }
  }

  async getRotationalState(poolId: string, member?: string): Promise<RotationalPoolState> {
    const [isActive, currentRound, members, nextPayoutTime, contractVersion] = await Promise.all([
      this.client.read<boolean>(poolId, "is_active"),
      this.client.read<number>(poolId, "current_round"),
      this.client.read<string[]>(poolId, "members"),
      this.client.read<bigint>(poolId, "next_payout_time"),
      this.readOptional<number | null>(poolId, "get_version", [], null),
    ]);

    const hasDeposited = member
      ? await this.client.read<boolean>(poolId, "has_deposited", [scAddress(member)])
      : false;

    return {
      isActive,
      currentRound: toNumber(currentRound),
      members,
      nextPayoutTime: toNumber(nextPayoutTime),
      hasDeposited,
      depositCount: 0,
      treasuryFeeBps: null,
      relayerFeeBps: null,
      contractVersion: contractVersion === null ? null : toNumber(contractVersion),
    };
  }

  async getTargetState(poolId: string, member?: string): Promise<TargetPoolState> {
    const [isUnlocked, totalDeposited, targetAmount, deadlineLedger, contractVersion, userBalance] =
      await Promise.all([
        this.client.read<boolean>(poolId, "is_unlocked"),
        this.client.read<bigint>(poolId, "total_deposited"),
        this.client.read<bigint>(poolId, "target_amount"),
        this.client.read<number>(poolId, "deadline"),
        this.readOptional<number | null>(poolId, "get_version", [], null),
        member
          ? this.client.read<bigint>(poolId, "balance_of", [scAddress(member)])
          : Promise.resolve(0n),
      ]);

    return {
      isUnlocked,
      totalDeposited: toBigInt(totalDeposited),
      targetAmount: toBigInt(targetAmount),
      userBalance: toBigInt(userBalance),
      deadlineLedger: toNumber(deadlineLedger),
      contractVersion: contractVersion === null ? null : toNumber(contractVersion),
    };
  }

  async getFlexibleState(poolId: string, member?: string): Promise<FlexiblePoolState> {
    const [isActive, totalBalance, contractVersion, userBalance] = await Promise.all([
      this.client.read<boolean>(poolId, "is_active"),
      this.client.read<bigint>(poolId, "total_balance"),
      this.readOptional<number | null>(poolId, "get_version", [], null),
      member
        ? this.client.read<bigint>(poolId, "balance_of", [scAddress(member)])
        : Promise.resolve(0n),
    ]);

    return {
      isActive,
      totalBalance: toBigInt(totalBalance),
      userBalance: toBigInt(userBalance),
      contractVersion: contractVersion === null ? null : toNumber(contractVersion),
    };
  }

  async getMembers(poolId: string): Promise<string[]> {
    return this.client.read<string[]>(poolId, "members");
  }

  async getRound(poolId: string): Promise<RoundSummary> {
    const [index, nextPayoutTime, depositAmount, roundDuration] = await Promise.all([
      this.client.read<number>(poolId, "current_round"),
      this.client.read<bigint>(poolId, "next_payout_time"),
      this.client.read<bigint>(poolId, "deposit_amount"),
      this.client.read<bigint>(poolId, "round_duration"),
    ]);
    return {
      index: toNumber(index),
      nextPayoutTime: toNumber(nextPayoutTime),
      depositAmount: toBigInt(depositAmount),
      roundDuration: toNumber(roundDuration),
    };
  }

  async balanceOf(poolType: PoolType, poolId: string, member: string): Promise<bigint> {
    if (poolType === "target" || poolType === "flexible") {
      return toBigInt(
        await this.client.read<bigint>(poolId, "balance_of", [scAddress(member)])
      );
    }
    const [hasDeposited, depositAmount] = await Promise.all([
      this.client.read<boolean>(poolId, "has_deposited", [scAddress(member)]),
      this.client.read<bigint>(poolId, "deposit_amount"),
    ]);
    return hasDeposited ? toBigInt(depositAmount) : 0n;
  }

  async deposit(poolType: PoolType, poolId: string, params: DepositParams, options: SendOptions): Promise<TxResult> {
    if (poolType === "rotational") {
      return this.client.send(poolId, "deposit", [scAddress(params.member)], options);
    }
    if (params.amount === undefined) {
      throw new JointSaveError("INVALID_ARGUMENT", "amount is required for target and flexible deposits", {
        method: "deposit",
        contract: poolId,
      });
    }
    return this.client.send(
      poolId,
      "deposit",
      [scAddress(params.member), scI128(params.amount)],
      options
    );
  }

  async contribute(
    poolType: PoolType,
    poolId: string,
    params: DepositParams,
    options: SendOptions
  ): Promise<TxResult> {
    return this.deposit(poolType, poolId, params, options);
  }

  async withdraw(
    poolType: PoolType,
    poolId: string,
    params: WithdrawParams,
    options: SendOptions
  ): Promise<TxResult> {
    if (poolType === "rotational") {
      throw new JointSaveError(
        "UNSUPPORTED",
        "Rotational pools pay out via triggerPayout; members cannot withdraw directly",
        { method: "withdraw", contract: poolId }
      );
    }
    if (poolType === "target") {
      return this.client.send(poolId, "withdraw", [scAddress(params.member)], options);
    }
    if (params.amount === undefined) {
      throw new JointSaveError("INVALID_ARGUMENT", "amount is required for flexible withdrawals", {
        method: "withdraw",
        contract: poolId,
      });
    }
    return this.client.send(
      poolId,
      "withdraw",
      [scAddress(params.member), scI128(params.amount)],
      options
    );
  }

  async claim(
    poolType: PoolType,
    poolId: string,
    params: WithdrawParams,
    options: SendOptions
  ): Promise<TxResult> {
    return this.withdraw(poolType, poolId, params, options);
  }

  async triggerPayout(poolId: string, relayer: string, options: SendOptions): Promise<TxResult> {
    return this.client.send(poolId, "trigger_payout", [scAddress(relayer)], options);
  }

  private async readOptional<T>(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    fallback: T
  ): Promise<T> {
    try {
      return await this.client.read<T>(contractId, method, args);
    } catch {
      return fallback;
    }
  }
}
