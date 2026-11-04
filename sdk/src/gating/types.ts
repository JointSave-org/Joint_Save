import type {
  GovernanceProposalStatus,
  PoolStatus,
  PoolType,
  YieldAllocationState,
} from "../types";

/** Actions the eligibility engine can gate. */
export type GateAction =
  | "deposit"
  | "withdraw"
  | "contribute"
  | "triggerPayout"
  | "claim"
  | "createProposal"
  | "vote"
  | "execute"
  | "allocateYield"
  | "deallocateYield"
  | "syncYield";

/** Stable, machine-readable reasons an action is blocked. */
export type GateReason =
  | "not_member"
  | "pool_not_active"
  | "pool_archived"
  | "pool_paused"
  | "contract_not_deployed"
  | "round_complete"
  | "already_paid"
  | "below_minimum"
  | "insufficient_balance"
  | "proposal_not_active"
  | "already_voted"
  | "quorum_not_met"
  | "not_admin"
  | "vault_locked"
  | "vault_illiquid"
  | "not_allocated"
  | "target_locked"
  | "unsupported_action"
  | "already_deposited"
  | "deadline_passed"
  | "too_early"
  | "not_funded"
  | "buffer_exhausted"
  | "yield_disabled"
  | "proposal_expired";

/** Every stable reason code, useful for exhaustive docs/tests. */
export const GATE_REASONS = [
  "not_member",
  "pool_not_active",
  "pool_archived",
  "pool_paused",
  "contract_not_deployed",
  "round_complete",
  "already_paid",
  "below_minimum",
  "insufficient_balance",
  "proposal_not_active",
  "already_voted",
  "quorum_not_met",
  "not_admin",
  "vault_locked",
  "vault_illiquid",
  "not_allocated",
  "target_locked",
  "unsupported_action",
  "already_deposited",
  "deadline_passed",
  "too_early",
  "not_funded",
  "buffer_exhausted",
  "yield_disabled",
  "proposal_expired",
] as const satisfies readonly GateReason[];

/** Outcome for a single action. */
export interface GateDecision {
  allowed: boolean;
  /** Never `null` when `allowed` is `false`. */
  reason: GateReason | null;
}

/** Eligibility for every supported action. */
export type GateResult = Record<GateAction, GateDecision>;

/** Round data needed to gate deposits and payouts. */
export interface RoundSnapshot {
  index: number;
  /** Unix seconds at which deposits close / a payout becomes eligible. */
  deadlineSecs: number;
  completed: boolean;
  paidOut: boolean;
  /** Whether every member has deposited. Derived from balances when omitted. */
  funded?: boolean | undefined;
}

/** Governance data needed to gate proposals, votes, and execution. */
export interface GovernanceSnapshot {
  proposer?: string | undefined;
  status: GovernanceProposalStatus;
  votesFor: string[];
  votesAgainst: string[];
  /** Percentage (0–100) of members that must vote in favour. */
  quorum: number;
  viewerVoted: boolean;
  expiresAtSecs?: number | undefined;
  viewerIsAdmin?: boolean | undefined;
  viewerCanPropose?: boolean | undefined;
  viewerCanExecute?: boolean | undefined;
}

/** Everything the engine is allowed to look at. */
export interface StateSnapshot {
  poolType: PoolType;
  status: PoolStatus;
  contractDeployed: boolean;
  members: string[];
  viewer?: string | undefined;
  round: RoundSnapshot;
  balances: Record<string, bigint>;
  depositAmount: bigint;
  minimumDeposit: bigint;
  governance?: GovernanceSnapshot | undefined;
  yield?: YieldAllocationState | undefined;
  nowSecs: number;
  archived?: boolean | undefined;
  paused?: boolean | undefined;
  viewerIsAdmin?: boolean | undefined;
  hasDeposited?: boolean | undefined;
  /** Amount the caller wants to move; defaults to the viewer's balance. */
  requestedAmount?: bigint | undefined;
  /** Portion of the viewer's balance that can be withdrawn immediately. */
  liquidBalance?: bigint | undefined;
}

/** Partial input accepted by {@link buildSnapshot}. */
export interface StateSnapshotInput
  extends Partial<Omit<StateSnapshot, "round" | "governance" | "balances">> {
  round?: Partial<RoundSnapshot> | undefined;
  governance?: Partial<GovernanceSnapshot> | undefined;
  balances?: Record<string, bigint> | undefined;
}
