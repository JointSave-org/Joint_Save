// Pure reminder-selection and message-building logic for send-deposit-reminders.
//
// Kept side-effect free so membership/reminder filtering can be unit tested
// without a live Supabase project or Resend key. index.ts wires these helpers
// into the Deno HTTP handler.

export interface NotificationPreferences {
  email_on_payout?: boolean;
  email_on_deposit?: boolean;
  email_on_round?: boolean;
  email_on_target?: boolean;
  email_on_deposit_reminder?: boolean;
}

export interface UserProfile {
  wallet_address: string;
  email: string | null;
  notification_preferences: NotificationPreferences | null;
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function subtractSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() - seconds * 1000);
}

export function emailAllowed(profile: UserProfile | undefined): boolean {
  if (!profile?.email) return false;

  const prefs: NotificationPreferences = {
    email_on_deposit: true,
    email_on_deposit_reminder: true,
    ...(profile.notification_preferences ?? {}),
  };

  return (
    prefs.email_on_deposit !== false &&
    prefs.email_on_deposit_reminder !== false
  );
}

export function reminderMessage(poolName: string, deadline: Date): string {
  return `Deposit reminder: ${poolName} round deadline is ${deadline.toISOString()}`;
}

export function emailHtml(poolName: string, deadline: Date): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#6d28d9;margin-bottom:8px">JointSave</h2>
      <p>This is a reminder to make your deposit for <strong>${poolName}</strong>.</p>
      <p>The current rotational round deadline is <strong>${deadline.toISOString()}</strong>.</p>
      <p>Log in to JointSave to complete your deposit before the round closes.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="font-size:12px;color:#9ca3af">
        You're receiving this because you're a member of a JointSave rotational pool.
        Manage preferences in your profile settings.
      </p>
    </div>`;
}

/**
 * Members who have NOT deposited this round, normalized to lowercase, ordered
 * by input member order. `depositorAddresses` should already be normalized.
 */
export function nonDepositors(
  allMembers: string[],
  depositorAddresses: Set<string>,
): string[] {
  return allMembers.filter((member) => !depositorAddresses.has(member));
}

/**
 * Candidates after matching against user profiles: those who opted into
 * deposit reminders and have an email address. `profileMap` is keyed by
 * normalized wallet address; candidate addresses must be normalized too.
 */
export function eligibleReminderRecipients(
  candidates: string[],
  profileMap: Map<string, UserProfile>,
): string[] {
  return candidates.filter((addr) => emailAllowed(profileMap.get(addr)));
}
