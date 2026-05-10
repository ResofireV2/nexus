// Nexus Service Worker — offline screen + push notifications, no caching

// ---------------------------------------------------------------------------
// Offline fallback
// Only intercepts navigation requests (full page loads).
// All other requests (API calls, assets) pass straight through.
// If the network fails on a navigation, serve the offline page.
// ---------------------------------------------------------------------------

self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Only serve the response if it's a successful HTML page.
        // If the server returns any error (4xx/5xx) or non-HTML content type
        // (e.g. JSON from an API route), throw so the catch block handles it.
        // This prevents the SW from passing a JSON 404 through to the page.
        const ct = response.headers.get("content-type") || "";
        if (response.ok && ct.includes("text/html")) {
          return response;
        }
        throw new Error(`SW: unexpected response ${response.status} ${ct}`);
      })
      .catch(() =>
        caches.match("/offline.html").then(cached => {
          if (cached) return cached;
          // No offline page cached either — return a minimal HTML fallback.
          return new Response(
            "<h1>You're offline</h1><p>Check your connection and try again.</p>",
            { headers: { "Content-Type": "text/html" } }
          );
        })
      )
  );
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

// Small bell SVG data URI — used as ultimate fallback if the icon URL fails
const FALLBACK_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23a78bfa'%3E%3Cpath d='M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z'/%3E%3C/svg%3E";

self.addEventListener("push", event => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch(e) {
    // Payload wasn't valid JSON — show a generic notification
    data = { title: "New notification", body: "", url: "/" };
  }

  const icon  = data.icon  || FALLBACK_ICON;
  const badge = data.badge || FALLBACK_ICON;

  event.waitUntil(
    self.registration.showNotification(data.title || "Nexus", {
      body:  data.body || "",
      icon:  icon,
      badge: badge,
      data:  { url: data.url || "/" },
      vibrate: [100, 50, 100]
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === event.notification.data.url && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});
