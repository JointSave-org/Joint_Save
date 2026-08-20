import { Resend } from "resend"

const FROM = process.env.RESEND_FROM_EMAIL ?? "JointSave <noreply@jointsave.app>"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://jointsave.app"

export interface DigestNotification {
  pool_id: string | null
  activity_type: string
  message: string
  created_at: string
}

export interface Digest {
  frequency: "daily" | "weekly"
  notifications: DigestNotification[]
  unsubscribeToken: string
}

function activityLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function digestEmailHtml(digest: Digest): string {
  const period = digest.frequency === "daily" ? "the last 24 hours" : "the last 7 days"

  const items = digest.notifications.length
    ? digest.notifications
        .map(
          (n) => `
        <li style="margin-bottom:10px;list-style:none;">
          <span style="color:#6d28d9;font-weight:600;">${activityLabel(n.activity_type)}</span>
          <br/>
          <span style="color:#374151;">${n.message}</span>
        </li>`
        )
        .join("")
    : `<li style="color:#9ca3af;list-style:none;">No new activity in ${period}.</li>`

  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="color:#6d28d9;margin-bottom:4px">JointSave</h2>
      <p style="color:#6b7280;margin-top:0">
        Your ${digest.frequency} digest — summary of ${period}
      </p>
      <ul style="padding:0;margin:16px 0">${items}</ul>
      <a href="${APP_URL}/dashboard"
         style="display:inline-block;background:#6d28d9;color:#fff;padding:10px 20px;
                border-radius:8px;text-decoration:none;font-weight:600;">
        Open JointSave
      </a>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="font-size:12px;color:#9ca3af">
        You're receiving this because you subscribed to ${digest.frequency} email digests.
        <a href="${APP_URL}/api/notifications/digest/unsubscribe?token=${digest.unsubscribeToken}">
          Unsubscribe
        </a>
      </p>
    </div>`
}

// sendDigestEmail — formats and sends one digest email via Resend.
// Silently no-ops if RESEND_API_KEY isn't set (mirrors send-deposit-reminders'
// pattern of degrading gracefully in local/dev environments without secrets).
export async function sendDigestEmail(to: string, digest: Digest): Promise<void> {
  if (!process.env.RESEND_API_KEY || !to) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your JointSave ${digest.frequency} digest`,
    html: digestEmailHtml(digest),
  })

  if (error) {
    console.error("Resend error:", error)
    throw new Error(error.message)
  }
}

