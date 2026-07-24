import { vi } from "vitest"

export const mockSupabaseData = [
  {
    id: "tx-1",
    activity_type: "deposit",
    user_address: "GBX1234567890",
    amount: 100,
    description: "Deposit to pool",
    created_at: "2026-07-24T10:00:00Z",
    pool_id: "pool-1",
  },
  {
    id: "tx-2",
    activity_type: "withdraw",
    user_address: "GBX1234567890",
    amount: 50,
    description: "Withdrawal from pool",
    created_at: "2026-07-24T10:05:00Z",
    pool_id: "pool-1",
  },
]

export const supabase = {
  from: vi.fn().mockImplementation((table: string) => ({
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: mockSupabaseData, error: null }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockResolvedValue({ data: null, error: null }),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockSupabaseData[0], error: null }),
  })),
}
