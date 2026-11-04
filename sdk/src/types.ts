/**
 * Shared domain model for JointSave.
 *
 * All monetary values are **base-unit `bigint`** (integer stroops / token
 * base units), never floating point. Convert with the helpers in `./utils`
 * before display.
 */

// ── Networks & configuration ─────────────────────────────────────────────────

/** A Stellar network the SDK can target. */
export type NetworkName = "testnet" | "mainnet";

/** Resolved network endpoints and identifiers. */
export interface NetworkConfig {
  /** The network this config describes. */
  readonly name: NetworkName;
  /** Stellar network passphrase used when signing transactions. */
  readonly networkPassphrase: string;
  /** Soroban RPC endpoint. */
  readonly rpcUrl: string;
  /** Horizon endpoint (used for account/sequence and history lookups). */
  readonly horizonUrl: string;
  /** Base URL for the Stellar Expert explorer on this network. */
  readonly explorerUrl: string;
  /** Contract id of the network's native XLM Stellar Asset Contract. */
  readonly nativeSacId: string;
}

/**
 * Well-known JointSave contract ids. Only `factory` is required; supporting
 * contracts are optional because they may not be deployed on every network.
 */
export interface ContractIds {
  /** JointSaveFactory — registry that deploys and tracks pools. */
  factory: string;
  /** Reputation contract. */
  reputation?: string;
  /** Governance contract. */
  governance?: string;
  /** Microloan (P2P lending) contract. */
  microloan?: string;
  /** Yield vault adapter contract. */
  yieldVault?: string;
  /** Yield strategy / routing contract. */
  yieldStrategy?: string;
  /** Default deposit token (SAC) contract. */
  token?: string;
}

/** Input shape for `resolveContractIds` — allows `undefined` values. */
export type ContractIdsInput = {
  readonly [K in keyof ContractIds]?: string | undefined;
};

/** Full configuration accepted by `JointSaveClient`. */
export interface JointSaveConfig {
  /** Target network. */
  network: NetworkName;
  /** Deployed contract ids. */
  contractIds: ContractIds;
  /** Override the network's default RPC URL. */
  rpcUrl?: string;
  /** Override the network's default Horizon URL. */
  horizonUrl?: string;
  /** Override the network's default passphrase (rarely needed). */
  networkPassphrase?: string;
  /** Default transaction timeout in seconds. */
  defaultTimeoutSeconds?: number;
}

// ── Tokens ───────────────────────────────────────────────────────────────────

/** Token metadata read from a Stellar Asset Contract. */
export interface TokenMetadata {
  /** Human-readable token name. */
  name: string;
  /** Ticker symbol, e.g. `USDC`. */
  symbol: string;
  /** Number of decimal places used by the token. */
  decimals: number;
}

// ── Pools ────────────────────────────────────────────────────────────────────

/** The three savings pool modes. */
export type PoolType = "rotational" | "target" | "flexible";

/** Pool lifecycle state as tracked by the app. */
export type PoolStatus =
  | "pending_deployment"
  | "active"
  | "paused"
  | "completed"
  | "archived";

/** Parameters for a rotational pool. */
export interface RotationalPoolConfig {
  type: "rotational";
  /** Fixed per-member deposit, in base units. */
  depositAmount: bigint;
  /** Round length in ledgers (Stellar closes roughly every 5s). */
  cycleDurationLedgers: number;
  /** Maximum number of members. */
  maxMembers: number;
  /** Treasury fee on each payout, in basis points. */
  treasuryFeeBps?: number;
  /** Relayer fee for triggering payouts, in basis points. */
  relayerFeeBps?: number;
}

/** Parameters for a target pool. */
export interface TargetPoolConfig {
  type: "target";
  /** Savings goal, in base units. */
  targetAmount: bigint;
  /** Ledger at which the pool unlocks / expires. */
  deadlineLedger: number;
}

/** Parameters for a flexible pool. */
export interface FlexiblePoolConfig {
  type: "flexible";
  /** Minimum deposit, in base units. */
  minDeposit?: bigint;
  /** Whether vault-backed yield allocation is enabled. */
  yieldEnabled?: boolean;
  /** Liquidity buffer held back from yield, in basis points. */
  bufferBps?: number;
}

