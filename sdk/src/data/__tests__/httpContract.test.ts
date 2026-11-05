import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

interface OpenApiDocument {
  openapi: string;
  info: { version: string };
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown> };
}

const specPath = path.resolve(__dirname, "../../../../docs/api/openapi.json");
const doc = JSON.parse(fs.readFileSync(specPath, "utf8")) as OpenApiDocument;

const defs = JSON.parse(
  JSON.stringify(doc.components.schemas).replace(
    /#\/components\/schemas\//g,
    "#/$defs/"
  )
) as Record<string, unknown>;

const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });

function validate(schemaName: string, value: unknown): string[] {
  const check = ajv.compile({ $defs: defs, $ref: `#/$defs/${schemaName}` });
  if (check(value)) return [];
  return (check.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`
  );
}

const POOL_SUMMARY = {
  id: "pool-1",
  contractAddress: "CAAAA",
  name: "Friends",
  description: null,
  type: "rotational",
  status: "active",
  creatorAddress: "GAAAA",
  tokenAddress: "CDLZ",
  tokenSymbol: "XLM",
  tokenDecimals: 7,
  membersCount: 4,
  contributionAmount: 10,
  targetAmount: null,
  totalSaved: 40,
  minimumDeposit: 5,
  yieldEnabled: false,
  deadline: "2026-01-01T00:00:00.000Z",
  nextPayout: null,
  createdAt: "2025-12-01T00:00:00.000Z",
  archivedAt: null,
};

const POOL_EVENT = {
  id: "event-1",
  poolId: "pool-1",
  activityType: "deposit",
  userAddress: "GAAAA",
  amount: 10,
  description: "Deposit",
  createdAt: "2026-01-01T00:00:00.000Z",
  txHash: "abc",
};

const REPUTATION = {
  address: "GAAAA",
  totalScore: 42,
  depositReliability: 90,
  poolsCompleted: 2,
  poolsJoined: 3,
  totalDeposits: 12,
  missedDeposits: 0,
  lastActivity: 1_767_225_600,
  scoreUpdatedAt: 1_767_225_600,
  isProvisional: false,
};

const GOVERNANCE_PROPOSAL = {
  id: "7",
  poolId: "pool-1",
  proposalType: "YieldAllocation",
  description: "Allocate",
  status: "Passed",
  votesFor: 2,
  votesAgainst: 1,
  createdAt: 1_767_225_600,
  expiresAt: null,
  parameters: { amount: "500" },
};

describe("OpenAPI contract", () => {
  it("is an OpenAPI 3.1 document with the documented routes", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("0.1.0");
    for (const route of [
      "/api/pools",
      "/api/pools/{id}",
      "/api/pools/history",
      "/api/pools/{id}/activity",
      "/api/v1/protocol/summary",
      "/api/reputation",
      "/api/reputation/leaderboard",
      "/api/governance",
      "/api/portfolio/summary",
    ]) {
      expect(doc.paths).toHaveProperty([route, "get"]);
    }
  });

  it("accepts the pool list and detail fixtures", () => {
    expect(validate("PoolSummary", POOL_SUMMARY)).toEqual([]);
    expect(
      validate("PoolPage", {
        items: [POOL_SUMMARY],
        nextCursor: null,
        hasMore: false,
        total: 1,
      })
    ).toEqual([]);
    expect(
      validate("PoolDetail", {
        ...POOL_SUMMARY,
        members: [
          { id: "m1", address: "GAAAA", contributionAmount: 10, status: "active" },
        ],
        activity: [
          {
            id: "a1",
            activityType: "deposit",
            userAddress: "GAAAA",
            amount: 10,
            description: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            txHash: null,
          },
        ],
      })
    ).toEqual([]);
  });

  it("accepts history and activity fixtures", () => {
    expect(
      validate("PoolEventPage", {
        items: [POOL_EVENT],
        nextCursor: "2",
        hasMore: true,
        total: 40,
      })
    ).toEqual([]);
    expect(
      validate("PoolActivityResponse", {
        activities: [POOL_EVENT],
        page: 1,
        pageSize: 20,
        total: 1,
        hasMore: false,
      })
    ).toEqual([]);
  });

  it("accepts protocol analytics, reputation, and governance fixtures", () => {
    expect(
      validate("ProtocolSummaryEnvelope", {
        success: true,
        data: {
          totalValueLockedUsd: 1234.5,
          totalVolumeUsd: 99,
          activePools: 3,
          totalMembers: 12,
          days: [{ date: "2026-01-01", tvlUsd: 1000, dailyVolumeUsd: 10 }],
          topPools: [
            { id: "pool-1", totalValueLockedUsd: 500, volumeUsd: 5, isActive: true },
          ],
        },
      })
    ).toEqual([]);
    expect(validate("ReputationProfile", REPUTATION)).toEqual([]);
    expect(
      validate("ReputationLeaderboardResponse", {
        data: [{ ...REPUTATION, rank: 1 }],
        total: 1,
        topN: 10,
      })
    ).toEqual([]);
    expect(
      validate("GovernanceProposalPage", {
        items: [GOVERNANCE_PROPOSAL],
        nextCursor: null,
        hasMore: false,
        total: 1,
      })
    ).toEqual([]);
  });

  it("accepts a portfolio summary fixture", () => {
    expect(
      validate("PortfolioSummary", {
        totalSaved: 100,
        totalSavedByToken: { XLM: 100 },
        totalPools: { rotational: 1, target: 0, flexible: 0, total: 1 },
        totalYieldEarned: 2,
        upcomingCommitments: [
          {
            poolId: "pool-1",
            poolName: "Friends",
            amount: 10,
            deadline: "2026-01-01T00:00:00.000Z",
            type: "rotational",
          },
        ],
        reputationSummary: {
          totalDeposits: 12,
          averageOnTimeRate: 98,
          poolsCompleted: 1,
        },
        pools: [
          {
            id: "pool-1",
            name: "Friends",
            type: "rotational",
            status: "active",
            contribution: 10,
            totalBalance: 40,
            healthScore: null,
            nextAction: null,
          },
        ],
      })
    ).toEqual([]);
  });

  it("rejects fixtures that miss required fields", () => {
    const errors = validate("PoolSummary", { id: "pool-1" });
    expect(errors.length).toBeGreaterThan(0);
    expect(validate("GovernanceProposalPage", { items: [{}], hasMore: false })).not.toEqual(
      []
    );
  });
});
