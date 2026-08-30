import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import {
  runSecurityRules,
  type RuleContext,
  type ActivityRecord,
  type PoolRecord,
  type MemberRecord,
  type AdminActionRecord,
} from "@/lib/security-rules"
import { runIncidentResponse } from "@/lib/server/incident-actions"

/**
 * POST /api/cron/security-scan
 *
 * Runs every 6 hours automatically via cron.
 * Stores all results in security_alerts table.
 * Sends immediate notifications to platform admins for CRITICAL alerts.
 * Runs the incident-response circuit breaker over the critical alerts, which
 * may auto-pause a pool (see lib/incident-response.ts). Dry-run by default.
 *
 * Protected by a shared secret in the x-cron-secret header.
 */
export async function POST(req: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = req.headers.get("x-cron-secret")
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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

    // Store all alerts in the database
    if (alerts.length > 0) {
      const { error: insertError } = await admin.from("security_alerts").insert(
        alerts.map((a) => ({
          rule_id: a.rule_id,
          severity: a.severity,
          description: a.description,
          affected_pools: a.affected_pools,
          affected_wallets: a.affected_wallets,
          status: a.status,
        }))
      )

      if (insertError) {
        console.error("Failed to store security alerts:", insertError)
        throw insertError
      }
    }

    // Send notifications for CRITICAL alerts
    const criticalAlerts = alerts.filter((a) => a.severity === "critical")
    if (criticalAlerts.length > 0) {
      // Fetch all platform admins (users with admin pools)
      const { data: adminAddresses } = await admin
        .from("pools")
        .select("creator_address")
        .distinct()

      if (adminAddresses) {
        const uniqueAdmins = [...new Set(adminAddresses.map((a) => a.creator_address))]

        for (const adminAddress of uniqueAdmins) {
          for (const alert of criticalAlerts) {
            await admin.from("notifications").insert({
              wallet_address: adminAddress,
              activity_type: "security_critical",
              message: `[SECURITY] ${alert.description}`,
              read: false,
            })
          }
        }
      }
    }

    // Escalate critical alerts into recovery actions. A failure here must not
    // lose the scan: the alerts are already persisted and are the more
    // important record.
    let incidentResponse = null
    try {
      incidentResponse = await runIncidentResponse(admin, alerts, "cron")
    } catch (incidentError) {
      console.error("Incident response failed:", incidentError)
    }

    // Log the cron job execution
    await admin.from("cron_job_logs").insert({
      job_name: "security-scan",
      status: alerts.some((a) => a.severity === "critical") ? "warning" : "success",
      error_message:
        criticalAlerts.length > 0 ? `${criticalAlerts.length} critical alert(s) triggered` : null,
    })

    return NextResponse.json({
      success: true,
      scanTime: now.toISOString(),
      alertsStored: alerts.length,
      criticalAlerts: criticalAlerts.length,
      incidentResponse,
    })
  } catch (error) {
    console.error("Cron security scan error:", error)

    // Log the failed cron job
    try {
      const admin = getAdminClient()
      await admin.from("cron_job_logs").insert({
        job_name: "security-scan",
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
      })
    } catch {
      // Swallow logging errors to avoid masking the original error
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron security scan failed" },
      { status: 500 }
    )
  }
}
