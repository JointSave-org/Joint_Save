// Pure governance-domain helpers shared by the hooks, components and tests.
// Kept framework-free so it can be unit-tested with the node test runner.

export type GovernanceProposalStatus = "Active" | "Passed" | "Executed" | "Expired" | "Rejected"

export type GovernanceProposalType =
  | "ChangeDepositAmount"
  | "ExtendDeadline"
  | "AddPenalty"
  | "RemovePenalty"
  | "ChangeQuorum"
  | "Custom"

export interface GovernanceProposal {
  id: string
  proposer: string
  proposalType: GovernanceProposalType
  description: string
  votesFor: string[]
  votesAgainst: string[]
  status: GovernanceProposalStatus
  createdAt: number
  expiresAt: number
}

/** Metadata driving the create-proposal dialog's dynamic form fields. */
export const PROPOSAL_TYPES: Array<{
  value: GovernanceProposalType
  label: string
  paramKey: string
  paramLabel: string
}> = [
  {
    value: "ChangeDepositAmount",
    label: "Change Deposit Amount",
    paramKey: "deposit_amount",
    paramLabel: "New deposit amount",
  },
  {
    value: "ExtendDeadline",
    label: "Extend Deadline",
    paramKey: "seconds",
    paramLabel: "Extension (seconds)",
  },
  {
    value: "AddPenalty",
    label: "Add Penalty",
    paramKey: "percentage",
    paramLabel: "Penalty percentage (0-100)",
  },
  {
    value: "RemovePenalty",
    label: "Remove Penalty",
    paramKey: "",
    paramLabel: "",
  },
  {
    value: "ChangeQuorum",
    label: "Change Quorum",
    paramKey: "quorum",
    paramLabel: "New quorum percentage (1-100)",
  },
]

export const GOVERNANCE_DESCRIPTION_MAX = 500

/**
 * Minimum "for" votes required to meet the quorum percentage of the pool.
 * Mirrors the contract check: votes * 100 >= quorumPct * totalMembers.
 */
export function votesNeededForQuorum(quorumPct: number, totalMembers: number): number {
  if (!Number.isFinite(quorumPct) || !Number.isFinite(totalMembers)) return 0
  if (quorumPct <= 0 || totalMembers <= 0) return 0
  return Math.ceil((quorumPct * totalMembers) / 100)
}

export function meetsQuorum(votesFor: number, quorumPct: number, totalMembers: number): boolean {
  if (votesFor <= 0) return false
  return votesFor >= votesNeededForQuorum(quorumPct, totalMembers)
}

/** Human-readable time left before a proposal expires ("23h 12m"). */
export function formatTimeRemaining(expiresAtSecs: number, nowSecs: number): string {
  const diff = expiresAtSecs - nowSecs
  if (diff <= 0) return "Expired"
  const hours = Math.floor(diff / 3600)
  const minutes = Math.floor((diff % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`
  if (minutes > 0) return `${minutes}m`
  return "<1m"
}

/**
 * Encode an i128 parameter as exactly 16 bytes of big-endian hex — the wire
 * format the governance contract expects inside its parameters map.
 */
export function encodeParamHex(value: bigint | number): string {
  const v = typeof value === "bigint" ? value : BigInt(Math.trunc(value))
  if (v < 0n) throw new Error("parameter must be non-negative")
  if (v >= 1n << 128n) throw new Error("parameter exceeds i128 range")
  return v.toString(16).padStart(32, "0")
}

/** Decode a hex-encoded execution result payload written by the contract. */
export function decodeExecutionResult(hex: string): string {
  if (!hex || /[^0-9a-fA-F]/.test(hex) || hex.length % 2 !== 0) return ""
  const pairs = hex.match(/.{2}/g) ?? []
  return Buffer.from(pairs.map((b) => parseInt(b, 16))).toString("utf8")
}

const STATUS_ORDER: Record<GovernanceProposalStatus, number> = {
  Active: 0,
  Passed: 1,
  Executed: 2,
  Rejected: 3,
  Expired: 4,
}

/**
 * Merge active + recent proposals into one deduplicated feed ordered by
 * lifecycle priority then newest first.
 */
export function mergeProposals(
  active: GovernanceProposal[],
  recent: GovernanceProposal[]
): GovernanceProposal[] {
  const byId = new Map<string, GovernanceProposal>()
  for (const p of recent) byId.set(p.id, p)
  for (const p of active) byId.set(p.id, p)
  return [...byId.values()].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (statusDiff !== 0) return statusDiff
    return b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)
  })
}
