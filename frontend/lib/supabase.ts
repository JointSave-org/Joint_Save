import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const isValid = (url: string) => { try { new URL(url); return true } catch { return false } }

export const supabase = isValid(supabaseUrl)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null as any

export type Database = {
  public: {
    Tables: {
      pools: {
        Row: {
          id: string
          name: string
          description: string | null
          type: 'rotational' | 'target' | 'flexible'
          status: 'active' | 'completed' | 'paused'
          creator_address: string
          contract_address: string
          token_address: string
          token_symbol: string
          token_decimals: number
          total_saved: number
          target_amount: number | null
          progress: number
          members_count: number
          next_payout: string | null
          next_recipient: string | null
          created_at: string
          updated_at: string
          contribution_amount: number | null
          round_duration: number | null
          frequency: string | null
          deadline: string | null
          minimum_deposit: number | null
          withdrawal_fee: number | null
          yield_enabled: boolean
        }
        Insert: {
          name: string
          description?: string | null
          type: 'rotational' | 'target' | 'flexible'
          status?: 'active' | 'completed' | 'paused'
          creator_address: string
          contract_address: string
          token_address: string
          token_symbol?: string
          token_decimals?: number
          total_saved?: number
          target_amount?: number | null
          progress?: number
          members_count?: number
          next_payout?: string | null
          next_recipient?: string | null
          contribution_amount?: number | null
          round_duration?: number | null
          frequency?: string | null
          deadline?: string | null
          minimum_deposit?: number | null
          withdrawal_fee?: number | null
          yield_enabled?: boolean
        }
        Update: {
          name?: string
          description?: string | null
          type?: 'rotational' | 'target' | 'flexible'
          status?: 'active' | 'completed' | 'paused'
          creator_address?: string
          contract_address?: string
          token_address?: string
          token_symbol?: string
          token_decimals?: number
          total_saved?: number
          target_amount?: number | null
          progress?: number
          members_count?: number
          next_payout?: string | null
          next_recipient?: string | null
          contribution_amount?: number | null
          round_duration?: number | null
          frequency?: string | null
          deadline?: string | null
          minimum_deposit?: number | null
          withdrawal_fee?: number | null
          yield_enabled?: boolean
        }
      }
      pool_members: {
        Row: {
          id: string
          pool_id: string
          member_address: string
          contribution_amount: number
          status: 'pending' | 'paid' | 'late'
          joined_at: string
        }
        Insert: {
          pool_id: string
          member_address: string
          contribution_amount?: number
          status?: 'pending' | 'paid' | 'late'
        }
        Update: {
          pool_id?: string
          member_address?: string
          contribution_amount?: number
          status?: 'pending' | 'paid' | 'late'
        }
      }
      pool_activity: {
        Row: {
          id: string
          pool_id: string
          activity_type: string
          user_address: string | null
          amount: number | null
          description: string | null
          tx_hash: string | null
          created_at: string
        }
        Insert: {
          pool_id: string
          activity_type: string
          user_address?: string | null
          amount?: number | null
          description?: string | null
          tx_hash?: string | null
        }
        Update: {
          pool_id?: string
          activity_type?: string
          user_address?: string | null
          amount?: number | null
          description?: string | null
          tx_hash?: string | null
        }
      }
      pool_daily_metrics: {
        Row: {
          id: string
          pool_id: string
          date: string
          total_balance: number
          total_deposits: number
          total_withdrawals: number
          active_members_count: number
          created_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          date?: string
          total_balance?: number
          total_deposits?: number
          total_withdrawals?: number
          active_members_count?: number
          created_at?: string
        }
        Update: {
          id?: string
          pool_id?: string
          date?: string
          total_balance?: number
          total_deposits?: number
          total_withdrawals?: number
          active_members_count?: number
          created_at?: string
        }
      }
      pool_health_scores: {
        Row: {
          id: string
          pool_id: string
          health_score: number
          participation_rate: number
          risk_indicator: string
          last_calculated_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          health_score?: number
          participation_rate?: number
          risk_indicator?: string
          last_calculated_at?: string
        }
        Update: {
          id?: string
          pool_id?: string
          health_score?: number
          participation_rate?: number
          risk_indicator?: string
          last_calculated_at?: string
        }
      }
      user_profiles: {
        Row: {
          wallet_address: string
          email: string | null
          notification_preferences: {
            email_on_payout: boolean
            email_on_deposit: boolean
            email_on_round: boolean
            email_on_target: boolean
            email_on_reminder: boolean
          }
          created_at: string
          updated_at: string
        }
        Insert: {
          wallet_address: string
          email?: string | null
          notification_preferences?: {
            email_on_payout?: boolean
            email_on_deposit?: boolean
            email_on_round?: boolean
            email_on_target?: boolean
            email_on_reminder?: boolean
          }
          created_at?: string
          updated_at?: string
        }
        Update: {
          email?: string | null
          notification_preferences?: {
            email_on_payout?: boolean
            email_on_deposit?: boolean
            email_on_round?: boolean
            email_on_target?: boolean
            email_on_reminder?: boolean
          }
          updated_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          wallet_address: string
          pool_id: string | null
          activity_type: string
          message: string
          read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          wallet_address: string
          pool_id?: string | null
          activity_type: string
          message: string
          read?: boolean
          created_at?: string
        }
        Update: {
          read?: boolean
        }
      }
    }
  }
}

