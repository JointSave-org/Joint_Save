import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"
import { jsonPrivate } from "@/lib/cache-headers"
import {
  runSecurityRules,
  type RuleContext,
  type ActivityRecord,
  type PoolRecord,
  type MemberRecord,
  type AdminActionRecord,
} from "@/lib/security-rules"

/**
 * POST /api/admin/security/scan
 *
 * Runs all monitoring rules against recent activity (last 24 hours).
 * Returns array of triggered alerts.
 * Rate limited: max 1 scan per 5 minutes (uses writeLimiter).
 */
export async function POST(req: NextRequest) {
  try {
    const limited = writeLimiter(req)
    if (limited) return limited

    const admin = getAdminClient()

    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // Fetch all pools
    const { data: pools, error: poolsError } = await admin
      .from("pools")
      .select("id, name, status, creator_address, created_at, updated_at, members_count")

    if (poolsError) throw poolsError

    const poolRecords: PoolRecord[] = (pools ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status as "active" | "completed" | "paused",
      creator_address: p.creator_address,
      created_at: p.created_at,
      updated_at: p.updated_at,
      members_count: p.members_count,
    }))

    // Fetch recent activities (last 24 hours)
    const { data: activities, error: activitiesError } = await admin
      .from("pool_activity")
      .select("id, pool_id, activity_type, user_address, amount, description, created_at")
      .gte("created_at", twentyFourHoursAgo.toISOString())
      .order("created_at", { ascending: false })

    if (activitiesError) throw activitiesError

    const activityRecords: ActivityRecord[] = (activities ?? []).map((a) => ({
      id: a.id,
      pool_id: a.pool_id,
      activity_type: a.activity_type,
      user_address: a.user_address,
      amount: a.amount,
      description: a.description,
      created_at: a.created_at,
    }))

    // Fetch all members
    const { data: members, error: membersError } = await admin
      .from("pool_members")
      .select("id, pool_id, member_address, status")

    if (membersError) throw membersError

    const memberRecords: MemberRecord[] = (members ?? []).map((m) => ({
      id: m.id,
      pool_id: m.pool_id,
      member_address: m.member_address,
      status: m.status,
    }))

    // Fetch recent admin actions (last 24 hours)
    const { data: adminActions, error: adminActionsError } = await admin
      .from("admin_actions")
      .select("id, pool_id, admin_address, action_type, target_address, created_at")
      .gte("created_at", twentyFourHoursAgo.toISOString())

    if (adminActionsError) throw adminActionsError

    const adminActionRecords: AdminActionRecord[] = (adminActions ?? []).map((a) => ({
      id: a.id,
      pool_id: a.pool_id,
      admin_address: a.admin_address,
      action_type: a.action_type,
      target_address: a.target_address,
      created_at: a.created_at,
    }))

    // Build context and run rules
    const ctx: RuleContext = {
      activities: activityRecords,
      pools: poolRecords,
      members: memberRecords,
      adminActions: adminActionRecords,
      now,
    }

    const alerts = runSecurityRules(ctx)

    // Persist CRITICAL alerts immediately
    const criticalAlerts = alerts.filter((a) => a.severity === "critical")
    if (criticalAlerts.length > 0) {
      const { error: insertError } = await admin.from("security_alerts").insert(
        criticalAlerts.map((a) => ({
          rule_id: a.rule_id,
          severity: a.severity,
          description: a.description,
          affected_pools: a.affected_pools,
          affected_wallets: a.affected_wallets,
          status: a.status,
        }))
      )

      if (insertError) {
        console.error("Failed to persist critical security alerts:", insertError)
      }
    }

    return jsonPrivate({
      scanTime: now.toISOString(),
      alerts,
      summary: {
        total: alerts.length,
        critical: alerts.filter((a) => a.severity === "critical").length,
        warning: alerts.filter((a) => a.severity === "warning").length,
        info: alerts.filter((a) => a.severity === "info").length,
      },
    })
  } catch (error) {
    console.error("Security scan error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Security scan failed" },
      { status: 500 }
    )
  }
}
