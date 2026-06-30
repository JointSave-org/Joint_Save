import type { Page, Route } from "@playwright/test"
import { E2E_ADDRESS, E2E_CONTRACT_ID } from "./constants"

/** A row shaped like the Supabase `pools` table the frontend expects. */
export interface MockPool {
  id: string
  name: string
  description: string | null
  type: "rotational" | "target" | "flexible"
  status: "active" | "completed" | "paused"
  creator_address: string
  contract_address: string
  token_address: string
  total_saved: number
  target_amount: number | null
  progress: number
  members_count: number
  next_payout: string | null
  frequency: string | null
  contribution_amount: number | null
  round_duration: number | null
  deadline: string | null
  minimum_deposit: number | null
  withdrawal_fee: number | null
  yield_enabled: boolean
  created_at: string
  pool_activity: any[]
  pool_members: any[]
}

let idCounter = 1000

export function makePool(overrides: Partial<MockPool> = {}): MockPool {
  const id = overrides.id ?? `pool-${idCounter++}`
  return {
    id,
    name: "Test Pool",
    description: "An E2E test pool",
    type: "rotational",
    status: "active",
    creator_address: E2E_ADDRESS.toLowerCase(),
    contract_address: E2E_CONTRACT_ID,
    token_address: "native",
    total_saved: 0,
    target_amount: null,
    progress: 0,
    members_count: 2,
    next_payout: null,
    frequency: "weekly",
    contribution_amount: 100,
    round_duration: 604800,
    deadline: null,
    minimum_deposit: null,
    withdrawal_fee: 1,
    yield_enabled: false,
    created_at: "2026-01-01T00:00:00.000Z",
    pool_activity: [],
    pool_members: [],
    ...overrides,
  }
}

export interface PoolsApiHandle {
  /** Live in-memory store — inspect/mutate from a test if needed. */
  pools: MockPool[]
  /** Convenience accessor for the most recently created pool. */
  lastCreated(): MockPool | undefined
}

/**
 * Intercept every `/api/pools` request in the browser and serve it from an
 * in-memory store. The real Next API route + Supabase never execute.
 *
 * Supports the GET (by id / contract / creator / all), POST (create) and
 * PATCH (log activity) shapes the frontend uses.
 */
export async function mockPoolsApi(page: Page, seed: MockPool[] = []): Promise<PoolsApiHandle> {
  const pools: MockPool[] = [...seed]
  let lastCreatedId: string | null = null

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })

  await page.route("**/api/pools**", async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()

    if (method === "GET") {
      const id = url.searchParams.get("id")
      const contract = url.searchParams.get("contract")
      const creator = url.searchParams.get("creator")

      if (id) {
        const pool = pools.find((p) => p.id === id)
        return pool ? json(route, pool) : json(route, { error: "Pool not found" }, 404)
      }
      if (contract) {
        const pool = pools.find((p) => p.contract_address === contract)
        return pool ? json(route, pool) : json(route, { error: "Pool not found" }, 404)
      }
      if (creator) {
        const mine = pools.filter((p) => p.creator_address === creator.toLowerCase())
        return json(route, {
          data: mine,
          total: mine.length,
          page: 0,
          pageSize: 6,
        })
      }
      return json(route, pools)
    }

    if (method === "POST") {
      const body = req.postDataJSON() ?? {}
      const created = makePool({
        name: body.name,
        description: body.description ?? null,
        type: body.poolType,
        creator_address: (body.creatorAddress ?? E2E_ADDRESS).toLowerCase(),
        contract_address: body.poolAddress,
        token_address: body.tokenAddress ?? "native",
        members_count: body.members?.length ?? 2,
        contribution_amount: body.contributionAmount ? parseFloat(body.contributionAmount) : null,
        target_amount: body.targetAmount ? parseFloat(body.targetAmount) : null,
        minimum_deposit: body.minimumDeposit ? parseFloat(body.minimumDeposit) : null,
        withdrawal_fee: body.withdrawalFee ? parseFloat(body.withdrawalFee) : 1,
        frequency: body.frequency ?? null,
        deadline: body.deadline ?? null,
        yield_enabled: !!body.yieldEnabled,
        pool_activity: [
          {
            id: `act-created-${Date.now()}`,
            activity_type: "pool_created",
            user_address: (body.creatorAddress ?? E2E_ADDRESS).toLowerCase(),
            amount: null,
            description: `${body.poolType} pool created`,
            created_at: new Date(0).toISOString(),
            tx_hash: body.txHash ?? null,
          },
        ],
      })
      pools.push(created)
      lastCreatedId = created.id
      return json(route, created, 201)
    }

    if (method === "PATCH") {
      const body = req.postDataJSON() ?? {}
      const pool = pools.find((p) => p.id === (body.id ?? url.searchParams.get("id")))
      if (pool && body.activity) {
        pool.pool_activity.unshift({
          id: `act-${Date.now()}-${Math.random()}`,
          activity_type: body.activity.activity_type,
          user_address: body.activity.user_address?.toLowerCase() ?? null,
          amount: body.activity.amount ?? null,
          description: `${body.activity.activity_type} transaction`,
          created_at: new Date(0).toISOString(),
          tx_hash: body.activity.tx_hash ?? null,
        })
      }
      return json(route, { success: true })
    }

    return route.continue()
  })

  return {
    pools,
    lastCreated: () => pools.find((p) => p.id === lastCreatedId),
  }
}
