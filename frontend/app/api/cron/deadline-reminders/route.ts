import { getAdminClient } from "@/lib/supabase-admin"
import { NextRequest, NextResponse } from "next/server"

const CRON_SECRET = process.env.CRON_SECRET ?? ""

export async function POST(req: NextRequest) {
  try {
    // Validate Vercel Cron / manual auth header
    const authHeader = req.headers.get("authorization")
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = getAdminClient()

    // Query active rotational pools
    const { data: pools, error: poolsError } = await supabase
      .from("pools")
      .select("id, name, contract_address, pool_type, next_payout_time, deadline, is_active")
      .or("pool_type.eq.rotational,pool_type.eq.Rotational")

    if (poolsError) {
      return NextResponse.json({ error: poolsError.message }, { status: 500 })
    }

    const now = Date.now()
    let notificationsSent = 0
    const results = []

    for (const pool of pools || []) {
      // Determine deadline timestamp
      const deadlineVal = pool.next_payout_time || pool.deadline
      if (!deadlineVal) continue

      const deadlineMs =
        typeof deadlineVal === "number"
          ? deadlineVal > 1e11
            ? deadlineVal
            : deadlineVal * 1000
          : new Date(deadlineVal).getTime()

      const timeDiff = deadlineMs - now
      const hoursRemaining = timeDiff / (1000 * 60 * 60)

      if (hoursRemaining <= 0 || hoursRemaining > 48) {
        continue
      }

      let priority: "normal" | "high" | "urgent" = "normal"
      let urgencyText = "within 48 hours"

      if (hoursRemaining <= 6) {
        priority = "urgent"
        urgencyText = "within 6 hours"
      } else if (hoursRemaining <= 24) {
        priority = "high"
        urgencyText = "within 24 hours"
      }

      // Query members who haven't deposited for current round
      const { data: members, error: membersError } = await supabase
        .from("pool_members")
        .select("member_address, status, has_deposited")
        .eq("pool_id", pool.id)

      if (membersError) continue

      const pendingMembers = (members || []).filter(
        (m) => m.has_deposited === false || m.status !== "deposited"
      )

      const notificationsToInsert: {
        wallet_address: string
        pool_id: string
        activity_type: string
        message: string
        priority: "normal" | "high" | "urgent"
        read: boolean
      }[] = []

      for (const member of pendingMembers) {
        const message = `Reminder: Contribution deadline for pool "${pool.name}" is ${urgencyText}.`

        // Check if recent notification already sent for this pool/member/priority in last 6 hours
        const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000).toISOString()
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("wallet_address", member.member_address.toLowerCase())
          .eq("pool_id", pool.id)
          .eq("priority", priority)
          .gte("created_at", sixHoursAgo)
          .limit(1)

        if (existing && existing.length > 0) continue

        notificationsToInsert.push({
          wallet_address: member.member_address.toLowerCase(),
          pool_id: pool.id,
          activity_type: "deadline_reminder",
          message,
          priority,
          read: false,
        })
      }

      // Bulk insert all eligible notifications in a single batch
      if (notificationsToInsert.length > 0) {
        const { error: notifError } = await supabase
          .from("notifications")
          .insert(notificationsToInsert)

        if (!notifError) {
          notificationsSent += notificationsToInsert.length
        }
      }

      results.push({
        poolId: pool.id,
        poolName: pool.name,
        hoursRemaining: Math.round(hoursRemaining * 10) / 10,
        priority,
        notifiedCount: notificationsToInsert.length,
      })
    }

    return NextResponse.json({
      success: true,
      poolsProcessed: pools?.length || 0,
      notificationsSent,
      details: results,
    })
  } catch (err) {
    console.error("Deadline reminder cron error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
