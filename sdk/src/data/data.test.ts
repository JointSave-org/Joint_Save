import { describe, expect, it, vi } from "vitest";
import {
  DataClient,
  DataClientError,
  type FetchLike,
  type FetchResponse,
} from "./client";

function response(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function json(body: unknown, status = 200): FetchResponse {
  return response(body, status);
}

function fetchMock(
  handler: (url: string, init?: Parameters<FetchLike>[1]) => Promise<FetchResponse>
): { fetch: FetchLike; calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

const POOL = {
  id: "pool-1",
  contract_address: "CAAAA",
  name: "Friends",
  description: null,
  type: "rotational",
  status: "active",
  creator_address: "GAAAA",
  token_address: "CDLZ",
  token_symbol: "XLM",
  token_decimals: 7,
  members_count: 4,
  contribution_amount: 10,
  target_amount: null,
  total_saved: 40,
  minimum_deposit: 5,
  yield_enabled: false,
  deadline: "2026-01-01T00:00:00.000Z",
  next_payout: null,
  created_at: "2025-12-01T00:00:00.000Z",
  archived_at: null,
};

describe("DataClient", () => {
  it("requires a baseUrl", () => {
    expect(() => new DataClient({ baseUrl: "" })).toThrow(DataClientError);
    try {
      new DataClient({ baseUrl: "" });
    } catch (error) {
      expect((error as DataClientError).code).toBe("INVALID_ARGUMENT");
    }
  });

  it("lists pools and normalizes snake_case rows", async () => {
    const { fetch, calls } = fetchMock(async () =>
      json({ items: [POOL], nextCursor: null, hasMore: false, total: 1 })
    );
    const client = new DataClient({
      baseUrl: "https://jointsave.app/",
      fetch,
      requestId: () => "req-1",
      onRequestId: vi.fn(),
    });

    const page = await client.listPools({ status: "active", limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: "pool-1",
      contractAddress: "CAAAA",
      type: "rotational",
      status: "active",
      tokenDecimals: 7,
      contributionAmount: 10,
      targetAmount: null,
      yieldEnabled: false,
    });
    expect(calls[0]?.url).toContain("/api/pools?");
    expect(calls[0]?.url).toContain("status=active");
    expect(calls[0]?.url).toContain("limit=10");
    expect(calls[0]?.init?.headers).toMatchObject({
      accept: "application/json",
      "x-request-id": "req-1",
    });
  });

  it("accepts a bare array and derives archived status", async () => {
    const { fetch } = fetchMock(async () =>
      json([{ ...POOL, status: null, archived_at: "2026-02-01T00:00:00.000Z" }])
    );
    const client = new DataClient({ baseUrl: "https://jointsave.app", fetch });
    const page = await client.listPools();

    expect(page.items[0]?.status).toBe("archived");
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(1);
  });

  it("tolerates malformed optional fields", async () => {
    const { fetch } = fetchMock(async () =>
      json({ items: [{ id: "pool-2", weird: true }], nextCursor: null, hasMore: false })
    );
    const client = new DataClient({ baseUrl: "https://jointsave.app", fetch });
    const page = await client.listPools();

    expect(page.items[0]).toMatchObject({
      id: "pool-2",
      contractAddress: "",
      type: "rotational",
      status: "active",
      tokenDecimals: 7,
      membersCount: 0,
      totalSaved: 0,
    });
  });

  it("falls back to /api/pools?id= when the detail route is missing", async () => {
    const { fetch, calls } = fetchMock(async (url) => {
      if (url.includes("/api/pools/pool-1")) {
        return json({ error: "Not found", code: "NOT_FOUND" }, 404);
      }
      return json({
        ...POOL,
        pool_members: [{ id: "m1", address: "GAAAA", contribution_amount: 10 }],
        pool_activity: [
          {
            id: "a1",
            activity_type: "deposit",
            user_address: "GAAAA",
            amount: 10,
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    });
    const client = new DataClient({ baseUrl: "https://jointsave.app", fetch });

    const detail = await client.getPool("pool-1");

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("/api/pools?id=pool-1");
    expect(detail.members[0]).toMatchObject({ address: "GAAAA", contributionAmount: 10 });
    expect(detail.activity[0]).toMatchObject({ activityType: "deposit", amount: 10 });
  });

  it("falls back from sparkline history to the activity feed", async () => {
    const { fetch, calls } = fetchMock(async (url) => {
      if (url.includes("/api/pools/history")) {
        return json({ history: { "pool-1": [1, 2, 3] } });
      }
      return json({
        activities: [
          {
            id: "e1",
            activity_type: "payout",
            user_address: "GAAAA",
            amount: 5,
            description: "Payout",
            created_at: "2026-01-02T00:00:00.000Z",
            tx_hash: "abc",
          },
        ],
        page: 2,
        pageSize: 20,
        total: 40,
        hasMore: true,
      });
    });
    const client = new DataClient({ baseUrl: "https://jointsave.app", fetch });

    const page = await client.getPoolHistory("pool-1", { cursor: "2", limit: 20 });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("/api/pools/pool-1/activity");
    expect(calls[1]?.url).toContain("page=2");
    expect(page.items[0]).toMatchObject({ id: "e1", poolId: "pool-1", txHash: "abc" });
    expect(page.nextCursor).toBe("3");
    expect(page.total).toBe(40);
  });

  it("normalizes protocol analytics inside the envelope", async () => {
    const { fetch } = fetchMock(async () =>
      json({
        success: true,
        data: {
          protocols: [
            {
              totalValueLockedUSD: "1234.5",
              totalVolumeUSD: 99,
              activePoolsCount: 3,
              totalMembers: 12,
            },
          ],
          protocolDayDatas: [{ date: "2026-01-01", tvlUSD: 1000, dailyVolumeUSD: 10 }],
          pools: [{ id: "pool-1", totalValueLockedUSD: 500, volumeUSD: 5, isActive: true }],
        },
      })
    );
    const client = new DataClient({ baseUrl: "https://jointsave.app", fetch });

    const summary = await client.getProtocolSummary();

    expect(summary).toMatchObject({
      totalValueLockedUsd: 1234.5,
      totalVolumeUsd: 99,
      activePools: 3,
      totalMembers: 12,
    });
    expect(summary.days[0]).toMatchObject({ tvlUsd: 1000, dailyVolumeUsd: 10 });
    expect(summary.topPools[0]).toMatchObject({ id: "pool-1", isActive: true });
  });

  it("normalizes reputation, leaderboard, governance, and portfolio", async () => {
    const { fetch } = fetchMock(async (url) => {
      if (url.includes("/leaderboard")) {
        return json({
          data: [
            {
              address: "GAAAA",
              total_score: 42,
              deposit_reliability: 90,
              total_deposits: 12,
              rank: 1,
            },
          ],
          total: 1,
        });
      }
      if (url.includes("/governance")) {
        return json({
          data: [
            {
              proposal_id: "7",
              pool_id: "pool-1",
              proposal_type: "YieldAllocation",
              description: "Allocate",
              status: "Passed",
              votes_for: ["G1", "G2"],
              votes_against: 1,
              created_at: 100,
              parameters: { amount: "500" },
            },
          ],
        });
      }
      if (url.includes("/portfolio")) {
        return json({
          data: {
            total_saved: 100,
            total_saved_by_token: { XLM: 100 },
            total_pools: { rotational: 1, target: 0, flexible: 0, total: 1 },
            total_yield_earned: 2,
            upcoming_commitments: [
              { pool_id: "pool-1", pool_name: "Friends", amount: 10, deadline: "2026-01-01" },
            ],
            reputation_summary: { total_deposits: 12, average_on_time_rate: 98, pools_completed: 1 },
            pools: [
              {
                id: "pool-1",
                name: "Friends",
                type: "rotational",
                status: "active",
                contribution: 10,
                total_balance: 40,
              },
            ],
          },
        });
      }
      return json({ data: { total_score: 42, total_deposits: 12, address: "GAAAA" } });
    });
    const client = new DataClient({ baseUrl: "https://jointsave.app", fetch });

    const reputation = await client.getReputation("GAAAA");
    expect(reputation).toMatchObject({ address: "GAAAA", totalScore: 42, isProvisional: false });

    const leaderboard = await client.getReputationLeaderboard({ top: 1 });
    expect(leaderboard.items[0]).toMatchObject({ rank: 1, totalScore: 42 });

    const proposals = await client.getGovernanceProposals({ poolId: "pool-1" });
    expect(proposals.items[0]).toMatchObject({
      id: "7",
      proposalType: "YieldAllocation",
      status: "Passed",
      votesFor: 2,
      votesAgainst: 1,
    });

    const portfolio = await client.getPortfolioSummary("GAAAA");
    expect(portfolio).toMatchObject({ totalSaved: 100, totalYieldEarned: 2 });
    expect(portfolio.reputationSummary).toMatchObject({ averageOnTimeRate: 98 });
    expect(portfolio.pools[0]).toMatchObject({ id: "pool-1", totalBalance: 40 });
  });

  it("generates a request id with Web Crypto when available", async () => {
    const seen: string[] = [];
    const { fetch, calls } = fetchMock(async () => json({ items: [], hasMore: false }));
    const client = new DataClient({
      baseUrl: "https://jointsave.app",
      fetch,
      onRequestId: (requestId) => seen.push(requestId),
    });

    await client.listPools();

    const sent = calls[0]?.init?.headers?.["x-request-id"];
    expect(sent).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seen).toEqual([sent]);
  });

  it("raises DataClientError with status, code, and request id", async () => {
    const { fetch } = fetchMock(async () =>
      json({ error: "Pool not found", code: "POOL_NOT_FOUND" }, 404)
    );
    const client = new DataClient({
      baseUrl: "https://jointsave.app",
      fetch,
      requestId: () => "req-404",
    });

    await expect(client.getProtocolSummary()).rejects.toMatchObject({
      name: "DataClientError",
      status: 404,
      code: "POOL_NOT_FOUND",
      requestId: "req-404",
    });
  });

  it("maps abort signals to ABORTED", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch, calls } = fetchMock(async () => json({}));
    const client = new DataClient({
      baseUrl: "https://jointsave.app",
      fetch,
      signal: controller.signal,
      requestId: () => "req-abort",
    });

    await expect(client.listPools()).rejects.toMatchObject({
      code: "ABORTED",
      requestId: "req-abort",
    });
    expect(calls).toHaveLength(0);
  });

  it("maps timeouts to TIMEOUT", async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const client = new DataClient({
      baseUrl: "https://jointsave.app",
      fetch,
      timeoutMs: 5,
    });

    await expect(client.listPools()).rejects.toMatchObject({
      name: "DataClientError",
      status: null,
      code: "TIMEOUT",
    });
  });

  it("maps transport failures to NETWORK_ERROR and preserves the cause", async () => {
    const cause = new Error("socket hang up");
    const { fetch } = fetchMock(async () => {
      throw cause;
    });
    const client = new DataClient({ baseUrl: "https://jointsave.app", fetch });

    try {
      await client.listPools();
      expect.unreachable("expected a failure");
    } catch (error) {
      expect(error).toBeInstanceOf(DataClientError);
      expect((error as DataClientError).code).toBe("NETWORK_ERROR");
      expect((error as DataClientError).cause).toBe(cause);
    }
  });

  it("fails when no fetch implementation is available", async () => {
    const original = globalThis.fetch;
    // @ts-expect-error simulate a runtime without fetch
    delete globalThis.fetch;
    try {
      const client = new DataClient({ baseUrl: "https://jointsave.app" });
      await expect(client.listPools()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
