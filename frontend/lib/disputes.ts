// Pure dispute-resolution domain helpers (issue #207/#208). Framework-free so
// it runs under the node test runner.

export const DISPUTE_DESCRIPTION_MAX_LENGTH = 2000
export const DISPUTE_MAX_EVIDENCE_URLS = 3
/** Disputes auto-expire 72 hours after filing. */
export const DISPUTE_EXPIRY_HOURS = 72

export type DisputeType =
  "missed_deposit" | "unfair_penalty" | "admin_abuse" | "member_misconduct" | "other"

export type DisputeStatus = "open" | "voting" | "resolved_upheld" | "resolved_dismissed" | "expired"

export interface EvidenceUrlValidation {
  valid: string[]
  invalid: string[]
}

/** Row shape of the `disputes` table as returned by /api/disputes. */
export interface DisputeRecord {
  id: string
  pool_id: string
  filer_address: string
  target_address: string | null
  dispute_type: string
  description: string
  evidence_urls: string[]
  status: string
  resolution: string | null
  votes_for: number
  votes_against: number
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  expires_at: string
}

export function isDisputeType(value: unknown): value is DisputeType {
  return (
    value === "missed_deposit" ||
    value === "unfair_penalty" ||
    value === "admin_abuse" ||
    value === "member_misconduct" ||
    value === "other"
  )
}

/**
 * Votes required for one side to win: at least half of the pool members.
 * Mirrors the contract of the vote endpoint — a filer/target cannot vote, but
 * they still count toward the pool size.
 */
export function votesNeededToResolve(totalMembers: number): number {
  if (!Number.isFinite(totalMembers) || totalMembers <= 0) return 0
  return Math.ceil(totalMembers / 2)
}

export function isDisputeExpired(expiresAtIso: string, nowMs: number): boolean {
  return new Date(expiresAtIso).getTime() <= nowMs
}

/** Human-readable countdown ("2d 4h", "5h 03m", "<1m"). */
export function formatDisputeTimeRemaining(expiresAtIso: string, nowMs: number): string {
  const diff = new Date(expiresAtIso).getTime() - nowMs
  if (diff <= 0) return "Expired"
  const minutesTotal = Math.floor(diff / 60_000)
  if (minutesTotal < 1) return "<1m"
  const hours = Math.floor(minutesTotal / 60) % 24
  const days = Math.floor(minutesTotal / 1440)
  const minutes = minutesTotal % 60
  if (days > 0) return `${days}d ${hours.toString().padStart(2, "0")}h`
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`
  return `${minutes}m`
}

const URL_RE = /^https?:\/\/[^\s]+$/i

/** Split candidate evidence URLs into acceptable and rejected entries. */
export function validateEvidenceUrls(urls: unknown): EvidenceUrlValidation {
  const list = Array.isArray(urls) ? urls.filter((u): u is string => typeof u === "string") : []
  const trimmed = list
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .slice(0, DISPUTE_MAX_EVIDENCE_URLS)
  return {
    valid: trimmed.filter((u) => URL_RE.test(u)),
    invalid: trimmed.filter((u) => !URL_RE.test(u)),
  }
}

/**
 * Whether `voter` may cast a vote on the given dispute. Filers and targets are
 * excluded; everyone else in the pool may vote exactly once.
 */
export function canVoteOnDispute(
  voterAddress: string,
  dispute: { filer_address: string; target_address: string | null },
  alreadyVoted: boolean
): boolean {
  if (!voterAddress || alreadyVoted) return false
  if (voterAddress.toLowerCase() === dispute.filer_address.toLowerCase()) return false
  if (dispute.target_address && voterAddress.toLowerCase() === dispute.target_address.toLowerCase())
    return false
  return true
}
