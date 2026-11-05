import type {
  GovernanceProposalStatus,
  GovernanceProposalType,
  PoolStatus,
  PoolType,
} from "../types";
import type {
  GovernanceProposalSummary,
  Page,
  PoolActivityItem,
  PoolDetail,
  PoolEvent,
  PoolMemberSummary,
  PoolSummary,
  PortfolioPoolSummary,
  PortfolioSummary,
  ProtocolDayData,
  ProtocolPoolSummary,
  ProtocolSummary,
  ReputationLeaderboardEntry,
  ReputationProfile,
  UpcomingCommitment,
} from "./models";

/** Minimal `fetch` surface used by {@link DataClient}. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Minimal `fetch` implementation, compatible with the global `fetch`. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<FetchResponse>;

export interface DataClientOptions {
  /** Origin of the JointSave app/indexer, e.g. `https://jointsave.app`. */
  baseUrl: string;
  /** Override the fetch implementation (tests, custom runtimes). */
  fetch?: FetchLike;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds. `0` disables the timeout. Default: `15000`. */
  timeoutMs?: number;
  /** Optional external abort signal. */
  signal?: AbortSignal;
  /** Custom request-id generator. Defaults to `crypto.randomUUID()` when available. */
  requestId?: () => string | undefined;
  /** Called with the generated request id before each request. */
  onRequestId?: (requestId: string) => void;
}

export interface ListPoolsParams {
  status?: PoolStatus;
  type?: PoolType;
  cursor?: string;
  limit?: number;
}

export interface PoolHistoryParams {
  cursor?: string;
  limit?: number;
}

export interface ReputationLeaderboardParams {
  top?: number;
  cursor?: string;
  limit?: number;
}

export interface GovernanceProposalParams {
  poolId?: string;
  proposalId?: string;
  status?: GovernanceProposalStatus;
  cursor?: string;
  limit?: number;
}

