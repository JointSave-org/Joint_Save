import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

const isValid = (url: string) => {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export const supabase = isValid(supabaseUrl)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as unknown as ReturnType<typeof createClient>)

export type Database = {
  public: {
    Tables: {
      pools: {
        Row: {
          id: string
          name: string
          description: string | null
          type: "rotational" | "target" | "flexible"
          status: "active" | "completed" | "paused"
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
          pause_reason: string | null
          paused_at: string | null
          deadline: string | null
          minimum_deposit: number | null
          withdrawal_fee: number | null
          yield_enabled: boolean
        }
        Insert: {
          name: string
          description?: string | null
          type: "rotational" | "target" | "flexible"
          status?: "active" | "completed" | "paused"
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
          pause_reason?: string | null
          paused_at?: string | null
          deadline?: string | null
          minimum_deposit?: number | null
          withdrawal_fee?: number | null
          yield_enabled?: boolean
        }
        Update: {
          name?: string
          description?: string | null
          type?: "rotational" | "target" | "flexible"
          status?: "active" | "completed" | "paused"
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
          pause_reason?: string | null
          paused_at?: string | null
          deadline?: string | null
          minimum_deposit?: number | null
          withdrawal_fee?: number | null
          yield_enabled?: boolean
        }
        Relationships: []
      }
      pool_members: {
        Row: {
          id: string
          pool_id: string
          member_address: string
          contribution_amount: number
          status: "pending" | "paid" | "late"
          joined_at: string
        }
        Insert: {
          pool_id: string
          member_address: string
          contribution_amount?: number
          status?: "pending" | "paid" | "late"
        }
        Update: {
          pool_id?: string
          member_address?: string
          contribution_amount?: number
          status?: "pending" | "paid" | "late"
        }
        Relationships: []
      }
      pool_activity: {
        Row: {
          id: string
          pool_id: string
          activity_type: string
          user_address: string | null
          amount: number | null
          token_amount: number | null
          description: string | null
          tx_hash: string | null
          on_chain_timestamp: string | null
          block_number: number | null
          fee_charged: number | null
          created_at: string
        }
        Insert: {
          pool_id: string
          activity_type: string
          user_address?: string | null
          amount?: number | null
          token_amount?: number | null
          description?: string | null
          tx_hash?: string | null
          on_chain_timestamp?: string | null
          block_number?: number | null
          fee_charged?: number | null
        }
        Update: {
          pool_id?: string
          activity_type?: string
          user_address?: string | null
          amount?: number | null
          token_amount?: number | null
          description?: string | null
          tx_hash?: string | null
          on_chain_timestamp?: string | null
          block_number?: number | null
          fee_charged?: number | null
        }
        Relationships: []
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
        Relationships: []
      }
      join_requests: {
        Row: {
          id: string
          pool_id: string
          requester_address: string
          status: "pending" | "accepted" | "declined"
          created_at: string
          responded_at: string | null
          responder_id: string | null
        }
        Insert: {
          pool_id: string
          requester_address: string
          status?: "pending" | "accepted" | "declined"
        }
        Update: {
          status?: "pending" | "accepted" | "declined"
          responded_at?: string | null
          responder_id?: string | null
        }
        Relationships: []
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
        Relationships: []
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
            email_on_deposit_reminder: boolean
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
            email_on_deposit_reminder?: boolean
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
            email_on_deposit_reminder?: boolean
          }
          updated_at?: string
        }
        Relationships: []
      }
      deposit_reminders: {
        Row: {
          id: string
          pool_id: string
          wallet_address: string
          round_deadline: string
          created_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          wallet_address: string
          round_deadline: string
          created_at?: string
        }
        Update: {
          pool_id?: string
          wallet_address?: string
          round_deadline?: string
          created_at?: string
        }
        Relationships: []
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
        Relationships: []
      }
      admin_actions: {
        Row: {
          id: string
          pool_id: string
          admin_address: string
          action_type: string
          target_address: string | null
          metadata: Record<string, unknown>
          tx_hash: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          admin_address: string
          action_type: string
          target_address?: string | null
          metadata?: Record<string, unknown>
          tx_hash?: string | null
          created_at?: string
        }
        Update: {
          pool_id?: string
          admin_address?: string
          action_type?: string
          target_address?: string | null
          metadata?: Record<string, unknown>
          tx_hash?: string | null
          created_at?: string
        }
        Relationships: []
      }
      cron_job_logs: {
        Row: {
          id: string
          job_name: string
          pool_id: string | null
          status: "success" | "failed" | "retry" | "warning"
          error_message: string | null
          tx_hash: string | null
          retry_count: number
          next_retry_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          job_name: string
          pool_id?: string | null
          status: "success" | "failed" | "retry" | "warning"
          error_message?: string | null
          tx_hash?: string | null
          retry_count?: number
          next_retry_at?: string | null
          created_at?: string
        }
        Update: {
          job_name?: string
          pool_id?: string | null
          status?: "success" | "failed" | "retry" | "warning"
          error_message?: string | null
          tx_hash?: string | null
          retry_count?: number
          next_retry_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      event_index_log: {
        Row: {
          id: number
          pool_id: string
          last_indexed_ledger: number
          indexed_at: string
        }
        Insert: {
          pool_id: string
          last_indexed_ledger: number
          indexed_at?: string
        }
        Update: {
          pool_id?: string
          last_indexed_ledger?: number
          indexed_at?: string
        }
        Relationships: []
      }
      pool_messages: {
        Row: {
          id: string
          pool_id: string
          sender_address: string
          message: string
          created_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          sender_address: string
          message: string
          created_at?: string
        }
        Update: {
          message?: string
        }
        Relationships: []
      }
      disputes: {
        Row: {
          id: string
          pool_id: string
          filer_address: string
          target_address: string | null
          dispute_type:
            "missed_deposit" | "unfair_penalty" | "admin_abuse" | "member_misconduct" | "other"
          description: string
          evidence_urls: string[]
          status: "open" | "voting" | "resolved_upheld" | "resolved_dismissed" | "expired"
          resolution: string | null
          votes_for: number
          votes_against: number
          resolved_by: string | null
          resolved_at: string | null
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          filer_address: string
          target_address?: string | null
          dispute_type:
            "missed_deposit" | "unfair_penalty" | "admin_abuse" | "member_misconduct" | "other"
          description: string
          evidence_urls?: string[]
          status?: "open" | "voting" | "resolved_upheld" | "resolved_dismissed" | "expired"
          resolution?: string | null
          votes_for?: number
          votes_against?: number
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
          expires_at: string
        }
        Update: {
          pool_id?: string
          filer_address?: string
          target_address?: string | null
          dispute_type?:
            "missed_deposit" | "unfair_penalty" | "admin_abuse" | "member_misconduct" | "other"
          description?: string
          evidence_urls?: string[]
          status?: "open" | "voting" | "resolved_upheld" | "resolved_dismissed" | "expired"
          resolution?: string | null
          votes_for?: number
          votes_against?: number
          resolved_by?: string | null
          resolved_at?: string | null
          expires_at?: string
        }
        Relationships: []
      }
      dispute_votes: {
        Row: {
          dispute_id: string
          voter_address: string
          vote: boolean
          created_at: string
        }
        Insert: {
          dispute_id: string
          voter_address: string
          vote: boolean
          created_at?: string
        }
        Update: {
          vote?: boolean
        }
        Relationships: []
      }
      pool_templates: {
        Row: {
          id: string
          creator_address: string
          name: string
          description: string | null
          pool_type: "rotational" | "target" | "flexible"
          config: Record<string, unknown>
          is_public: boolean
          use_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          creator_address: string
          name: string
          description?: string | null
          pool_type: "rotational" | "target" | "flexible"
          config: Record<string, unknown>
          is_public?: boolean
          use_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          pool_type?: "rotational" | "target" | "flexible"
          config?: Record<string, unknown>
          is_public?: boolean
          use_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          wallet_address: string
          pool_id: string | null
          event_deposit: boolean
          event_payout: boolean
          event_member_joined: boolean
          event_member_left: boolean
          event_deadline_warning: boolean
          event_paused: boolean
          push_enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          wallet_address: string
          pool_id?: string | null
          event_deposit?: boolean
          event_payout?: boolean
          event_member_joined?: boolean
          event_member_left?: boolean
          event_deadline_warning?: boolean
          event_paused?: boolean
          push_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          event_deposit?: boolean
          event_payout?: boolean
          event_member_joined?: boolean
          event_member_left?: boolean
          event_deadline_warning?: boolean
          event_paused?: boolean
          push_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          wallet_address: string
          endpoint: string
          p256dh: string
          auth: string
          created_at: string
        }
        Insert: {
          id?: string
          wallet_address: string
          endpoint: string
          p256dh: string
          auth: string
          created_at?: string
        }
        Update: {
          wallet_address?: string
          endpoint?: string
          p256dh?: string
          auth?: string
        }
        Relationships: []
      }
      security_alerts: {
        Row: {
          id: string
          rule_id: string
          severity: "info" | "warning" | "critical"
          description: string
          affected_pools: string[]
          affected_wallets: string[]
          status: "new" | "investigating" | "resolved" | "false_positive"
          resolved_by: string | null
          resolution_notes: string | null
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          rule_id: string
          severity: "info" | "warning" | "critical"
          description: string
          affected_pools?: string[]
          affected_wallets?: string[]
          status?: "new" | "investigating" | "resolved" | "false_positive"
          resolved_by?: string | null
          resolution_notes?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Update: {
          rule_id?: string
          severity?: "info" | "warning" | "critical"
          description?: string
          affected_pools?: string[]
          affected_wallets?: string[]
          status?: "new" | "investigating" | "resolved" | "false_positive"
          resolved_by?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      pause_authorizations: {
        Row: {
          id: string
          pool_id: string
          contract_address: string
          admin_address: string
          entry_xdr: string
          expiration_ledger: number
          used_at: string | null
          used_by_incident: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          contract_address: string
          admin_address: string
          entry_xdr: string
          expiration_ledger: number
          used_at?: string | null
          used_by_incident?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          used_at?: string | null
          used_by_incident?: string | null
          revoked_at?: string | null
        }
        Relationships: []
      }
      incidents: {
        Row: {
          id: string
          pool_id: string
          trigger_rule_ids: string[]
          severity: "info" | "warning" | "critical"
          alert_count: number
          reason: string
          created_by_scan: boolean
          scan_source: "cron" | "admin" | "manual"
          action: "pause" | "none"
          executed: boolean
          dry_run: boolean
          skip_reason:
            | "below_threshold"
            | "already_paused"
            | "pool_not_active"
            | "cooldown"
            | "unknown_pool"
            | null
          platform_paused: boolean
          onchain_status: "not_required" | "pending" | "confirmed" | "failed"
          onchain_tx_hash: string | null
          status: "open" | "resolved"
          resolved_by: string | null
          resolution_notes: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          pool_id: string
          trigger_rule_ids?: string[]
          severity?: "info" | "warning" | "critical"
          alert_count?: number
          reason: string
          created_by_scan?: boolean
          scan_source?: "cron" | "admin" | "manual"
          action?: "pause" | "none"
          executed?: boolean
          dry_run?: boolean
          skip_reason?:
            | "below_threshold"
            | "already_paused"
            | "pool_not_active"
            | "cooldown"
            | "unknown_pool"
            | null
          platform_paused?: boolean
          onchain_status?: "not_required" | "pending" | "confirmed" | "failed"
          onchain_tx_hash?: string | null
          status?: "open" | "resolved"
          resolved_by?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          executed?: boolean
          platform_paused?: boolean
          onchain_status?: "not_required" | "pending" | "confirmed" | "failed"
          onchain_tx_hash?: string | null
          status?: "open" | "resolved"
          resolved_by?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    // supabase-js v2 requires these keys on the schema type; without them the
    // client can't match GenericSchema and every table degrades to `never`.
    Views: Record<string, never>
    Functions: Record<string, never>
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
  poolType: "rotational" | "target" | "flexible"
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
      .from("pools")
      .insert([
        {
          name,
          description,
          type: poolType,
          status: "active",
          creator_address: creatorAddress.toLowerCase(),
          contract_address: contractAddress,
          token_address: tokenAddress,
          token_symbol: tokenSymbol || "XLM",
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
    if (!pool || pool.length === 0) throw new Error("Failed to create pool")

    const poolId = pool[0].id

    // Insert members
    if (members.length > 0) {
      const memberData = members.map((address) => ({
        pool_id: poolId,
        member_address: address.toLowerCase(),
        contribution_amount: contributionAmount ? parseFloat(contributionAmount) : 0,
        status: "pending" as const,
      }))

      const { error: membersError } = await supabase.from("pool_members").insert(memberData)

      if (membersError) throw membersError
    }

    // Log activity
    await supabase.from("pool_activity").insert([
      {
        pool_id: poolId,
        activity_type: "pool_created",
        user_address: creatorAddress.toLowerCase(),
        description: `${poolType} pool created`,
      },
    ])

    return { success: true, poolId, pool: pool[0] }
  } catch (error) {
    console.error("Failed to save pool:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
