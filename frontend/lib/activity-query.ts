/**
 * Pure helpers for the pool activity API (issue #210).
 *
 * Query-string parsing/validation, PostgREST search-clause construction, and
 * CSV row mapping live here — free of next/server and Supabase imports — so
 * the route handlers stay thin and this logic runs under `tsx --test`.
 */

import { ACTIVITY_PAGE_SIZE } from "./constants"

/**
 * Every activity_type the platform writes today: the contract event map in
 * useJointSaveContracts, the PATCH /api/pools activity logger, and the
 * pool-creation logger.
 */
export const ACTIVITY_TYPES = [
  "deposit",
  "payout",
  "withdraw",
  "complete",
  "member_joined",
  "member_added",
  "member_removed",
  "pool_created",
  "yield",
] as const

export type ActivityType = (typeof ACTIVITY_TYPES)[number]

const MAX_SEARCH_LENGTH = 100
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ActivityQuery {
  /** Sanitized search term, or null when absent/empty. */
  search: string | null
  /** Inclusive lower bound for created_at (ISO), or null. */
  dateFromIso: string | null
  /** EXCLUSIVE upper bound for created_at (ISO) — midnight after date_to. */
  dateToExclusiveIso: string | null
  activityType: ActivityType | null
  /** true = oldest first. */
  ascending: boolean
  /** 1-based page number. */
  page: number
  /** Supabase .range() bounds (0-based, inclusive). */
  rangeFrom: number
  rangeTo: number
}

export interface ActivityQueryError {
  error: string
}

export function isActivityQueryError(
  q: ActivityQuery | ActivityQueryError
): q is ActivityQueryError {
  return "error" in q
}

/**
 * Strip characters that carry meaning inside a PostgREST `or=(...)` filter
 * string or an `ilike` pattern. Raw commas/parens would corrupt the filter
 * expression (letting callers break or inject clauses); `%`/`_` are pattern
 * wildcards; `\` is the escape character; `*` is PostgREST's own wildcard
 * alias.
 */
export function sanitizeSearchTerm(term: string): string {
  return term
    .replace(/[,()%_\\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Build the argument for Supabase's `.or(...)` covering every text column a
 * user would reasonably search. Returns null when the sanitized term is empty.
 */
export function buildSearchOrClause(term: string): string | null {
  const clean = sanitizeSearchTerm(term)
  if (!clean) return null
  const pattern = `%${clean}%`
  return [
    `activity_type.ilike.${pattern}`,
    `description.ilike.${pattern}`,
    `user_address.ilike.${pattern}`,
    `tx_hash.ilike.${pattern}`,
  ].join(",")
}

function parseDateParam(value: string): Date | null {
  if (!DATE_RE.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Validate and normalize the activity endpoint's query params.
 * Returns `{ error }` (route responds 400) on any invalid input.
 */
export function parseActivityQuery(params: {
  search?: string | null
  date_from?: string | null
  date_to?: string | null
  activity_type?: string | null
  sort?: string | null
  page?: string | null
}): ActivityQuery | ActivityQueryError {
  const rawSearch = (params.search ?? "").trim()
  if (rawSearch.length > MAX_SEARCH_LENGTH) {
    return { error: `search must be at most ${MAX_SEARCH_LENGTH} characters` }
  }
  const search = rawSearch ? sanitizeSearchTerm(rawSearch) || null : null

  let dateFromIso: string | null = null
  if (params.date_from) {
    const d = parseDateParam(params.date_from)
    if (!d) return { error: "date_from must be a valid YYYY-MM-DD date" }
    dateFromIso = d.toISOString()
  }

  let dateToExclusiveIso: string | null = null
  if (params.date_to) {
    const d = parseDateParam(params.date_to)
    if (!d) return { error: "date_to must be a valid YYYY-MM-DD date" }
    // Exclusive bound at the following midnight so date_to itself is included.
    d.setUTCDate(d.getUTCDate() + 1)
    dateToExclusiveIso = d.toISOString()
  }

  if (dateFromIso && dateToExclusiveIso && dateFromIso >= dateToExclusiveIso) {
    return { error: "date_from must not be after date_to" }
  }

  let activityType: ActivityType | null = null
  if (params.activity_type) {
    if (!(ACTIVITY_TYPES as readonly string[]).includes(params.activity_type)) {
      return { error: `activity_type must be one of: ${ACTIVITY_TYPES.join(", ")}` }
    }
    activityType = params.activity_type as ActivityType
  }

  const sort = params.sort ?? "newest"
  if (sort !== "newest" && sort !== "oldest") {
    return { error: "sort must be 'newest' or 'oldest'" }
  }

  let page = 1
  if (params.page != null && params.page !== "") {
    page = Number(params.page)
    if (!Number.isInteger(page) || page < 1) {
      return { error: "page must be a positive integer" }
    }
  }

  const rangeFrom = (page - 1) * ACTIVITY_PAGE_SIZE
  return {
    search,
    dateFromIso,
    dateToExclusiveIso,
    activityType,
    ascending: sort === "oldest",
    page,
    rangeFrom,
    rangeTo: rangeFrom + ACTIVITY_PAGE_SIZE - 1,
  }
}

/** Columns returned by the activity + export endpoints. */
export const ACTIVITY_SELECT_COLUMNS =
  "id, activity_type, user_address, amount, token_amount, description, tx_hash, on_chain_timestamp, block_number, fee_charged, created_at"

// ── Export mapping ────────────────────────────────────────────────────────────

export interface ActivityExportRow {
  id: string
  activity_type: string
  user_address: string | null
  amount: number | null
  token_amount: number | null
  description: string | null
  tx_hash: string | null
  block_number: number | null
  fee_charged: number | null
  on_chain_timestamp: string | null
  created_at: string
}

export const ACTIVITY_CSV_HEADERS = [
  "ID",
  "Activity Type",
  "User Address",
  "Amount",
  "Token Amount",
  "Description",
  "Transaction Hash",
  "Ledger",
  "Fee (stroops)",
  "On-chain Timestamp",
  "Created At",
]

export function activityToCsvRow(row: ActivityExportRow): unknown[] {
  return [
    row.id,
    row.activity_type,
    row.user_address ?? "",
    row.amount ?? "",
    row.token_amount ?? "",
    row.description ?? "",
    row.tx_hash ?? "",
    row.block_number ?? "",
    row.fee_charged ?? "",
    row.on_chain_timestamp ?? "",
    row.created_at,
  ]
}

export function exportFilename(poolId: string, format: "csv" | "json", now: Date): string {
  const shortId = poolId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "pool"
  return `pool-activity-${shortId}-${now.toISOString().slice(0, 10)}.${format}`
}
