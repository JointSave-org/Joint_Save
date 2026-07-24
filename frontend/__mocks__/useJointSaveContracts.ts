import { vi } from "vitest"

export const NATIVE_SAC_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
export const NATIVE_TOKEN_METADATA = {
  symbol: "XLM",
  name: "Stellar Lumens",
  decimals: 7,
}

export const resolveTokenAddress = (tokenId: string) => tokenId || NATIVE_SAC_ID
export const getRpc = vi.fn().mockReturnValue({
  getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
  getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
})

export const formatTokenAmount = (amount: bigint, decimals = 7): number =>
  Number(amount) / Math.pow(10, decimals)
export const stroopsToXlm = (stroops: bigint): number => Number(stroops) / 10_000_000
export const ledgerToEstimatedDate = (_ledger: number) => new Date()

export const fetchTokenMetadata = vi.fn().mockResolvedValue(NATIVE_TOKEN_METADATA)

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

export const fetchContractEvents = vi.fn().mockResolvedValue([])
export const fetchPoolMembers = vi.fn().mockResolvedValue(["GBX1234567890TESTADDRESS"])
export const fetchIsPaused = vi.fn().mockResolvedValue(false)
export const fetchFactoryPools = vi
  .fn()
  .mockResolvedValue({ rotational: [], target: [], flexible: [] })
export const fetchPoolAdmin = vi.fn().mockResolvedValue("GBX1234567890TESTADDRESS")
export const fetchReputation = vi.fn().mockResolvedValue({ score: 100, label: "Trusted" })
export const fetchPoolTtl = vi.fn().mockResolvedValue(30)

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

export const useSetReputationTracker = vi.fn().mockReturnValue({
  setTracker: vi.fn().mockResolvedValue("tx_hash_set_tracker"),
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

export const useAddPoolMember = vi.fn().mockReturnValue({
  addMember: vi.fn().mockResolvedValue("tx_hash_add_member"),
  isLoading: false,
  error: null,
})

export const useRemovePoolMember = vi.fn().mockReturnValue({
  removeMember: vi.fn().mockResolvedValue("tx_hash_remove_member"),
  isLoading: false,
  error: null,
})

export const useLeavePool = vi.fn().mockReturnValue({
  leave: vi.fn().mockResolvedValue("tx_hash_leave_pool"),
  isLoading: false,
  error: null,
})

export const usePausePool = vi.fn().mockReturnValue({
  pause: vi.fn().mockResolvedValue("tx_hash_pause"),
  isLoading: false,
  error: null,
})

export const useUnpausePool = vi.fn().mockReturnValue({
  unpause: vi.fn().mockResolvedValue("tx_hash_unpause"),
  isLoading: false,
  error: null,
})

export const useBumpPoolState = vi.fn().mockReturnValue({
  bumpPoolState: vi.fn().mockResolvedValue("tx_hash_bump"),
  isLoading: false,
  error: null,
})
