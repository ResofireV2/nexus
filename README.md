![Nexus](https://raw.githubusercontent.com/ResofireV2/nexus/master/priv/static/images/nexus-og.webp)

# Nexus

> Ultra fast · Ultra lightweight · Ultra modern

Open source, self-hosted forum software built on Elixir/Phoenix. Nexus is designed to be deployed by a single person on a single server in under ten minutes, with no technical knowledge required beyond owning a domain.

---

## Features

**Forum**
- Spaces and sub-spaces with custom colors and descriptions
- Threads with rich Markdown composer — images, image grids, code blocks, embeds, mentions, emoji picker
- Nested replies with voting, reactions, and accepted answers
- Pinned threads, thread tags, saved threads
- Full-text search across posts and replies (PostgreSQL tsvector)
- Link preview unfurling

**Members**
- Email/password registration with email verification
- Magic link (passwordless) login
- OAuth via Google and GitHub
- User profiles with avatars, cover images, bio, and social links
- Groups — admin-defined member groups for permission gating and optional public badges on profiles, posts, and user cards
- Follow system and activity feed
- Direct messages
- Badges and award system
- Data export — download a full copy of your posts, replies, messages, and profile as a ZIP archive
- Account deletion with a 30-day grace period — contributions can be anonymised or deleted, configurable by the admin

**Leaderboard**
- Weekly, monthly, and all-time rankings
- Configurable points system
- Optional staff exclusion

**Notifications**
- Real-time in-app notifications via WebSocket
- Web push notifications (VAPID)
- Daily, weekly, and monthly digest emails with configurable sections

**Extensions**
- Install extensions from a URL or the built-in store
- Extensions run in-VM alongside Nexus — no separate service, no webhook delivery, no Docker networking
- Extensions can add sidebar widgets, composer tools, slots, admin panels, API routes, and background workers
- Group-aware permission gates — grant access by role, group membership, or both
- Sync and update extensions independently of core

**Themes**
- Install themes from a URL or the built-in store
- Themes inject a CSS stylesheet into every page — full layout, typography, and component control
- Assign different themes to dark and light mode independently

**Admin panel**
- General settings: site name, description, branding, logo, favicon, OG image
- Appearance: accent color, theme, layout options
- Registration: open/invite-only/closed, email domain allowlists, DM lockout duration
- Email: Postmark, Resend, Mailgun, or SMTP configuration
- Storage: local filesystem or Cloudflare R2 / S3-compatible
- Reactions: configurable emoji reaction set (1–8 reactions)
- Groups: create and manage member groups with optional public badges
- Themes: install and assign themes per mode
- Leaderboard configuration
- Digest email configuration and preview
- PWA settings: icons, theme color, push notification VAPID keys
- Pages: create static pages (privacy policy, community guidelines, etc.) served at `/p/:slug`
- Extensions management
- Moderation queue and user management
- Permissions: role and group-based access gates for uploads and extension features
- Logs: job failures and settings change history

**Right sidebar**
- Legal & Info widget — configurable links to privacy policy, community guidelines, terms of service, and security settings

**Mobile**
- Fully responsive mobile layout
- Progressive Web App (PWA) — installable on iOS and Android
- Mobile-specific navigation, overlays, and bottom tab bar

---

## Installation

Nexus runs on Ubuntu 22.04, 24.04, or 26.04. You need a domain pointing at your server and a root shell.

```bash
curl -fsSL https://raw.githubusercontent.com/ResofireV2/nexus/master/install.sh -o install.sh
sudo bash install.sh
```

The installer will:
- Install Docker and Caddy
- Download the latest Nexus release
- Prompt for your domain and SSL email
- Generate all secrets
- Build and launch the application
- Configure HTTPS automatically via Let's Encrypt

Total time: approximately 5–10 minutes depending on server speed.

**Management commands installed automatically:**
```bash
nexus-update   # update Nexus to the latest release
nexus-backup   # back up the database and uploads
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Elixir / Phoenix 1.7 |
| Real-time | Phoenix Channels + WebSockets |
| Database | PostgreSQL |
| Search | PostgreSQL tsvector (full-text) |
| Background jobs | Oban |
| Image processing | libvips (via the `image` library) |
| Object storage | Local filesystem or Cloudflare R2 / S3-compatible |
| Email | Postmark · Resend · Mailgun · SMTP |
| Push notifications | Web Push (VAPID, RFC 8291/8292) |
| Reverse proxy | Caddy (automatic HTTPS) |
| Deployment | Docker Compose |

---

## Extension Development

Extensions run directly inside the Nexus VM — compiled into the running BEAM, sharing the database, supervision tree, and dependency tree. There is no separate service to deploy, no webhook delivery, and no inter-service authentication.

Extensions can:

- Subscribe to backend hook events (new post, new reply, new member, etc.) via direct function calls
- Register frontend JS bundles that inject React components into slots, the composer, the sidebar, and admin panels
- Add their own API routes through the Nexus extension router
- Define database migrations, background workers, and admin settings
- Gate features using role tiers or admin-configured group membership

A dedicated Oban queue named `:extensions` is reserved for extension background jobs — use it for any async work your extension needs to run. Nexus core never schedules jobs into this queue.

See the [Extension Development Guide](https://docs.nexusprism.org/extensions/building/) for full documentation on building extensions, including routes, hooks, settings, digest sections, and background jobs.

See the [nexus-extensions](https://github.com/ResofireV2/nexus-extensions) repository for the extension registry and published extensions.

---

## License

MIT
