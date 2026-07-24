import { vi } from "vitest"

export const getRpc = vi.fn().mockReturnValue({})

export const stroopsToXlm = (stroops: bigint): number => Number(stroops) / 10_000_000

export const fetchRotationalState = vi.fn().mockResolvedValue({
  currentRound: 0,
  roundDuration: 86400,
  contributionAmount: 1000000000n,
  members: ["GBX...", "GAY..."],
  nextPayoutTime: 1700000000,
  isActive: true,
})

export const fetchTargetState = vi.fn().mockResolvedValue({
  targetAmount: 5000000000n,
  totalDeposited: 2500000000n,
  deadline: 1700000000,
  members: ["GBX...", "GAY..."],
  userContribution: 1000000000n,
  isTargetReached: false,
})

export const fetchFlexibleState = vi.fn().mockResolvedValue({
  totalBalance: 10000000000n,
  userBalance: 2000000000n,
  minimumDeposit: 100000000n,
  withdrawalFeeBps: 100,
  isActive: true,
})

export const useDeployPool = vi.fn().mockReturnValue({
  deploy: vi.fn().mockResolvedValue("C_MOCK_CONTRACT_ADDRESS"),
  isLoading: false,
  error: null,
})

export const useInitializePool = vi.fn().mockReturnValue({
  initRotational: vi.fn().mockResolvedValue("tx_hash_init_rotational"),
  initTarget: vi.fn().mockResolvedValue("tx_hash_init_target"),
  initFlexible: vi.fn().mockResolvedValue("tx_hash_init_flexible"),
  isLoading: false,
  error: null,
})

export const useRegisterPool = vi.fn().mockReturnValue({
  register: vi.fn().mockResolvedValue("tx_hash_register"),
  isLoading: false,
  error: null,
})

export const useRotationalDeposit = vi.fn().mockReturnValue({
  deposit: vi.fn().mockResolvedValue("tx_hash_rotational_deposit"),
  isLoading: false,
  error: null,
})

export const useTriggerPayout = vi.fn().mockReturnValue({
  trigger: vi.fn().mockResolvedValue("tx_hash_trigger_payout"),
  isLoading: false,
  error: null,
})

export const useTargetContribute = vi.fn().mockReturnValue({
  contribute: vi.fn().mockResolvedValue("tx_hash_target_contribute"),
  isLoading: false,
  error: null,
})

export const useTargetWithdraw = vi.fn().mockReturnValue({
  withdraw: vi.fn().mockResolvedValue("tx_hash_target_withdraw"),
  isLoading: false,
  error: null,
})

export const useTargetRefund = vi.fn().mockReturnValue({
  refund: vi.fn().mockResolvedValue("tx_hash_target_refund"),
  isLoading: false,
  error: null,
})

export const useFlexibleDeposit = vi.fn().mockReturnValue({
  deposit: vi.fn().mockResolvedValue("tx_hash_flexible_deposit"),
  isLoading: false,
  error: null,
})

export const useFlexibleWithdraw = vi.fn().mockReturnValue({
  withdraw: vi.fn().mockResolvedValue("tx_hash_flexible_withdraw"),
  isLoading: false,
  error: null,
})