// Helper function to save pool to database
export async function savePoolToDatabase({
  name,
  description,
  poolType,
  creatorAddress,
  contractAddress,
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  members,
  contributionAmount,
  roundDuration,
  frequency,
  targetAmount,
  deadline,
  minimumDeposit,
  withdrawalFee,
  yieldEnabled,
}: {
  name: string
  description: string | null
  poolType: 'rotational' | 'target' | 'flexible'
  creatorAddress: string
  contractAddress: string
  tokenAddress: string
  tokenSymbol?: string
  tokenDecimals?: number
  members: string[]
  contributionAmount?: string
  roundDuration?: number
  frequency?: string
  targetAmount?: string
  deadline?: string
  minimumDeposit?: string
  withdrawalFee?: string
  yieldEnabled?: boolean
}) {
  try {
    // Insert pool
    const { data: pool, error: poolError } = await supabase
      .from('pools')
      .insert([
        {
          name,
          description,
          type: poolType,
          status: 'active',
          creator_address: creatorAddress.toLowerCase(),
          contract_address: contractAddress,
          token_address: tokenAddress,
          token_symbol: tokenSymbol || 'XLM',
          token_decimals: tokenDecimals ?? 7,
          members_count: members.length,
          contribution_amount: contributionAmount ? parseFloat(contributionAmount) : null,
          round_duration: roundDuration || null,
          frequency: frequency || null,
          target_amount: targetAmount ? parseFloat(targetAmount) : null,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          minimum_deposit: minimumDeposit ? parseFloat(minimumDeposit) : null,
          withdrawal_fee: withdrawalFee ? parseFloat(withdrawalFee) : null,
          yield_enabled: yieldEnabled || false,
        },
      ])
      .select()

    if (poolError) throw poolError
    if (!pool || pool.length === 0) throw new Error('Failed to create pool')

    const poolId = pool[0].id

    // Insert members
    if (members.length > 0) {
      const memberData = members.map((address) => ({
        pool_id: poolId,
        member_address: address.toLowerCase(),
        contribution_amount: contributionAmount ? parseFloat(contributionAmount) : 0,
        status: 'pending' as const,
      }))

      const { error: membersError } = await supabase
        .from('pool_members')
        .insert(memberData)

      if (membersError) throw membersError
    }

    // Log activity
    await supabase.from('pool_activity').insert([
      {
        pool_id: poolId,
        activity_type: 'pool_created',
        user_address: creatorAddress.toLowerCase(),
        description: `${poolType} pool created`,
      },
    ])

    return { success: true, poolId, pool: pool[0] }
  } catch (error) {
    console.error('Failed to save pool:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}