/** Discriminated union of all pool configurations. */
export type PoolConfig =
  | RotationalPoolConfig
  | TargetPoolConfig
  | FlexiblePoolConfig;

/** A pool participant. */
export interface Member {
  /** Stellar account or contract address (`G…` / `C…`). */
  address: string;
  /** Ledger at which the member joined, when known. */
  joinedAtLedger?: number;
}

/** A member's membership in a specific pool. */
export interface Membership {
  /** Member address. */
  member: string;
  /** Pool contract id. */
  poolId: string;
  /** Unix timestamp (seconds) the member joined. */
  joinedAt: number;
  /** Whether the member has deposited in the current round. */
  hasDeposited: boolean;
}

/** A single deposit into a pool. */
export interface Contribution {
  /** Depositor address. */
  member: string;
  /** Amount deposited, in base units. */
  amount: bigint;
  /** Ledger the deposit was recorded in. */
  ledger: number;
  /** Whether the deposit landed before the round deadline. */
  onTime: boolean;
}

/** A round in a rotational pool. */
export interface Round {
  /** Zero-based round index. */
  index: number;
  /** Recipient of this round's payout, when assigned. */
  payoutRecipient?: string;
  /** Deposits recorded in the round. */
  deposits: Contribution[];
  /** Ledger the round started at. */
  startedAtLedger: number;
  /** Ledger the round's deposits are due by. */
  deadlineLedger: number;
  /** Whether the round has been completed / paid out. */
  completed: boolean;
}

/** Rotational pool on-chain state. */
export interface RotationalPoolState {
  /** Whether the pool is accepting deposits. */
  isActive: boolean;
  /** Current round index. */
  currentRound: number;
  /** Member addresses. */
  members: string[];
  /** Unix timestamp (seconds) of the next payout. */
  nextPayoutTime: number;
  /** Whether the querying user has deposited this round. */
  hasDeposited: boolean;
  /** Number of members who deposited this round. */
  depositCount: number;
  /** Treasury fee in basis points, when configured. */
  treasuryFeeBps: number | null;
  /** Relayer fee in basis points, when configured. */
  relayerFeeBps: number | null;
  /** Contract version reported on-chain, when available. */
  contractVersion: number | null;
}

/** Target pool on-chain state. */
export interface TargetPoolState {
  /** Whether the goal has been reached / funds unlocked. */
  isUnlocked: boolean;
  /** Total deposited into the pool, in base units. */
  totalDeposited: bigint;
  /** Savings goal, in base units. */
  targetAmount: bigint;
  /** The querying user's balance, in base units. */
  userBalance: bigint;
  /** Ledger at which the pool expires. */
  deadlineLedger: number;
  /** Contract version reported on-chain, when available. */
  contractVersion: number | null;
}

/** Flexible pool on-chain state. */
export interface FlexiblePoolState {
  /** Whether the pool is accepting deposits. */
  isActive: boolean;
  /** Total pool balance, in base units. */
  totalBalance: bigint;
  /** The querying user's balance, in base units. */
  userBalance: bigint;
  /** Contract version reported on-chain, when available. */
  contractVersion: number | null;
}

/** Union of the per-mode pool states. */
export type PoolState =
  | RotationalPoolState
  | TargetPoolState
  | FlexiblePoolState;

// ── Governance ───────────────────────────────────────────────────────────────

/** Governance proposal lifecycle. */
export type GovernanceProposalStatus =
  | "Active"
  | "Passed"
  | "Executed"
  | "Expired"
  | "Rejected";

/** Proposal kinds understood by the governance contract. */
export type GovernanceProposalType =
  | "ChangeDepositAmount"
  | "ExtendDeadline"
  | "AddPenalty"
  | "RemovePenalty"
  | "ChangeQuorum"
  | "Custom"
  | "YieldAllocation";

