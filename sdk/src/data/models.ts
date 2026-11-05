/**
 * HTTP read models served by the JointSave app/indexer.
 *
 * Unlike the on-chain domain model in `../types`, these values mirror the
 * JSON API. Monetary fields are **display units as served by the API**
 * (plain numbers), not base-unit `bigint`; use the token decimals in the
 * payload when you need exact on-chain units.
 */
import type {
  GovernanceProposalStatus,
  GovernanceProposalType,
  PoolStatus,
  PoolType,
} from "../types";

/** Cursor-paginated HTTP collection. */
export interface Page<T> {
  /** Rows in this page. */
  items: T[];
  /** Opaque cursor for the next page, or `null` at the end. */
  nextCursor: string | null;
  /** Whether another page is available. */
  hasMore: boolean;
  /** Total number of matching rows, when the server reports it. */
  total?: number;
}

/** Compact pool row used by list and search responses. */
export interface PoolSummary {
  id: string;
  contractAddress: string;
  name: string;
  description: string | null;
  type: PoolType;
  status: PoolStatus;
  creatorAddress: string;
  tokenAddress: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number;
  membersCount: number;
  /** Per-member contribution in display units. */
  contributionAmount: number | null;
  /** Target amount in display units. */
  targetAmount: number | null;
  /** Total saved in display units. */
  totalSaved: number;
  /** Minimum deposit in display units. */
  minimumDeposit: number | null;
  yieldEnabled: boolean;
  /** ISO timestamp. */
  deadline: string | null;
  /** ISO timestamp of the next rotational payout. */
  nextPayout: string | null;
  /** ISO timestamp. */
  createdAt: string | null;
  /** ISO timestamp. */
  archivedAt: string | null;
}

/** A pool member row embedded in a pool detail response. */
export interface PoolMemberSummary {
  id: string;
  address: string;
  contributionAmount: number;
  status: string;
}

/** An activity row embedded in a pool detail response. */
export interface PoolActivityItem {
  id: string;
  activityType: string;
  userAddress: string | null;
  amount: number | null;
  description: string | null;
  /** ISO timestamp. */
  createdAt: string;
  txHash: string | null;
}

/** Full pool row including members and recent activity. */
export interface PoolDetail extends PoolSummary {
  members: PoolMemberSummary[];
  activity: PoolActivityItem[];
}

/** A pool activity/history row from the activity feed. */
export interface PoolEvent {
  id: string;
  poolId: string;
  activityType: string;
  userAddress: string | null;
  amount: number | null;
  description: string | null;
  /** ISO timestamp. */
  createdAt: string;
  txHash: string | null;
}

/** One day of protocol analytics. */
export interface ProtocolDayData {
  /** Day bucket (`YYYY-MM-DD` or subgraph day id). */
  date: string;
  tvlUsd: number;
  dailyVolumeUsd: number;
}

/** A pool row in the protocol leaderboard. */
export interface ProtocolPoolSummary {
  id: string;
  totalValueLockedUsd: number;
  volumeUsd: number;
  isActive: boolean;
}

/** Aggregate protocol analytics. */
export interface ProtocolSummary {
  totalValueLockedUsd: number;
  totalVolumeUsd: number;
  activePools: number;
  totalMembers: number;
  days: ProtocolDayData[];
  topPools: ProtocolPoolSummary[];
}

/** Reputation profile for a single wallet. */
export interface ReputationProfile {
  address: string;
  totalScore: number;
  depositReliability: number;
  poolsCompleted: number;
  poolsJoined: number;
  totalDeposits: number;
  missedDeposits: number;
  /** Unix timestamp (seconds). */
  lastActivity: number;
  /** Unix timestamp (seconds). */
  scoreUpdatedAt: number;
  isProvisional: boolean;
}

/** Reputation leaderboard row. */
export interface ReputationLeaderboardEntry extends ReputationProfile {
  rank: number;
}

/** Governance proposal read model. */
export interface GovernanceProposalSummary {
  id: string;
  poolId: string | null;
  proposalType: GovernanceProposalType;
  description: string;
  status: GovernanceProposalStatus;
  votesFor: number;
  votesAgainst: number;
  /** Unix timestamp (seconds). */
  createdAt: number | null;
  /** Unix timestamp (seconds). */
  expiresAt: number | null;
  /** On-chain parameter map, when present. */
  parameters?: Record<string, string> | undefined;
}

/** Upcoming rotational commitment in a portfolio. */
export interface UpcomingCommitment {
  poolId: string;
  poolName: string;
  amount: number;
  /** ISO timestamp. */
  deadline: string;
  type: string;
}

/** A pool row in a portfolio summary. */
export interface PortfolioPoolSummary {
  id: string;
  name: string;
  type: PoolType;
  status: PoolStatus;
  contribution: number;
  totalBalance: number;
  healthScore: number | null;
  nextAction: string | null;
}

/** Reputation totals embedded in a portfolio summary. */
export interface PortfolioReputationSummary {
  totalDeposits: number;
  averageOnTimeRate: number;
  poolsCompleted: number;
}

/** Cross-pool portfolio summary for a wallet. */
export interface PortfolioSummary {
  totalSaved: number;
  /** Net saved per token symbol. */
  totalSavedByToken: Record<string, number>;
  totalPools: {
    rotational: number;
    target: number;
    flexible: number;
    total: number;
  };
  totalYieldEarned: number;
  upcomingCommitments: UpcomingCommitment[];
  reputationSummary: PortfolioReputationSummary;
  pools: PortfolioPoolSummary[];
}
