export {
  GATE_REASONS,
  type GateAction,
  type GateDecision,
  type GateReason,
  type GateResult,
  type GovernanceSnapshot,
  type RoundSnapshot,
  type StateSnapshot,
  type StateSnapshotInput,
} from "./types";
export {
  buildSnapshot,
  computeActionEligibility,
  describeGateReason,
  isGateAllowed,
  isGateBlocked,
  type GateReasonContext,
} from "./engine";
