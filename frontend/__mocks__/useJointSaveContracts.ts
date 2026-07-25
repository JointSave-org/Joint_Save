/**
 * Mock implementations for @/hooks/useJointSaveContracts
 *
 * MAINTAINER NOTE:
 * This mock uses vi.fn() for all hook return values. When the real hooks change
 * (e.g., new fields added to return values), TypeScript will flag mismatches.
 * Tests that need specific behavior should override these defaults.
 */

import { vi } from "vitest"

// ── Constants (mirrored from real implementation) ────────────────────────────

export const NATIVE_SAC_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
export const NATIVE_TOKEN_METADATA = {
  symbol: "XLM",
  name: "Stellar Lumens",
  decimals: 7,
}

// ── Utility functions (minimal stubs) ─────────────────────────────────────────

export const resolveTokenAddress = (tokenId: string) => tokenId || NATIVE_SAC_ID

export const getRpc = vi.fn().mockReturnValue({
  getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
  getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
})

export const formatTokenAmount = (amount: bigint, decimals = 7): number =>
  Number(amount) / Math.pow(10, decimals)

export const stroopsToXlm = (stroops: bigint): number => Number(stroops) / 10_000_000

export const ledgerToEstimatedDate = (_ledger: number, _current = 1000) => new Date()

// ── Read-only fetchers ────────────────────────────────────────────────────────

export const fetchTokenMetadata = vi.fn().mockResolvedValue(NATIVE_TOKEN_METADATA)

export const fetchRotationalState = vi.fn().mockResolvedValue({
  currentRound: 0,
  roundDuration: 86400,
  contributionAmount: 1000000000n,
  members: ["GBX...", "GAY..."],
  nextPayoutTime: 1700000000,
  isActive: true,
  hasDeposited: false,
  depositCount: 0,
  treasuryFeeBps: 100,
  relayerFeeBps: 50,
})

export const fetchTargetState = vi.fn().mockResolvedValue({
  targetAmount: 5000000000n,
  totalDeposited: 2500000000n,
  deadlineLedger: 1700000000,
  userBalance: 1000000000n,
  isUnlocked: false,
})

export const fetchFlexibleState = vi.fn().mockResolvedValue({
  totalBalance: 10000000000n,
  userBalance: 2000000000n,
  isActive: true,
})

export const fetchContractEvents = vi.fn().mockResolvedValue([])
export const fetchPoolMembers = vi.fn().mockResolvedValue(["GBX1234567890TESTADDRESS"])
export const fetchIsPaused = vi.fn().mockResolvedValue(false)
export const fetchFactoryPools = vi
  .fn()
  .mockResolvedValue({ rotational: [], target: [], flexible: [] })
export const fetchPoolAdmin = vi.fn().mockResolvedValue("GBX1234567890TESTADDRESS")
export const fetchReputation = vi.fn().mockResolvedValue({
  totalDeposits: 0n,
  poolsCompleted: 0,
  missedRounds: 0,
  onTimeRate: 10000,
})
export const fetchPoolTtl = vi.fn().mockResolvedValue(30)

// ── Hook mocks ────────────────────────────────────────────────────────────────
// Each hook returns a standardized shape: { action: vi.fn(), isLoading: false, error?: null }
// Tests can call mockReturnValue() on individual hooks to customize behavior.

export const useDeployPool = vi.fn().mockReturnValue({
  deploy: vi.fn().mockResolvedValue("C_MOCK_CONTRACT_ADDRESS"),
  isLoading: false,
})

export const useInitializePool = vi.fn().mockReturnValue({
  initRotational: vi.fn().mockResolvedValue("tx_hash_init_rotational"),
  initTarget: vi.fn().mockResolvedValue("tx_hash_init_target"),
  initFlexible: vi.fn().mockResolvedValue("tx_hash_init_flexible"),
  isLoading: false,
})

export const useRegisterPool = vi.fn().mockReturnValue({
  register: vi.fn().mockResolvedValue("tx_hash_register"),
  isLoading: false,
})

export const useSetReputationTracker = vi.fn().mockReturnValue({
  setTracker: vi.fn().mockResolvedValue("tx_hash_set_tracker"),
  isLoading: false,
})

export const useRotationalDeposit = vi.fn().mockReturnValue({
  deposit: vi.fn().mockResolvedValue("tx_hash_rotational_deposit"),
  isLoading: false,
})

export const useTriggerPayout = vi.fn().mockReturnValue({
  trigger: vi.fn().mockResolvedValue("tx_hash_trigger_payout"),
  isLoading: false,
})

export const useTargetContribute = vi.fn().mockReturnValue({
  contribute: vi.fn().mockResolvedValue("tx_hash_target_contribute"),
  isLoading: false,
})

export const useTargetWithdraw = vi.fn().mockReturnValue({
  withdraw: vi.fn().mockResolvedValue("tx_hash_target_withdraw"),
  isLoading: false,
})

export const useTargetRefund = vi.fn().mockReturnValue({
  refund: vi.fn().mockResolvedValue("tx_hash_target_refund"),
  isLoading: false,
})

export const useFlexibleDeposit = vi.fn().mockReturnValue({
  deposit: vi.fn().mockResolvedValue("tx_hash_flexible_deposit"),
  isLoading: false,
})

export const useFlexibleWithdraw = vi.fn().mockReturnValue({
  withdraw: vi.fn().mockResolvedValue("tx_hash_flexible_withdraw"),
  isLoading: false,
})

export const useAddPoolMember = vi.fn().mockReturnValue({
  addMember: vi.fn().mockResolvedValue("tx_hash_add_member"),
  isLoading: false,
})

export const useRemovePoolMember = vi.fn().mockReturnValue({
  removeMember: vi.fn().mockResolvedValue("tx_hash_remove_member"),
  isLoading: false,
})

export const useLeavePool = vi.fn().mockReturnValue({
  leavePool: vi.fn().mockResolvedValue("tx_hash_leave_pool"),
  isLoading: false,
})

export const usePausePool = vi.fn().mockReturnValue({
  pause: vi.fn().mockResolvedValue("tx_hash_pause"),
  isLoading: false,
})

export const useUnpausePool = vi.fn().mockReturnValue({
  unpause: vi.fn().mockResolvedValue("tx_hash_unpause"),
  isLoading: false,
})

export const useBumpPoolState = vi.fn().mockReturnValue({
  bumpPoolState: vi.fn().mockResolvedValue("tx_hash_bump"),
  isLoading: false,
})
