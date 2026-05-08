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
    fetch(event.request).catch(() =>
      caches.match("/offline.html").then(cached => {
        if (cached) return cached;
        // If somehow offline.html isn't cached either, return a bare response
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

self.addEventListener("push", event => {
  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || "Nexus", {
      body: data.body || "",
      icon: "/images/icon-192.png",
      badge: "/images/icon-192.png",
      data: { url: data.url || "/" }
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
