// Nexus Service Worker — offline screen + push notifications, no caching

// ---------------------------------------------------------------------------
// Offline fallback
// Only intercepts navigation requests (full page loads).
// All other requests (API calls, assets) pass straight through.
// If the network fails on a navigation, serve the offline page.
// ---------------------------------------------------------------------------

self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return;
  // Let /api/ navigations (e.g. OAuth redirects) pass straight through the
  // browser's normal navigation stack. The service worker's fetch() does not
  // follow cross-origin redirects the same way a browser navigation does —
  // intercepting /api/v1/auth/oauth/* would cause the redirect to GitHub to
  // produce an opaque response and fall through to the offline page.
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const ct = response.headers.get("content-type") || "";
        // Pass through any successful response regardless of content type.
        // This covers HTML pages, images, PDFs, and any other file the user
        // navigates to directly (e.g. opening an uploaded image in a new tab).
        if (response.ok) {
          return response;
        }
        // For error responses, only pass through if the server returned an
        // HTML error page — that's a real error page we want the user to see.
        // If the server returned non-HTML (e.g. a JSON 404 from an API route
        // accidentally hit via direct navigation), throw so the catch block
        // shows the offline page instead of raw JSON.
        if (ct.includes("text/html")) {
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
const FALLBACK_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234A90E2'%3E%3Cpath d='M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z'/%3E%3C/svg%3E";

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

  const opts = {
    body:  data.body || "",
    icon:  icon,
    badge: badge,
    data:  { url: data.url || "/" },
    vibrate: [100, 50, 100]
  };

  // A tag makes a later notification about the same subject replace the one
  // already on screen instead of stacking a second entry — the display-side
  // counterpart of the push Topic, which carries the same value. renotify makes
  // the replacement still alert the user; the spec requires a tag alongside it,
  // so the two are set together or not at all.
  if (data.tag) {
    opts.tag = data.tag;
    opts.renotify = true;
  }

  event.waitUntil(self.registration.showNotification(data.title || "Nexus", opts));
});

// ---------------------------------------------------------------------------
// Push subscription renewal
// ---------------------------------------------------------------------------
//
// Browsers expire push subscriptions periodically for security. When that
// happens the browser fires pushsubscriptionchange with the old (now invalid)
// subscription and a new one already created. Without this handler Nexus
// never learns about the new subscription, the old endpoint goes stale, and
// push notifications stop arriving until the user manually re-enables them in
// Settings.
//
// This handler re-registers the new subscription with the Nexus backend
// automatically so push notifications continue without user intervention.
self.addEventListener("pushsubscriptionchange", event => {
  const newSub = event.newSubscription;
  if (!newSub) return;

  const subJson = JSON.stringify({
    endpoint: newSub.endpoint,
    keys: {
      p256dh: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey("p256dh")))),
      auth:   btoa(String.fromCharCode(...new Uint8Array(newSub.getKey("auth")))),
    }
  });

  // Re-register with the Nexus backend. The token is stored in localStorage
  // by the main app; we read it here to authenticate the request.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clientList => {
        // Ask an open window for the auth token via MessageChannel.
        // If no window is open we fall back to an unauthenticated request
        // which will fail — the user will need to re-enable manually in
        // that rare case. In practice the browser only fires this event
        // when the page has been opened recently.
        const client = clientList.find(c => c.url && !c.url.includes("offline"));

        const getToken = client
          ? new Promise(resolve => {
              const channel = new MessageChannel();
              channel.port1.onmessage = e => resolve(e.data?.token || null);
              client.postMessage({ type: "GET_AUTH_TOKEN" }, [channel.port2]);
              // Timeout after 2 seconds
              setTimeout(() => resolve(null), 2000);
            })
          : Promise.resolve(null);

        return getToken.then(token => {
          const headers = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = `Bearer ${token}`;

          return fetch("/api/v1/push/subscribe", {
            method:  "POST",
            headers: headers,
            body:    JSON.stringify({ subscription: JSON.parse(subJson) })
          });
        });
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
