// Entry point for the lazily-loaded admin bundle (admin.js).
//
// The entire admin panel tree (~336K minified) is built into a separate bundle
// so the ~99% of visitors who never open /admin don't download it. This bundle
// is injected on demand by loadAdminBundle() in nexus.jsx when an admin
// navigates to /admin.
//
// Shared modules (react, react/jsx-runtime, the api client, Toasts, Avatar, and
// the other shared components) are NOT bundled here — the build externalizes
// them to the main app's single instances via window.__nexusRuntime (see
// build.js). That keeps React as one instance (required for hooks), avoids
// re-running modules with side effects (e.g. the api client's install-prompt
// listeners), and keeps singleton state (toast queue, user-card popover) shared
// with the main app.
import { AdminPage } from "./admin/AdminPage";

window.NexusAdmin = { AdminPage };

// Signal readiness for loaders that prefer an event over polling.
try { window.dispatchEvent(new Event("nexus:admin-bundle-ready")); } catch (e) {}
