/**
 * Typed DataClient for JointSave REST routes and indexer.
 *
 * Implements Issue #278: typed data/indexer client + versioned OpenAPI HTTP contract.
 */

import type {
  GovernanceProposal,
  ReputationData,
} from "../types";

/** Generic paginated container matching the SDK contract. */
export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly total?: number;
}

/** Summary record for savings pools returned by /api/pools. */
export interface PoolSummary {
  readonly id: string;
  readonly name?: string;
  readonly poolType: "rotational" | "target" | "flexible";
  readonly status: string;
  readonly creatorAddress?: string;
  readonly poolAddress?: string;
  readonly tokenAddress?: string;
  readonly tokenSymbol?: string;
  readonly totalDeposited?: string;
  readonly memberCount?: number;
  readonly createdAt?: string;
}

/** Full pool detail returned by /api/pools/:id. */
export interface PoolDetail extends PoolSummary {
  readonly description?: string;
  readonly members?: readonly string[];
  readonly cycleDurationLedgers?: number;
  readonly currentRound?: number;
  readonly depositAmount?: string;
  readonly targetAmount?: string;
}

/** Event record for pool sparkline/history returned by /api/pools/history. */
export interface PoolEvent {
  readonly id: string;
  readonly poolId: string;
  readonly type: string;
  readonly actor?: string;
  readonly amount?: string | number | null;
  readonly timestamp: number;
  readonly txHash?: string | null;
}

/** Protocol summary response matching /api/v1/protocol/summary. */
export interface ProtocolSummary {
  readonly protocols: ReadonlyArray<{
    readonly totalValueLockedUSD: string;
    readonly totalVolumeUSD: string;
    readonly activePoolsCount: number;
    readonly totalMembers: number;
  }>;
  readonly protocolDayDatas?: ReadonlyArray<{
    readonly date: number | string;
    readonly tvlUSD: string;
    readonly dailyVolumeUSD: string;
  }>;
  readonly pools?: ReadonlyArray<{
    readonly id: string;
    readonly totalValueLockedUSD: string;
    readonly volumeUSD: string;
    readonly isActive: boolean;
  }>;
}

/** Portfolio summary response matching /api/portfolio/summary. */
export interface PortfolioSummary {
  readonly wallet: string;
  readonly totalBalanceUSD?: number;
  readonly activePoolsCount?: number;
  readonly memberships?: ReadonlyArray<{
    readonly pool_id: string;
    readonly role?: string;
    readonly joined_at?: string;
    readonly pool?: PoolSummary;
  }>;
}

/** Options accepted by `DataClient`. */
export interface DataClientOptions {
  /** Base URL of the JointSave web app / indexer, e.g. "https://jointsave.org" */
  readonly baseUrl: string;
  /** Custom fetch implementation (defaults to `globalThis.fetch`). */
  readonly fetch?: typeof globalThis.fetch;
  /** Additional HTTP headers to send with every request. */
  readonly headers?: Record<string, string>;
  /** Request timeout in milliseconds (defaults to 10,000 ms). */
  readonly timeoutMs?: number;
  /** Callback invoked with each generated request ID for tracing/diagnostics. */
  readonly onRequestId?: (requestId: string) => void;
}

/** Structured error thrown for non-2xx HTTP responses or timeouts. */
export class DataClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "DataClientError";
    this.status = status;
    this.code = code;
  }
}

/** Generate a non-sensitive diagnostic UUIDv4 request ID. */
function generateRequestId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Robust, typed read-only HTTP client for JointSave API endpoints.
 * Runtime-agnostic: safe in Node.js 18+ and browsers.
 */
export class DataClient {
  private readonly baseUrl: string;
  private readonly customFetch: typeof globalThis.fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly onRequestId?: ((requestId: string) => void) | undefined;

