// Pure notification-planning logic for notify-pool-event.
//
// Kept side-effect free so the recipient/email decision tree can be unit
// tested without a live Supabase project, Resend key, or webhook payload.
// index.ts wires these helpers into the Deno HTTP handler.

export interface NotificationPreferences {
  email_on_payout: boolean;
  email_on_deposit: boolean;
  email_on_round: boolean;
  email_on_target: boolean;
}

export interface UserProfile {
  wallet_address: string;
  email: string | null;
  notification_preferences: NotificationPreferences;
  muted_pools: string[] | null;
}

export interface NotificationPlan {
  recipients: string[];
  prefKey: keyof NotificationPreferences;
  subject: string;
  inAppMsg: string;
  bodyHtml: string;
}

const HANDLED_ACTIVITIES = new Set([
  "payout",
  "deposit",
  "round_advance",
  "target_reached",
]);

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function xlmFromStroops(stroops: number | null): string {
  if (stroops == null) return "?";
  return (stroops / 10_000_000).toFixed(2);
}

export function emailHtml(bodyContent: string): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#6d28d9;margin-bottom:8px">JointSave</h2>
      ${bodyContent}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="font-size:12px;color:#9ca3af">
        You're receiving this because you're a member of a JointSave pool.
        Manage preferences in your profile settings.
      </p>
    </div>`;
}

export function isHandledActivity(activityType: string): boolean {
  return HANDLED_ACTIVITIES.has(activityType);
}

export interface PlanInput {
  activity_type: string;
  poolName: string;
  amount: number | null;
  user_address: string | null;
  allMembers: string[];
  description: string | null;
}

/** Decide who gets notified and with what content. Null = unhandled activity. */
export function buildPlan(input: PlanInput): NotificationPlan | null {
  const { activity_type, poolName, amount, user_address, allMembers } = input;
  const xlm = xlmFromStroops(amount);
  const senderShort = user_address ? shortAddress(user_address) : "A member";

  if (activity_type === "payout") {
    return {
      recipients: user_address ? [user_address] : [],
      prefKey: "email_on_payout",
      subject: `You received ${xlm} XLM from ${poolName}`,
      inAppMsg: `You received ${xlm} XLM from ${poolName}`,
      bodyHtml: emailHtml(
        `<p>Great news! You received <strong>${xlm} XLM</strong> from your savings pool <strong>${poolName}</strong>.</p>
         <p>Log in to view your updated balance.</p>`,
      ),
    };
  }

  if (activity_type === "deposit") {
    return {
      recipients: allMembers.filter((a) => a !== user_address),
      prefKey: "email_on_deposit",
      subject: `${senderShort} deposited to ${poolName}`,
      inAppMsg: `${senderShort} deposited to ${poolName}`,
      bodyHtml: emailHtml(
        `<p><strong>${senderShort}</strong> made a deposit of <strong>${xlm} XLM</strong> to <strong>${poolName}</strong>.</p>`,
      ),
    };
  }

  if (activity_type === "round_advance") {
    const nextMember = input.description ?? "the next member";
    return {
      recipients: allMembers,
      prefKey: "email_on_round",
      subject: `Round complete in ${poolName} — ${nextMember} is next`,
      inAppMsg: `Round complete in ${poolName} — ${nextMember} is next`,
      bodyHtml: emailHtml(
        `<p>A round is complete in <strong>${poolName}</strong>.</p>
         <p>The next beneficiary is <strong>${nextMember}</strong>.</p>`,
      ),
    };
  }

  if (activity_type === "target_reached") {
    return {
      recipients: allMembers,
      prefKey: "email_on_target",
      subject: `${poolName} reached its target! You can now withdraw.`,
      inAppMsg: `${poolName} reached its target! You can now withdraw.`,
      bodyHtml: emailHtml(
        `<p>Your savings pool <strong>${poolName}</strong> has reached its savings target!</p>
         <p>You are now eligible to withdraw your funds. Log in to proceed.</p>`,
      ),
    };
  }

  return null;
}

const DEFAULT_PREFS: NotificationPreferences = {
  email_on_payout: true,
  email_on_deposit: true,
  email_on_round: true,
  email_on_target: true,
};

/** True only if this recipient opted in to this event type and did NOT mute the pool. */
export function shouldSendEmail(
  profile: UserProfile | undefined,
  prefKey: keyof NotificationPreferences,
  poolId: string,
): boolean {
  if (!profile?.email) return false;

  const isMutedForThisPool = (profile.muted_pools ?? []).includes(poolId);
  if (isMutedForThisPool) return false;

  const prefs: NotificationPreferences = {
    ...DEFAULT_PREFS,
    ...(profile.notification_preferences ?? {}),
  };
  return prefs[prefKey] === true;
}
