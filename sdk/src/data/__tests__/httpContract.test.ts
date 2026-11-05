import { describe, expect, it, vi } from "vitest";
import { DataClient, DataClientError } from "../client";
import openApiSpec from "../../../../../docs/api/openapi.json";

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
      expect(capturedId).toBeTruthy();
      expect(sentHeader).toBe(capturedId);
    });
  });

  describe("API Methods & Pagination", () => {
    it("listPools parses paginated responses correctly", async () => {
      const mockPayload = {
        items: [
          { id: "pool-1", poolType: "rotational", status: "active" },
          { id: "pool-2", poolType: "flexible", status: "active" },
        ],
        nextCursor: "cursor_abc",
        hasMore: true,
        total: 24,
      };

      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockPayload,
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });
      const page = await client.listPools({ status: "active", limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe("cursor_abc");
      expect(page.hasMore).toBe(true);
      expect(page.total).toBe(24);
    });

    it("getPool fetches pool detail", async () => {
      const mockDetail = {
        id: "pool-123",
        name: "Community Savings",
        poolType: "target",
        status: "active",
        targetAmount: "1000000000",
      };

      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockDetail,
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });
      const detail = await client.getPool("pool-123");
      expect(detail.id).toBe("pool-123");
      expect(detail.poolType).toBe("target");
    });

    it("getProtocolSummary unpacks standard summary fixture", async () => {
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
      expect(summary.protocols[0].activePoolsCount).toBe(18);
      expect(summary.protocols[0].totalMembers).toBe(142);
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
      await expect(client.getPool("missing-id")).rejects.toThrow(DataClientError);

      try {
        await client.getPool("missing-id");
      } catch (err) {
        expect(err).toBeInstanceOf(DataClientError);
        const dataErr = err as DataClientError;
        expect(dataErr.status).toBe(404);
        expect(dataErr.code).toBe("POOL_NOT_FOUND");
        expect(dataErr.message).toBe("Pool not found");
      }
    });

    it("handles timeout aborts gracefully", async () => {
      const customFetch = vi.fn().mockImplementation(async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      });

      const client = new DataClient({ baseUrl, fetch: customFetch });
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
