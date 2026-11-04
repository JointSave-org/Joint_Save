import type {
  GateAction,
  GateDecision,
  GateReason,
  GateResult,
  GovernanceSnapshot,
  RoundSnapshot,
  StateSnapshot,
  StateSnapshotInput,
} from "./types";

/** Context used to make reason descriptions more specific. */
export interface GateReasonContext {
  poolType?: string | undefined;
  minimumDeposit?: bigint | undefined;
}

const ALLOWED: GateDecision = Object.freeze({ allowed: true, reason: null });

function allow(): GateDecision {
  return ALLOWED;
}

function deny(reason: GateReason): GateDecision {
  return { allowed: false, reason };
}

function toBigInt(value: unknown, fallback: bigint = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeRound(input: Partial<RoundSnapshot> | undefined): RoundSnapshot {
  const round: RoundSnapshot = {
    index: input?.index ?? 0,
    deadlineSecs: input?.deadlineSecs ?? 0,
    completed: input?.completed ?? false,
    paidOut: input?.paidOut ?? false,
  };
  if (input?.funded !== undefined) round.funded = input.funded;
  return round;
}

function normalizeGovernance(input: Partial<GovernanceSnapshot> | undefined): GovernanceSnapshot | undefined {
  if (!input) return undefined;
  const isAdmin = input.viewerIsAdmin ?? false;
  const governance: GovernanceSnapshot = {
    status: input.status ?? "Active",
    votesFor: input.votesFor ?? [],
    votesAgainst: input.votesAgainst ?? [],
    quorum: input.quorum ?? 0,
    viewerVoted: input.viewerVoted ?? false,
    viewerIsAdmin: isAdmin,
    viewerCanPropose: input.viewerCanPropose ?? isAdmin,
    viewerCanExecute: input.viewerCanExecute ?? isAdmin,
  };
  if (input.proposer !== undefined) governance.proposer = input.proposer;
  if (input.expiresAtSecs !== undefined) governance.expiresAtSecs = input.expiresAtSecs;
  return governance;
}

/**
 * Fill safe defaults so partial input never crashes the engine.
 *
 * The engine never reads the clock: pass `nowSecs` here or in `input`.
 */
export function buildSnapshot(input: StateSnapshotInput = {}, nowSecs?: number): StateSnapshot {
  const balances: Record<string, bigint> = {};
  for (const [address, value] of Object.entries(input.balances ?? {})) {
    balances[address] = toBigInt(value);
  }

  const round = normalizeRound(input.round);
  const snapshot: StateSnapshot = {
    poolType: input.poolType ?? "rotational",
    status: input.status ?? "active",
    contractDeployed: input.contractDeployed ?? true,
    members: input.members ?? [],
    round,
    balances,
    depositAmount: toBigInt(input.depositAmount),
    minimumDeposit: toBigInt(input.minimumDeposit),
    nowSecs: nowSecs ?? input.nowSecs ?? 0,
    archived: input.archived ?? false,
    paused: input.paused ?? false,
    viewerIsAdmin: input.viewerIsAdmin ?? false,
    hasDeposited: input.hasDeposited ?? false,
  };

  if (input.viewer !== undefined) snapshot.viewer = input.viewer;
  if (input.requestedAmount !== undefined) snapshot.requestedAmount = toBigInt(input.requestedAmount);
  if (input.liquidBalance !== undefined) snapshot.liquidBalance = toBigInt(input.liquidBalance);

  const governance = normalizeGovernance(input.governance);
  if (governance !== undefined) snapshot.governance = governance;
  if (input.yield !== undefined) snapshot.yield = input.yield;

  return snapshot;
}

function isMember(snapshot: StateSnapshot): boolean {
  return snapshot.viewer !== undefined && snapshot.members.includes(snapshot.viewer);
}

function viewerBalance(snapshot: StateSnapshot): bigint {
  if (snapshot.viewer === undefined) return 0n;
  return snapshot.balances[snapshot.viewer] ?? 0n;
}

function canGovern(snapshot: StateSnapshot): boolean {
  return (
    snapshot.viewerIsAdmin === true ||
    snapshot.governance?.viewerIsAdmin === true ||
    snapshot.governance?.viewerCanExecute === true
  );
}

function isFullyFunded(snapshot: StateSnapshot): boolean {
  if (snapshot.round.funded !== undefined) return snapshot.round.funded;
  if (snapshot.members.length === 0) return false;
  return snapshot.members.every(
    (member) => (snapshot.balances[member] ?? 0n) >= snapshot.depositAmount
  );
}

function deploymentGate(snapshot: StateSnapshot): GateReason | null {
  if (!snapshot.contractDeployed) return "contract_not_deployed";
  if (snapshot.status === "archived" || snapshot.archived) return "pool_archived";
  if (snapshot.status === "paused" || snapshot.paused) return "pool_paused";
  return null;
}

function activePoolGate(snapshot: StateSnapshot): GateReason | null {
  const deployment = deploymentGate(snapshot);
  if (deployment) return deployment;
  if (snapshot.status !== "active") return "pool_not_active";
  return null;
}

function depositGate(snapshot: StateSnapshot): GateDecision {
  const active = activePoolGate(snapshot);
  if (active) return deny(active);
  if (!isMember(snapshot)) return deny("not_member");

  if (snapshot.poolType === "rotational") {
    if (snapshot.round.completed || snapshot.round.paidOut) return deny("round_complete");
    if (snapshot.hasDeposited) return deny("already_deposited");
    return allow();
  }

  if (snapshot.poolType === "target") {
    if (snapshot.round.completed) return deny("round_complete");
    if (snapshot.round.deadlineSecs > 0 && snapshot.nowSecs > snapshot.round.deadlineSecs) {
      return deny("deadline_passed");
    }
  }

  const amount = snapshot.requestedAmount ?? snapshot.depositAmount;
  if (amount < snapshot.minimumDeposit) return deny("below_minimum");
  return allow();
}

function withdrawGate(snapshot: StateSnapshot): GateDecision {
  const deployment = deploymentGate(snapshot);
  if (deployment) return deny(deployment);
  if (snapshot.status === "pending_deployment") return deny("pool_not_active");
  if (!isMember(snapshot)) return deny("not_member");
  if (snapshot.poolType === "rotational") return deny("unsupported_action");
  if (snapshot.poolType === "target" && snapshot.status === "active") return deny("target_locked");

  const balance = viewerBalance(snapshot);
  if (balance <= 0n) return deny("insufficient_balance");

  const requested = snapshot.requestedAmount ?? balance;
  if (requested > balance) return deny("insufficient_balance");

  const liquid = snapshot.liquidBalance ?? balance;
  if (requested > liquid) return deny("vault_illiquid");

  return allow();
}

function triggerPayoutGate(snapshot: StateSnapshot): GateDecision {
  const active = activePoolGate(snapshot);
  if (active) return deny(active);
  if (snapshot.poolType !== "rotational") return deny("unsupported_action");
  if (snapshot.round.completed || snapshot.round.paidOut) return deny("already_paid");
  if (snapshot.round.deadlineSecs > 0 && snapshot.nowSecs < snapshot.round.deadlineSecs) {
    return deny("too_early");
  }
  if (!isFullyFunded(snapshot)) return deny("not_funded");
  return allow();
}

function createProposalGate(snapshot: StateSnapshot): GateDecision {
  if (!snapshot.contractDeployed) return deny("contract_not_deployed");
  if (snapshot.status === "archived" || snapshot.archived) return deny("pool_archived");
  const canPropose =
    snapshot.viewerIsAdmin === true || snapshot.governance?.viewerCanPropose === true;
  if (!canPropose) return deny("not_admin");
  return allow();
}

function voteGate(snapshot: StateSnapshot): GateDecision {
  if (!snapshot.contractDeployed) return deny("contract_not_deployed");
  if (!snapshot.governance) return deny("proposal_not_active");
  if (!isMember(snapshot)) return deny("not_member");
  if (snapshot.governance.status !== "Active") return deny("proposal_not_active");
  if (snapshot.governance.viewerVoted) return deny("already_voted");
  if (
    snapshot.governance.expiresAtSecs !== undefined &&
    snapshot.nowSecs > snapshot.governance.expiresAtSecs
  ) {
    return deny("proposal_expired");
  }
  return allow();
}

function quorumMet(snapshot: StateSnapshot): boolean {
  const governance = snapshot.governance;
  if (!governance) return false;
  if (snapshot.members.length === 0) return governance.votesFor.length === 0 && governance.quorum === 0;
  return governance.votesFor.length * 100 >= governance.quorum * snapshot.members.length;
}

function executeGate(snapshot: StateSnapshot): GateDecision {
  if (!snapshot.contractDeployed) return deny("contract_not_deployed");
  if (!snapshot.governance) return deny("proposal_not_active");
  const canExecute =
    snapshot.viewerIsAdmin === true || snapshot.governance.viewerCanExecute === true;
  if (!canExecute) return deny("not_admin");
  if (!quorumMet(snapshot)) return deny("quorum_not_met");
  if (snapshot.governance.status !== "Passed") return deny("proposal_not_active");
  return allow();
}

function allocateYieldGate(snapshot: StateSnapshot): GateDecision {
  const active = activePoolGate(snapshot);
  if (active) return deny(active);
  if (snapshot.viewerIsAdmin !== true) return deny("not_admin");
  if (!snapshot.yield) return deny("yield_disabled");
  if (snapshot.yield.locked) return deny("vault_locked");
  if (snapshot.yield.maxAllocatable <= 0n) return deny("buffer_exhausted");
  if (
    snapshot.requestedAmount !== undefined &&
    snapshot.requestedAmount > snapshot.yield.maxAllocatable
  ) {
    return deny("buffer_exhausted");
  }
  return allow();
}

function deallocateYieldGate(snapshot: StateSnapshot): GateDecision {
  if (!snapshot.contractDeployed) return deny("contract_not_deployed");
  if (!snapshot.yield) return deny("yield_disabled");
  if (!isMember(snapshot) && !canGovern(snapshot)) return deny("not_member");
  if (snapshot.yield.position <= 0n) return deny("not_allocated");
  return allow();
}

function syncYieldGate(snapshot: StateSnapshot): GateDecision {
  if (!snapshot.contractDeployed) return deny("contract_not_deployed");
  if (!snapshot.yield) return deny("yield_disabled");
  if (!isMember(snapshot) && !canGovern(snapshot)) return deny("not_member");
  if (snapshot.yield.position <= 0n) return deny("not_allocated");
  return allow();
}

/**
 * Compute deterministic eligibility for every supported action.
 *
 * The result is a frozen object with an entry for every {@link GateAction}.
 */
export function computeActionEligibility(snapshot: StateSnapshot): GateResult {
  const result: GateResult = {
    deposit: depositGate(snapshot),
    withdraw: withdrawGate(snapshot),
    contribute: depositGate(snapshot),
    triggerPayout: triggerPayoutGate(snapshot),
    claim: withdrawGate(snapshot),
    createProposal: createProposalGate(snapshot),
    vote: voteGate(snapshot),
    execute: executeGate(snapshot),
    allocateYield: allocateYieldGate(snapshot),
    deallocateYield: deallocateYieldGate(snapshot),
    syncYield: syncYieldGate(snapshot),
  };
  return Object.freeze(result) as GateResult;
}

/** True when the action is allowed. */
export function isGateAllowed(result: GateResult, action: GateAction): boolean {
  return result[action]?.allowed === true;
}

/** True when the action is blocked. */
export function isGateBlocked(result: GateResult, action: GateAction): boolean {
  return !isGateAllowed(result, action);
}

const REASON_TEXT: Record<GateReason, string> = {
  not_member: "Only pool members can perform this action.",
  pool_not_active: "This pool is not active.",
  pool_archived: "This pool has been archived.",
  pool_paused: "This pool is paused.",
  contract_not_deployed: "The pool contract has not been deployed yet.",
  round_complete: "This round is already complete.",
  already_paid: "This round has already been paid out.",
  below_minimum: "The amount is below the pool minimum.",
  insufficient_balance: "You do not have enough balance for this action.",
  proposal_not_active: "This proposal is not open for this action.",
  already_voted: "You have already voted on this proposal.",
  quorum_not_met: "The proposal has not reached quorum.",
  not_admin: "Only an admin can perform this action.",
  vault_locked: "Yield allocation is currently locked.",
  vault_illiquid: "The requested amount is not currently liquid.",
  not_allocated: "There is no yield allocation to act on.",
  target_locked: "This target pool has not been unlocked yet.",
  unsupported_action: "This action is not supported for this pool type.",
  already_deposited: "You have already deposited this round.",
  deadline_passed: "The pool deadline has passed.",
  too_early: "It is too early to trigger a payout.",
  not_funded: "The round is not fully funded yet.",
  buffer_exhausted: "The liquidity buffer leaves no room to allocate.",
  yield_disabled: "Yield is not enabled for this pool.",
  proposal_expired: "This proposal has expired.",
};

/**
 * Human-readable copy for a gate reason.
 *
 * Returns an empty string for `null` so callers can pass an optional reason.
 */
export function describeGateReason(
  reason: GateReason | null | undefined,
  context: GateReasonContext = {}
): string {
  if (!reason) return "";
  if (reason === "below_minimum" && context.minimumDeposit !== undefined) {
    return `The amount is below the pool minimum of ${context.minimumDeposit.toString()} base units.`;
  }
  if (reason === "unsupported_action" && context.poolType) {
    return `${context.poolType} pools do not support this action.`;
  }
  return REASON_TEXT[reason];
}