/** Machine-readable failure raised by {@link DataClient}. */
export class DataClientError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly requestId: string | null;
  readonly body: unknown;
  readonly cause: unknown;

  constructor(
    message: string,
    context: {
      status?: number | null;
      code?: string;
      requestId?: string | null | undefined;
      body?: unknown;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "DataClientError";
    this.status = context.status ?? null;
    this.code = context.code ?? "DATA_CLIENT_ERROR";
    this.requestId = context.requestId ?? null;
    this.body = context.body;
    this.cause = context.cause;
    Object.setPrototypeOf(this, DataClientError.prototype);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

const POOL_TYPES: readonly PoolType[] = ["rotational", "target", "flexible"];
const POOL_STATUSES: readonly PoolStatus[] = [
  "pending_deployment",
  "active",
  "paused",
  "completed",
  "archived",
];
const PROPOSAL_TYPES: readonly GovernanceProposalType[] = [
  "ChangeDepositAmount",
  "ExtendDeadline",
  "AddPenalty",
  "RemovePenalty",
  "ChangeQuorum",
  "Custom",
  "YieldAllocation",
];
const PROPOSAL_STATUSES: readonly GovernanceProposalStatus[] = [
  "Active",
  "Passed",
  "Executed",
  "Expired",
  "Rejected",
];

type QueryValue = string | number | boolean | undefined;
type Query = Record<string, QueryValue>;
type JsonRecord = Record<string, unknown>;

/**
 * Typed HTTP read client for the JointSave app/indexer.
 *
 * Uses only `fetch` + `AbortController`; no React Query, Supabase, or DOM
 * globals. Safe in Node 18+ and browsers.
 */
export class DataClient {
  private readonly baseUrl: string;
  private readonly options: DataClientOptions;
  private readonly timeoutMs: number;

  constructor(options: DataClientOptions) {
    if (!options.baseUrl) {
      throw new DataClientError("A baseUrl is required", { code: "INVALID_ARGUMENT" });
    }
    this.options = options;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async listPools(params: ListPoolsParams = {}): Promise<Page<PoolSummary>> {
    const payload = await this.request("/api/pools", {
      status: params.status,
      type: params.type,
      cursor: params.cursor,
      page: pageCursor(params.cursor),
      limit: params.limit,
    });
    return parsePage(payload, normalizePoolSummary);
  }

  async getPool(id: string): Promise<PoolDetail> {
    try {
      const payload = await this.request(`/api/pools/${encodeURIComponent(id)}`);
      return normalizePoolDetail(unwrap(payload));
    } catch (error) {
      if (!(error instanceof DataClientError) || error.status !== 404) throw error;
      const payload = await this.request("/api/pools", { id });
      return normalizePoolDetail(unwrap(payload));
    }
  }

  async getPoolHistory(
    id: string,
    params: PoolHistoryParams = {}
  ): Promise<Page<PoolEvent>> {
    const payload = await this.request("/api/pools/history", {
      poolId: id,
      poolIds: id,
      cursor: params.cursor,
      limit: params.limit,
    });
    if (isSparklineHistory(payload)) {
      return this.getPoolActivity(id, params);
    }
    return parsePage(payload, (raw) => normalizePoolEvent(raw, id));
  }

  async getProtocolSummary(): Promise<ProtocolSummary> {
    const payload = unwrap(
      await this.request("/api/v1/protocol/summary")
    );
    return normalizeProtocolSummary(payload);
  }

  async getReputation(address: string): Promise<ReputationProfile> {
    const payload = unwrap(await this.request("/api/reputation", { address }));
    return normalizeReputation(payload, address);
  }

  async getReputationLeaderboard(
    params: ReputationLeaderboardParams = {}
  ): Promise<Page<ReputationLeaderboardEntry>> {
    const payload = await this.request("/api/reputation/leaderboard", {
      top: params.top ?? params.limit,
      cursor: params.cursor,
      limit: params.limit,
    });
    return parsePage(payload, normalizeReputationEntry);
  }

  async getGovernanceProposals(
    params: GovernanceProposalParams = {}
  ): Promise<Page<GovernanceProposalSummary>> {
    const payload = await this.request("/api/governance", {
      pool_id: params.poolId,
      proposal_id: params.proposalId,
      status: params.status,
      cursor: params.cursor,
      limit: params.limit,
    });
    return parsePage(payload, normalizeGovernanceProposal);
  }

  async getPortfolioSummary(address: string): Promise<PortfolioSummary> {
    const payload = unwrap(
      await this.request("/api/portfolio/summary", { wallet: address })
    );
    return normalizePortfolioSummary(payload);
  }

  private async getPoolActivity(
    id: string,
    params: PoolHistoryParams
  ): Promise<Page<PoolEvent>> {
    const payload = await this.request(
      `/api/pools/${encodeURIComponent(id)}/activity`,
      { page: pageCursor(params.cursor), limit: params.limit }
    );
    return parsePage(payload, (raw) => normalizePoolEvent(raw, id));
  }

  private async request(path: string, query: Query = {}): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const requestId = this.createRequestId();
    if (requestId) {
      try {
        this.options.onRequestId?.(requestId);
      } catch {
        // Observability callbacks must not break requests.
      }
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      ...this.options.headers,
    };
    if (requestId) headers["x-request-id"] = requestId;

    if (this.options.signal?.aborted) {
      throw new DataClientError("Request aborted", {
        code: "ABORTED",
        requestId,
      });
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    this.options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;

    try {
      const response = await this.fetchImpl()(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      const body = await readJson(response);

      if (!response.ok) {
        throw new DataClientError(errorMessage(body, response.status), {
          status: response.status,
          code: errorCode(body, response.status),
          requestId,
          body,
        });
      }

      return body;
    } catch (error) {
      if (error instanceof DataClientError) throw error;

      const aborted = controller.signal.aborted;
      const externalAbort = this.options.signal?.aborted === true;
      throw new DataClientError(
        aborted ? "Request timed out" : "Network request failed",
        {
          code: externalAbort ? "ABORTED" : aborted ? "TIMEOUT" : "NETWORK_ERROR",
          requestId,
          cause: error,
        }
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.options.signal?.removeEventListener("abort", onAbort);
    }
  }

  private fetchImpl(): FetchLike {
    const impl =
      this.options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!impl) {
      throw new DataClientError("No fetch implementation available", {
        code: "NETWORK_ERROR",
      });
    }
    return impl;
  }

  private buildUrl(path: string, query: Query): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue;
      params.set(key, String(value));
    }
    const suffix = params.toString();
    return `${this.baseUrl}${path}${suffix ? `?${suffix}` : ""}`;
  }

  private createRequestId(): string | undefined {
    try {
      const custom = this.options.requestId?.();
      if (custom) return custom;
      const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
      if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    } catch {
      // Web Crypto may be unavailable or blocked.
    }
    return undefined;
  }
}

function pageCursor(cursor: string | undefined): string | undefined {
  return cursor !== undefined && /^\d+$/.test(cursor) ? cursor : undefined;
}

function readJson(response: FetchResponse): Promise<unknown> {
  return response.json().catch(() => undefined);
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function pick(record: JsonRecord | undefined, ...keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableNumber(value: unknown): number | null {
  const parsed = numberValue(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function unixSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
    const millis = Date.parse(value);
    if (Number.isFinite(millis)) return Math.floor(millis / 1000);
  }
  return null;
}

function numberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    const parsed = nullableNumber(item);
    if (parsed !== null) out[key] = parsed;
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function unwrap(value: unknown): unknown {
  const record = asRecord(value);
  if (record) {
    if (record.data !== undefined) return record.data;
    if (record.pool !== undefined) return record.pool;
  }
  return value;
}

function parsePage<T>(
  payload: unknown,
  normalize: (raw: unknown) => T
): Page<T> {
  if (Array.isArray(payload)) {
    return {
      items: payload.map(normalize),
      nextCursor: null,
      hasMore: false,
      total: payload.length,
    };
  }

  const root = asRecord(payload);
  const itemsRaw = Array.isArray(root?.items)
    ? root.items
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.activities)
        ? root.activities
        : [];

  const items = itemsRaw.map(normalize);
  const total = nullableNumber(pick(root, "total"));
  const page = nullableNumber(pick(root, "page"));
  const pageSize = nullableNumber(pick(root, "pageSize", "page_size"));
  const providedHasMore = pick(root, "hasMore", "has_more");
  const hasMore =
    typeof providedHasMore === "boolean"
      ? providedHasMore
      : total !== null && page !== null && pageSize !== null
        ? page * pageSize < total
        : false;

  const providedCursor = pick(root, "nextCursor", "next_cursor");
  const nextCursor =
    typeof providedCursor === "string"
      ? providedCursor
      : hasMore && page !== null
        ? String(page + 1)
        : null;

  const out: Page<T> = { items, nextCursor, hasMore };
  if (total !== null) out.total = total;
  return out;
}

function isSparklineHistory(payload: unknown): boolean {
  const root = asRecord(payload);
  if (!root || root.history === undefined) return false;
  return !Array.isArray(root.activities) && !Array.isArray(root.data);
}

function poolTypeOf(value: unknown): PoolType {
  return enumValue(value, POOL_TYPES, "rotational");
}

function poolStatusOf(value: unknown, archivedAt: string | null): PoolStatus {
  if (value === "pending") return "pending_deployment";
  if (typeof value === "string" && (POOL_STATUSES as readonly string[]).includes(value)) {
    return value as PoolStatus;
  }
  return archivedAt ? "archived" : "active";
}

function normalizePoolSummary(value: unknown): PoolSummary {
  const raw = asRecord(value) ?? {};
  const contractAddress = stringValue(
    pick(raw, "contract_address", "contractAddress", "pool_address", "poolAddress")
  );
  const archivedAt = nullableString(pick(raw, "archived_at", "archivedAt"));
  const members = arrayValue(pick(raw, "members", "pool_members"));

  return {
    id: stringValue(pick(raw, "id", "pool_id", "poolId"), contractAddress),
    contractAddress,
    name: stringValue(pick(raw, "name")),
    description: nullableString(pick(raw, "description")),
    type: poolTypeOf(pick(raw, "type", "pool_type", "poolType")),
    status: poolStatusOf(pick(raw, "status"), archivedAt),
    creatorAddress: stringValue(
      pick(raw, "creator_address", "creatorAddress", "creator")
    ),
    tokenAddress: nullableString(pick(raw, "token_address", "tokenAddress")),
    tokenSymbol: nullableString(pick(raw, "token_symbol", "tokenSymbol")),
    tokenDecimals: numberValue(pick(raw, "token_decimals", "tokenDecimals"), 7),
    membersCount: numberValue(
      pick(raw, "members_count", "membersCount"),
      members.length
    ),
    contributionAmount: nullableNumber(
      pick(raw, "contribution_amount", "contributionAmount")
    ),
    targetAmount: nullableNumber(pick(raw, "target_amount", "targetAmount")),
    totalSaved: numberValue(pick(raw, "total_saved", "totalSaved"), 0),
    minimumDeposit: nullableNumber(
      pick(raw, "minimum_deposit", "minimumDeposit")
    ),
    yieldEnabled: booleanValue(pick(raw, "yield_enabled", "yieldEnabled"), false),
    deadline: nullableString(pick(raw, "deadline")),
    nextPayout: nullableString(pick(raw, "next_payout", "nextPayout")),
    createdAt: nullableString(pick(raw, "created_at", "createdAt")),
    archivedAt,
  };
}

function normalizePoolMember(value: unknown): PoolMemberSummary {
  const raw = asRecord(value) ?? {};
  return {
    id: stringValue(pick(raw, "id", "member_id", "memberId")),
    address: stringValue(
      pick(raw, "member_address", "memberAddress", "address")
    ),
    contributionAmount: numberValue(
      pick(raw, "contribution_amount", "contributionAmount"),
      0
    ),
    status: stringValue(pick(raw, "status"), "pending"),
  };
}

function normalizePoolActivity(value: unknown): PoolActivityItem {
  const raw = asRecord(value) ?? {};
  return {
    id: stringValue(pick(raw, "id")),
    activityType: stringValue(pick(raw, "activity_type", "activityType", "type")),
    userAddress: nullableString(
      pick(raw, "user_address", "userAddress", "member")
    ),
    amount: nullableNumber(pick(raw, "amount")),
    description: nullableString(pick(raw, "description")),
    createdAt: stringValue(pick(raw, "created_at", "createdAt")),
    txHash: nullableString(pick(raw, "tx_hash", "txHash")),
  };
}

function normalizePoolDetail(value: unknown): PoolDetail {
  const raw = asRecord(Array.isArray(value) ? value[0] : value) ?? {};
  const members = arrayValue(pick(raw, "pool_members", "members")).map(
    normalizePoolMember
  );
  const activity = arrayValue(pick(raw, "pool_activity", "activity")).map(
    normalizePoolActivity
  );
  return { ...normalizePoolSummary(raw), members, activity };
}

function normalizePoolEvent(value: unknown, fallbackPoolId: string): PoolEvent {
  const raw = asRecord(value) ?? {};
  const activity = normalizePoolActivity(raw);
  return {
    id: activity.id,
    poolId: stringValue(pick(raw, "pool_id", "poolId"), fallbackPoolId),
    activityType: activity.activityType,
    userAddress: activity.userAddress,
    amount: activity.amount,
    description: activity.description,
    createdAt: activity.createdAt,
    txHash: activity.txHash,
  };
}

function normalizeProtocolDay(value: unknown): ProtocolDayData {
  const raw = asRecord(value) ?? {};
  return {
    date: stringValue(pick(raw, "date"), ""),
    tvlUsd: numberValue(pick(raw, "tvlUSD", "tvlUsd"), 0),
    dailyVolumeUsd: numberValue(
      pick(raw, "dailyVolumeUSD", "dailyVolumeUsd"),
      0
    ),
  };
}

function normalizeProtocolPool(value: unknown): ProtocolPoolSummary {
  const raw = asRecord(value) ?? {};
  return {
    id: stringValue(pick(raw, "id")),
    totalValueLockedUsd: numberValue(
      pick(raw, "totalValueLockedUSD", "totalValueLockedUsd"),
      0
    ),
    volumeUsd: numberValue(pick(raw, "volumeUSD", "volumeUsd"), 0),
    isActive: booleanValue(pick(raw, "isActive", "is_active"), false),
  };
}

function normalizeProtocolSummary(value: unknown): ProtocolSummary {
  const raw = asRecord(value) ?? {};
  const protocol = asRecord(arrayValue(pick(raw, "protocols"))[0]) ?? {};
  return {
    totalValueLockedUsd: numberValue(
      pick(protocol, "totalValueLockedUSD", "totalValueLockedUsd"),
      0
    ),
    totalVolumeUsd: numberValue(
      pick(protocol, "totalVolumeUSD", "totalVolumeUsd"),
      0
    ),
    activePools: numberValue(
      pick(protocol, "activePoolsCount", "activePools"),
      0
    ),
    totalMembers: numberValue(pick(protocol, "totalMembers"), 0),
    days: arrayValue(pick(raw, "protocolDayDatas", "days")).map(
      normalizeProtocolDay
    ),
    topPools: arrayValue(pick(raw, "pools", "topPools")).map(
      normalizeProtocolPool
    ),
  };
}

function normalizeReputation(value: unknown, fallbackAddress: string): ReputationProfile {
  const raw = asRecord(value) ?? {};
  const totalDeposits = numberValue(pick(raw, "total_deposits", "totalDeposits"), 0);
  return {
    address: stringValue(pick(raw, "address", "wallet", "member"), fallbackAddress),
    totalScore: numberValue(pick(raw, "total_score", "totalScore"), 0),
    depositReliability: numberValue(
      pick(raw, "deposit_reliability", "depositReliability"),
      0
    ),
    poolsCompleted: numberValue(
      pick(raw, "pools_completed", "poolsCompleted"),
      0
    ),
    poolsJoined: numberValue(pick(raw, "pools_joined", "poolsJoined"), 0),
    totalDeposits,
    missedDeposits: numberValue(
      pick(raw, "missed_deposits", "missedDeposits"),
      0
    ),
    lastActivity: numberValue(pick(raw, "last_activity", "lastActivity"), 0),
    scoreUpdatedAt: numberValue(
      pick(raw, "score_updated_at", "scoreUpdatedAt"),
      0
    ),
    isProvisional: booleanValue(
      pick(raw, "is_provisional", "isProvisional"),
      totalDeposits < 10
    ),
  };
}

function normalizeReputationEntry(value: unknown): ReputationLeaderboardEntry {
  const raw = asRecord(value) ?? {};
  return {
    ...normalizeReputation(raw, ""),
    rank: numberValue(pick(raw, "rank"), 0),
  };
}

function normalizeGovernanceProposal(value: unknown): GovernanceProposalSummary {
  const raw = asRecord(value) ?? {};
  const votesForRaw = pick(raw, "votes_for", "votesFor", "for_votes");
  const votesAgainstRaw = pick(
    raw,
    "votes_against",
    "votesAgainst",
    "against_votes"
  );
  const out: GovernanceProposalSummary = {
    id: stringValue(pick(raw, "id", "proposal_id", "proposalId")),
    poolId: nullableString(pick(raw, "pool_id", "poolId")),
    proposalType: enumValue(
      pick(raw, "proposal_type", "proposalType", "type"),
      PROPOSAL_TYPES,
      "Custom"
    ),
    description: stringValue(pick(raw, "description")),
    status: enumValue(
      pick(raw, "status"),
      PROPOSAL_STATUSES,
      "Active"
    ),
    votesFor: Array.isArray(votesForRaw)
      ? votesForRaw.length
      : numberValue(votesForRaw, 0),
    votesAgainst: Array.isArray(votesAgainstRaw)
      ? votesAgainstRaw.length
      : numberValue(votesAgainstRaw, 0),
    createdAt: unixSeconds(pick(raw, "created_at", "createdAt")),
    expiresAt: unixSeconds(
      pick(raw, "expires_at", "expiresAt", "deadline")
    ),
  };

  const parameters = stringRecord(pick(raw, "parameters"));
  if (parameters) out.parameters = parameters;
  return out;
}

function normalizeUpcomingCommitment(value: unknown): UpcomingCommitment {
  const raw = asRecord(value) ?? {};
  return {
    poolId: stringValue(pick(raw, "pool_id", "poolId")),
    poolName: stringValue(pick(raw, "pool_name", "poolName")),
    amount: numberValue(pick(raw, "amount"), 0),
    deadline: stringValue(pick(raw, "deadline")),
    type: stringValue(pick(raw, "type"), "rotational"),
  };
}

function normalizePortfolioPool(value: unknown): PortfolioPoolSummary {
  const raw = asRecord(value) ?? {};
  return {
    id: stringValue(pick(raw, "id", "pool_id", "poolId")),
    name: stringValue(pick(raw, "name")),
    type: poolTypeOf(pick(raw, "type", "pool_type", "poolType")),
    status: poolStatusOf(pick(raw, "status"), null),
    contribution: numberValue(pick(raw, "contribution"), 0),
    totalBalance: numberValue(pick(raw, "total_balance", "totalBalance"), 0),
    healthScore: nullableNumber(pick(raw, "health_score", "healthScore")),
    nextAction: nullableString(pick(raw, "next_action", "nextAction")),
  };
}

function normalizePortfolioSummary(value: unknown): PortfolioSummary {
  const raw = asRecord(value) ?? {};
  const totalPools = asRecord(pick(raw, "total_pools", "totalPools")) ?? {};
  const reputation =
    asRecord(pick(raw, "reputation_summary", "reputationSummary")) ?? {};

  return {
    totalSaved: numberValue(pick(raw, "total_saved", "totalSaved"), 0),
    totalSavedByToken: numberRecord(
      pick(raw, "total_saved_by_token", "totalSavedByToken")
    ),
    totalPools: {
      rotational: numberValue(pick(totalPools, "rotational"), 0),
      target: numberValue(pick(totalPools, "target"), 0),
      flexible: numberValue(pick(totalPools, "flexible"), 0),
      total: numberValue(pick(totalPools, "total"), 0),
    },
    totalYieldEarned: numberValue(
      pick(raw, "total_yield_earned", "totalYieldEarned"),
      0
    ),
    upcomingCommitments: arrayValue(
      pick(raw, "upcoming_commitments", "upcomingCommitments")
    ).map(normalizeUpcomingCommitment),
    reputationSummary: {
      totalDeposits: numberValue(
        pick(reputation, "total_deposits", "totalDeposits"),
        0
      ),
      averageOnTimeRate: numberValue(
        pick(reputation, "average_on_time_rate", "averageOnTimeRate"),
        100
      ),
      poolsCompleted: numberValue(
        pick(reputation, "pools_completed", "poolsCompleted"),
        0
      ),
    },
    pools: arrayValue(pick(raw, "pools")).map(normalizePortfolioPool),
  };
}

function errorCode(body: unknown, status: number): string {
  const record = asRecord(body);
  const code = pick(record, "code", "error_code", "errorCode");
  return typeof code === "string" && code.length > 0 ? code : `HTTP_${status}`;
}

function errorMessage(body: unknown, status: number): string {
  const record = asRecord(body);
  const message = pick(record, "error", "message", "detail");
  return typeof message === "string" && message.length > 0
    ? message
    : `HTTP ${status}`;
}