/** A governance proposal. */
export interface GovernanceProposal {
  /** Proposal id (stringified on-chain id). */
  id: string;
  /** Proposer address. */
  proposer: string;
  /** Proposal kind. */
  proposalType: GovernanceProposalType;
  /** Human-readable description. */
  description: string;
  /** Addresses that voted in favour. */
  votesFor: string[];
  /** Addresses that voted against. */
  votesAgainst: string[];
  /** Current status. */
  status: GovernanceProposalStatus;
  /** Unix timestamp (seconds) the proposal was created. */
  createdAt: number;
  /** Unix timestamp (seconds) the proposal expires. */
  expiresAt: number;
  /** Raw parameter map (hex-encoded bytes), when present on-chain. */
  parameters?: Record<string, string>;
}

/** Direction of a yield-allocation governance action. */
export type YieldAllocationAction = "alloc" | "dealloc";

/** Input for a `Custom` yield-allocation proposal. */
export interface YieldProposalInput {
  /** Allocate idle capital or de-allocate it. */
  action: YieldAllocationAction;
  /** Vault contract id — required for allocation. */
  vault?: string;
  /** Amount in base units (ignored by full de-allocation). */
  amountBaseUnits: bigint;
}

// ── Yield allocation ─────────────────────────────────────────────────────────

/** Vault-backed yield state for a flexible pool. */
export interface YieldAllocationState {
  /** Allocated vault contract id, or `null` when none. */
  vault: string | null;
  /** Vault shares held by the pool. */
  shares: bigint;
  /** Principal pushed into the vault, in base units. */
  costBasis: bigint;
  /** Liquidity buffer, in basis points. */
  bufferBps: number;
  /** Whether the position is currently locked / illiquid. */
  locked: boolean;
  /** Current value of the position, in base units. */
  position: bigint;
  /** Unrealised gain (position − costBasis), in base units. */
  unrealised: bigint;
  /** Maximum amount that may be allocated right now, in base units. */
  maxAllocatable: bigint;
}

// ── Reputation ───────────────────────────────────────────────────────────────

/** Compact reputation score. */
export interface ReputationScore {
  /** Total deposited, in base units. */
  totalDeposits: bigint;
  /** Pools completed. */
  poolsCompleted: number;
  /** Rounds missed. */
  missedRounds: number;
  /** On-time rate in basis points (10000 = 100%). */
  onTimeRate: number;
}

/** Full reputation dataset from the v2 scoring system. */
export interface ReputationData {
  /** Normalised score, 0–1000. */
  totalScore: number;
  /** Deposit reliability, 0–1000. */
  depositReliability: number;
  /** Pools completed. */
  poolsCompleted: number;
  /** Pools joined. */
  poolsJoined: number;
  /** Total deposits (count). */
  totalDeposits: number;
  /** Missed deposits (count). */
  missedDeposits: number;
  /** Unix timestamp (seconds) of the last recorded activity. */
  lastActivity: number;
  /** Unix timestamp (seconds) the score was last computed. */
  scoreUpdatedAt: number;
  /** True when the member has fewer than 10 deposits. */
  isProvisional: boolean;
}

// ── Activity ─────────────────────────────────────────────────────────────────

/** A pool activity row, from on-chain events or the off-chain index. */
export interface ActivityEvent {
  /** Stable row id. */
  id: string;
  /** Event type, e.g. `deposit`, `payout`, `withdraw`, `yield`. */
  activity_type: string;
  /** Actor address, when known. */
  user_address: string | null;
  /** Amount involved, when known. */
  amount: number | null;
  /** Human-readable description. */
  description: string | null;
  /** ISO timestamp. */
  created_at: string;
  /** Transaction hash, when on-chain. */
  tx_hash: string | null;
  /** Whether the row came from chain events or Supabase. */
  source: "onchain" | "offchain";
}

// ── Results ──────────────────────────────────────────────────────────────────

/** Lifecycle phase of a submitted contract transaction. */
export type TxPhase = "signing" | "submitted" | "confirmed";

/** Result of a submitted transaction. */
export interface TxResult {
  /** Transaction hash. */
  hash: string;
  /** Ledger the transaction was included in, when confirmed. */
  ledger?: number;
  /** Current known status. */
  status: "pending" | "success" | "failed";
}

/** Discriminated result for read operations. */
export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
