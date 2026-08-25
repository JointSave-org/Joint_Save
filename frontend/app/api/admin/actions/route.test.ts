import { test } from "node:test"
import assert from "node:assert"

// ── Mock Logic matching route.ts implementation ─────────────────────────────

function isAuthorized(
  callerAddress: string,
  pool: { creator_address: string },
  members: string[]
): boolean {
  const caller = callerAddress.toLowerCase()
  return (
    pool.creator_address.toLowerCase() === caller ||
    members.map((m) => m.toLowerCase()).includes(caller)
  )
}

function getAuthErrorCode(
  poolId: string | null,
  callerAddress: string | null,
  pool: { creator_address: string } | null,
  members: string[]
): number | null {
  if (!poolId) return 400
  if (!callerAddress) return 400
  if (!pool) return 404
  if (!isAuthorized(callerAddress, pool, members)) return 403
  return null // Authorized
}

// ── Test Cases ──────────────────────────────────────────────────────────────

test("admin actions auth — returns 400 when poolId is missing", () => {
  const code = getAuthErrorCode(null, "GABC", { creator_address: "GCREATOR" }, [])
  assert.strictEqual(code, 400)
})

test("admin actions auth — returns 400 when callerAddress is missing", () => {
  const code = getAuthErrorCode("p1", null, { creator_address: "GCREATOR" }, [])
  assert.strictEqual(code, 400)
})

test("admin actions auth — returns 404 when pool is not found", () => {
  const code = getAuthErrorCode("p1", "GABC", null, [])
  assert.strictEqual(code, 404)
})

test("admin actions auth — returns 403 when caller is not creator and not a member", () => {
  const pool = { creator_address: "GCREATOR" }
  const members = ["GMEMBER1", "GMEMBER2"]
  const code = getAuthErrorCode("p1", "GINTRUDER", pool, members)
  assert.strictEqual(code, 403)
})

test("admin actions auth — returns null (authorized) when caller is creator", () => {
  const pool = { creator_address: "GCREATOR" }
  const members = ["GMEMBER1", "GMEMBER2"]
  const code = getAuthErrorCode("p1", "GCREATOR", pool, members)
  assert.strictEqual(code, null)
})

test("admin actions auth — returns null (authorized) when caller is a pool member", () => {
  const pool = { creator_address: "GCREATOR" }
  const members = ["GMEMBER1", "GMEMBER2"]
  const code = getAuthErrorCode("p1", "gmember2", pool, members)
  assert.strictEqual(code, null)
})

test("admin actions auth — case-insensitive address comparison", () => {
  const pool = { creator_address: "GCREATOR" }
  const members = ["GMEMBER1"]
  assert.strictEqual(isAuthorized("gcreator", pool, members), true)
  assert.strictEqual(isAuthorized("gmember1", pool, members), true)
  assert.strictEqual(isAuthorized("gmember2", pool, members), false)
})
