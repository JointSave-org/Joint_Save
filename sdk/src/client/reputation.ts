import { scAddress, scAddressVec, scU32 } from "../scval";
import type { ReputationData, ReputationScore } from "../types";
import type { ContractCaller } from "./base";

export interface LeaderboardEntry {
  address: string;
  data: ReputationData;
}

const PROVISIONAL_THRESHOLD = 10;

function toNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(String(value ?? 0));
}

function decodeReputationData(raw: unknown): ReputationData {
  const value = raw as Record<string, unknown>;
  const totalDeposits = toNumber(value.total_deposits);
  return {
    totalScore: toNumber(value.total_score),
    depositReliability: toNumber(value.deposit_reliability),
    poolsCompleted: toNumber(value.pools_completed),
    poolsJoined: toNumber(value.pools_joined),
    totalDeposits,
    missedDeposits: toNumber(value.missed_deposits),
    totalDepositAmount: toBigInt(value.total_deposit_amount),
    lastActivity: toNumber(value.last_activity),
    scoreUpdatedAt: toNumber(value.score_updated_at),
    isProvisional: totalDeposits < PROVISIONAL_THRESHOLD,
  };
}

function decodeLegacyScore(raw: unknown): ReputationScore {
  const value = raw as Record<string, unknown>;
  return {
    totalDeposits: toBigInt(value.total_deposits),
    poolsCompleted: toNumber(value.pools_completed),
    missedRounds: toNumber(value.missed_rounds),
    onTimeRate: toNumber(value.on_time_rate),
  };
}

export class ReputationClient {
  readonly contractId: string;
  private readonly client: ContractCaller;

  constructor(client: ContractCaller) {
    this.client = client;
    this.contractId = client.requireContractId("reputation");
  }

  async getMemberScore(member: string): Promise<ReputationData> {
    const raw = await this.client.read<unknown>(this.contractId, "get_member_score", [
      scAddress(member),
    ]);
    return decodeReputationData(raw);
  }

  async getMembersScores(members: string[]): Promise<ReputationData[]> {
    const raw = await this.client.read<unknown[]>(this.contractId, "get_members_scores", [
      scAddressVec(members),
    ]);
    return raw.map(decodeReputationData);
  }

  async getScore(member: string): Promise<ReputationScore> {
    const raw = await this.client.read<unknown>(this.contractId, "get_reputation", [
      scAddress(member),
    ]);
    return decodeLegacyScore(raw);
  }

  async getLeaderboard(topN: number): Promise<LeaderboardEntry[]> {
    const raw = await this.client.read<unknown[]>(this.contractId, "get_score_leaderboard", [
      scU32(topN),
    ]);
    return raw.map((entry) => {
      const tuple = entry as [string, unknown];
      return { address: String(tuple[0]), data: decodeReputationData(tuple[1]) };
    });
  }
}
