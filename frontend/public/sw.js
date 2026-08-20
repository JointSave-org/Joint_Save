/**
 * JointSave Service Worker — push notification handler.
 *
 * Handles 'push' events from the Web Push API and displays browser
 * notifications via the Notifications API.
 *
 * Registered in the Web3Provider / layout via navigator.serviceWorker.register('/sw.js').
 */

/* global self, clients */

// ─── Push event ───────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: "JointSave", body: event.data.text(), url: "/dashboard" }
  }

  const { title, body, url, icon } = payload

  const options = {
    body: body ?? "You have a new notification.",
    icon: icon ?? "/joint-save.webp",
    badge: "/joint-save.webp",
    data: { url: url ?? "/dashboard" },
    // Reuse the same notification tag per pool to avoid stacking identical alerts.
    tag: payload.pool_id ? `jointsave-pool-${payload.pool_id}-${payload.event_type}` : "jointsave",
    renotify: false,
  }

  event.waitUntil(self.registration.showNotification(title ?? "JointSave", options))
})

// ─── Notification click event ─────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url ?? "/dashboard"

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing window on the target URL if possible.
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus()
          }
        }
        // Otherwise open a new tab.
        if (clients.openWindow) {
          return clients.openWindow(targetUrl)
        }
      })
  )
})

// ─── Push subscription change (browser auto-renewed subscription) ─────────────
self.addEventListener("pushsubscriptionchange", (event) => {
  // Re-subscribe and persist the new subscription to the server.
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
      })
      .then((newSubscription) => {
        return fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // wallet_address not available in SW context; server matches via endpoint.
            subscription: newSubscription.toJSON(),
          }),
        })
      })
  )
})