  constructor(options: DataClientOptions) {
    if (!options || typeof options.baseUrl !== "string" || !options.baseUrl.trim()) {
      throw new TypeError("DataClient requires a valid non-empty baseUrl string");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.customFetch = options.fetch ?? globalThis.fetch;
    this.defaultHeaders = {
      Accept: "application/json",
      ...(options.headers ?? {}),
    };
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (options.onRequestId !== undefined) {
      this.onRequestId = options.onRequestId;
    }
  }

  private async request<T>(
    endpoint: string,
    queryParams?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = new URL(`${this.baseUrl}${cleanEndpoint}`);

    if (queryParams) {
      for (const [key, val] of Object.entries(queryParams)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      }
    }

    const requestId = generateRequestId();
    if (this.onRequestId) {
      try {
        this.onRequestId(requestId);
      } catch {
        // Callback errors should never abort user requests
      }
    }

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      "X-Request-Id": requestId,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.customFetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorCode = `HTTP_${response.status}`;
        let errorMessage = `HTTP request failed with status ${response.status}`;
        try {
          const errBody = (await response.json()) as { error?: string; code?: string };
          if (errBody && typeof errBody === "object") {
            if (errBody.code) errorCode = String(errBody.code);
            if (errBody.error) errorMessage = String(errBody.error);
          }
        } catch {
          // Non-JSON error payload
        }
        throw new DataClientError(errorMessage, response.status, errorCode);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof DataClientError) {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw new DataClientError(
          `Request timed out after ${this.timeoutMs}ms`,
          408,
          "REQUEST_TIMEOUT",
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new DataClientError(message, 0, "NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch a paginated list of savings pools.
   */
  async listPools(params?: {
    status?: string;
    type?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<PoolSummary>> {
    const res = await this.request<any>("/api/pools", params);
    const items: PoolSummary[] = Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res)
        ? res
        : [];
    return {
      items,
      nextCursor: typeof res?.nextCursor === "string" ? res.nextCursor : null,
      hasMore: Boolean(res?.hasMore),
      total: typeof res?.total === "number" ? res.total : undefined,
    };
  }

  /**
   * Fetch single pool detail by ID.
   */
  async getPool(id: string): Promise<PoolDetail> {
    if (!id || typeof id !== "string") {
      throw new TypeError("getPool requires a valid pool id string");
    }
    return this.request<PoolDetail>(`/api/pools/${encodeURIComponent(id)}`);
  }

  /**
   * Fetch paginated history / sparkline events for a pool.
   */
  async getPoolHistory(
    id: string,
    params?: { cursor?: string; limit?: number },
  ): Promise<Page<PoolEvent>> {
    if (!id || typeof id !== "string") {
      throw new TypeError("getPoolHistory requires a valid pool id string");
    }
    const res = await this.request<any>("/api/pools/history", {
      poolIds: id,
      ...params,
    });
    const items: PoolEvent[] = Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.events)
        ? res.events
        : [];
    return {
      items,
      nextCursor: typeof res?.nextCursor === "string" ? res.nextCursor : null,
      hasMore: Boolean(res?.hasMore),
    };
  }

  /**
   * Fetch global protocol TVL and metrics.
   */
  async getProtocolSummary(): Promise<ProtocolSummary> {
    const res = await this.request<any>("/api/v1/protocol/summary");
    return (res?.data ?? res) as ProtocolSummary;
  }

  /**
   * Fetch reputation score and metrics for a specific member address.
   */
  async getReputation(address: string): Promise<ReputationData> {
    if (!address || typeof address !== "string") {
      throw new TypeError("getReputation requires a valid address string");
    }
    return this.request<ReputationData>("/api/reputation", { address });
  }

  /**
   * Fetch the reputation leaderboard.
   */
  async getReputationLeaderboard(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<Page<ReputationData>> {
    const res = await this.request<any>("/api/reputation/leaderboard", params);
    const items: ReputationData[] = Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.leaderboard)
        ? res.leaderboard
        : [];
    return {
      items,
      nextCursor: typeof res?.nextCursor === "string" ? res.nextCursor : null,
      hasMore: Boolean(res?.hasMore),
    };
  }

  /**
   * Fetch off-chain mirrored governance votes and proposals.
   */
  async getGovernanceProposals(params?: {
    pool_id?: string;
    proposal_id?: string;
  }): Promise<readonly GovernanceProposal[]> {
    const res = await this.request<any>("/api/governance", params);
    return Array.isArray(res?.proposals)
      ? res.proposals
      : Array.isArray(res)
        ? res
        : [];
  }

  /**
   * Fetch member portfolio balance and active memberships.
   */
  async getPortfolioSummary(address: string): Promise<PortfolioSummary> {
    if (!address || typeof address !== "string") {
      throw new TypeError("getPortfolioSummary requires a valid address string");
    }
    return this.request<PortfolioSummary>("/api/portfolio/summary", { wallet: address });
  }
}
