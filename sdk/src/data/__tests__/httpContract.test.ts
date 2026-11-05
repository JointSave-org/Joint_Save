import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from "vitest";
import { DataClient, DataClientError } from "../client";

describe("DataClient & HTTP Contract", () => {
  const baseUrl = "https://jointsave.org";

  describe("Constructor & Invariants", () => {
    it("throws on missing or empty baseUrl", () => {
      // @ts-expect-error test invalid param
      expect(() => new DataClient()).toThrow(TypeError);
      expect(() => new DataClient({ baseUrl: "" })).toThrow(TypeError);
      expect(() => new DataClient({ baseUrl: "   " })).toThrow(TypeError);
    });

    it("trims trailing slashes from baseUrl", async () => {
      let requestedUrl = "";
      const customFetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { protocols: [] } }),
        };
      });

      const client = new DataClient({ baseUrl: "https://jointsave.org///", fetch: customFetch });
      await client.getProtocolSummary();
      expect(requestedUrl).toBe("https://jointsave.org/api/v1/protocol/summary");
    });

    it("generates and triggers onRequestId callback", async () => {
      let capturedId = "";
      let sentHeader = "";

      const customFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        sentHeader = (init.headers as Record<string, string>)["X-Request-Id"] || "";
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { protocols: [] } }),
        };
      });

      const client = new DataClient({
        baseUrl,
        fetch: customFetch,
        onRequestId: (id) => {
          capturedId = id;
        },
      });

      await client.getProtocolSummary();
      expect(capturedId.length).toBeGreaterThan(0);
      expect(sentHeader).toBe(capturedId);
    });
  });

  describe("Route Methods & Pagination", () => {
    it("listPools returns standard Page structure with default params", async () => {
      const mockPayload = {
        items: [
          {
            id: "pool-1",
            poolType: "rotational",
            status: "active",
            currentCycle: 1,
            totalCycles: 5,
            contributionAmount: "100.00",
            cycleDuration: 604800,
            yieldStrategy: "none",
            autoYieldEnabled: false,
            memberCount: 5,
            currentRound: 1,
            roundDurationDays: 7,
            totalYieldUSD: "0.00",
          },
        ],
        nextCursor: "cursor_abc123",
        hasMore: true,
        total: 15,
      };

      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockPayload,
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });
      const page = await client.listPools({ status: "active", limit: 1 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.id).toBe("pool-1");
      expect(page.nextCursor).toBe("cursor_abc123");
      expect(page.hasMore).toBe(true);
      expect(page.total).toBe(15);
    });

    it("getPool returns detailed pool payload and encodes id parameter", async () => {
      let requestedUrl = "";
      const customFetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "pool-123", poolType: "rotational" }),
        };
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });
      const pool = await client.getPool("special/pool#1");

      expect(requestedUrl).toBe("https://jointsave.org/api/pools/special%2Fpool%231");
      expect(pool.id).toBe("pool-123");
    });

    it("getProtocolSummary parses wrapper payload", async () => {
      const mockSummary = {
        success: true,
        data: {
          protocols: [
            {
              totalValueLockedUSD: "1250000.50",
              totalVolumeUSD: "4500000.00",
              activePoolsCount: 18,
              totalMembers: 142,
            },
          ],
        },
      };

      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSummary,
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });
      const summary = await client.getProtocolSummary();
      const firstProto = summary.protocols?.[0];
      expect(firstProto?.activePoolsCount).toBe(18);
      expect(firstProto?.totalMembers).toBe(142);
    });

    it("getPortfolioSummary passes wallet param and returns data", async () => {
      let requestedUrl = "";
      const customFetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ wallet: "GBTEST...", totalBalanceUSD: 500 }),
        };
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });
      const summary = await client.getPortfolioSummary("GBTEST...");
      expect(requestedUrl).toContain("wallet=GBTEST...");
      expect(summary.wallet).toBe("GBTEST...");
    });
  });

  describe("Error Handling", () => {
    it("throws DataClientError with status and code on HTTP 404", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Pool not found", code: "POOL_NOT_FOUND" }),
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });

      await expect(client.getPool("missing")).rejects.toThrow(DataClientError);
      try {
        await client.getPool("missing");
      } catch (err) {
        const dataErr = err as DataClientError;
        expect(dataErr.status).toBe(404);
        expect(dataErr.code).toBe("POOL_NOT_FOUND");
        expect(dataErr.message).toBe("Pool not found");
      }
    });

    it("handles timeout error gracefully", async () => {
      const customFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        return new Promise((_, reject) => {
          if (init.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      });

      const client = new DataClient({ baseUrl, timeoutMs: 10, fetch: customFetch });
      await expect(client.getProtocolSummary()).rejects.toThrow(DataClientError);
      try {
        await client.getProtocolSummary();
      } catch (err) {
        const dataErr = err as DataClientError;
        expect(dataErr.status).toBe(408);
        expect(dataErr.code).toBe("REQUEST_TIMEOUT");
      }
    });
  });

  describe("OpenAPI 3.1 Contract Validation", () => {
    it("validates openapi.json contains required paths and schemas", () => {
      const openApiSpecPath = path.resolve(__dirname, "../../../../../docs/api/openapi.json");
      expect(fs.existsSync(openApiSpecPath)).toBe(true);
      const openApiSpec = JSON.parse(fs.readFileSync(openApiSpecPath, "utf-8"));

      expect(openApiSpec.openapi).toBe("3.1.0");
      expect(openApiSpec.paths).toHaveProperty("/pools");
      expect(openApiSpec.paths).toHaveProperty("/pools/{id}");
      expect(openApiSpec.paths).toHaveProperty("/pools/history");
      expect(openApiSpec.paths).toHaveProperty("/v1/protocol/summary");
      expect(openApiSpec.paths).toHaveProperty("/reputation");
      expect(openApiSpec.paths).toHaveProperty("/portfolio/summary");

      const schemas = openApiSpec.components.schemas;
      expect(schemas).toHaveProperty("PagePoolSummary");
      expect(schemas).toHaveProperty("PoolDetail");
      expect(schemas).toHaveProperty("ProtocolSummary");
      expect(schemas).toHaveProperty("ReputationData");
      expect(schemas).toHaveProperty("ErrorResponse");
    });
  });
});
