import { DataClient, DataClientError } from "@jointsave/sdk";

async function main() {
  const api = new DataClient({
    baseUrl: "https://jointsave.app",
    onRequestId: (requestId) => console.debug("request", requestId),
  });

  try {
    let cursor: string | undefined;
    let pages = 0;

    do {
      const page = await api.listPools({
        status: "active",
        limit: 20,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      for (const pool of page.items) {
        console.log(pool.id, pool.name, pool.type, pool.totalSaved);
      }
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 5);

    const first = await api.listPools({ status: "active", limit: 1 });
    const poolId = first.items[0]?.id;

    if (poolId) {
      const detail = await api.getPool(poolId);
      const history = await api.getPoolHistory(poolId, { limit: 10 });
      console.log(detail.name, detail.members.length, history.items.length);
    }

    const analytics = await api.getProtocolSummary();
    console.log({
      tvlUsd: analytics.totalValueLockedUsd,
      activePools: analytics.activePools,
      days: analytics.days.length,
    });
  } catch (error) {
    if (error instanceof DataClientError) {
      console.error(error.code, error.status, error.requestId, error.message);
    } else {
      throw error;
    }
  }
}

void main();
