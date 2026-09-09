// Supabase Edge Function: notify-pool-event
//
// Triggered by a Supabase database webhook on pool_activity INSERT.
// Reads event type, fetches affected members, checks notification preferences,
// sends email via Resend, and writes in-app notification rows.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — auto-injected by Supabase
//   RESEND_API_KEY                            — set in Supabase dashboard > Edge Functions > Secrets
//   RESEND_FROM_EMAIL                         — e.g. "JointSave <noreply@jointsave.app>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  buildPlan,
  isHandledActivity,
  shouldSendEmail,
  type UserProfile,
} from "./_logic.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM =
  Deno.env.get("RESEND_FROM_EMAIL") ?? "JointSave <noreply@jointsave.app>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Types ────────────────────────────────────────────────────────────────────

interface ActivityRecord {
  id: string;
  pool_id: string;
  activity_type: string;
  user_address: string | null;
  amount: number | null;
  description: string | null;
  created_at: string;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: ActivityRecord;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!RESEND_API_KEY || !to) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) {
    console.error("Resend error:", await res.text());
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    if (payload.type !== "INSERT") return new Response("ok", { status: 200 });

    const act = payload.record;
    const { activity_type, pool_id, user_address, amount } = act;

    if (!isHandledActivity(activity_type)) {
      return new Response("ok", { status: 200 });
    }

    // Fetch pool info
    const { data: pool } = await sb
      .from("pools")
      .select("id, name")
      .eq("id", pool_id)
      .single();
    if (!pool) return new Response("pool not found", { status: 200 });

    // Fetch all pool members
    const { data: members } = await sb
      .from("pool_members")
      .select("member_address")
      .eq("pool_id", pool_id);
    const allMembers: string[] = (members ?? []).map(
      (m: { member_address: string }) => m.member_address,
    );

    // Fetch user profiles for email + preferences lookup
    const { data: profiles } = await sb
      .from("user_profiles")
      .select("wallet_address, email, notification_preferences, muted_pools")
      .in("wallet_address", allMembers);
    const profileMap = new Map<string, UserProfile>(
      (profiles ?? []).map((p: UserProfile) => [p.wallet_address, p]),
    );

    const plan = buildPlan({
      activity_type,
      poolName: pool.name,
      amount,
      user_address,
      allMembers,
      description: act.description,
    });
    if (!plan) return new Response("ok", { status: 200 });

    // Write in-app notifications for all recipients
    if (plan.recipients.length > 0) {
      await sb.from("notifications").insert(
        plan.recipients.map((addr) => ({
          wallet_address: addr,
          pool_id,
          activity_type,
          message: plan.inAppMsg,
        })),
      );
    }

    // Send emails, respecting global preferences AND per-pool mute.
    await Promise.all(
      plan.recipients.map(async (addr) => {
        const profile = profileMap.get(addr);
        if (!shouldSendEmail(profile, plan.prefKey, pool_id)) return;
        if (!profile?.email) return;

        await sendEmail(profile.email, plan.subject, plan.bodyHtml);
      }),
    );

    return new Response(
      JSON.stringify({ ok: true, notified: plan.recipients.length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("notify-pool-event error:", err);
    return new Response("internal error", { status: 500 });
  }
});