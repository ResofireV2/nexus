# Nexus

> Ultra fast · Ultra lightweight · Ultra modern

Open source, self-hosted forum software built on Elixir/Phoenix. Nexus is designed to be deployed by a single person on a single server in under ten minutes, with no technical knowledge required beyond owning a domain.

---

## Features

**Forum**
- Spaces (sub-forums) with custom colors and descriptions
- Threads with rich Markdown composer — images, code blocks, embeds, mentions
- Nested replies with voting, reactions, and accepted answers
- Pinned threads, thread tags, saved threads
- Full-text search across posts and replies (PostgreSQL tsvector)
- Link preview unfurling

**Members**
- Email/password registration with email verification
- Magic link (passwordless) login
- OAuth via Google and GitHub
- User profiles with avatars, cover images, bio, and social links
- Follow system and activity feed
- Direct messages
- Badges and award system

**Leaderboard**
- Weekly, monthly, and all-time rankings
- Configurable points system
- Optional staff exclusion

**Notifications**
- Real-time in-app notifications via WebSocket
- Web push notifications (VAPID)
- Weekly digest emails with configurable sections

**Extensions**
- Install extensions from a URL or the built-in store
- Extensions can add sidebar widgets, composer tools, admin panels, and feed items
- Webhook system for backend event hooks
- Sync and update extensions independently of core

**Admin panel**
- General settings: site name, description, branding, logo, favicon, OG image
- Appearance: accent color, theme, layout options
- Registration: open/invite-only/closed, email domain allowlists
- Email: Postmark, Resend, Mailgun, or SMTP configuration
- Storage: local filesystem or Cloudflare R2 / S3-compatible
- Leaderboard configuration
- Digest email configuration and preview
- PWA settings: icons, theme color, push notification VAPID keys
- Extensions management
- Moderation queue and user management
- Logs: job failures and settings change history

**Mobile**
- Fully responsive mobile layout
- Progressive Web App (PWA) — installable on iOS and Android
- Mobile-specific navigation, overlays, and bottom tab bar

---

## Installation

Nexus runs on Ubuntu 22.04 or 24.04. You need a domain pointing at your server and a root shell.

```bash
curl -fsSL https://raw.githubusercontent.com/ResofireV2/nexus/master/install.sh -o install.sh
bash install.sh
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
nexus-update   # update to the latest release
nexus-backup   # back up the database and uploads
```

---

## Development

```bash
# Start the dev environment
docker compose up

# Forum is running at http://localhost:4000
# Mailbox preview at http://localhost:4000/dev/mailbox
```

```bash
# Run tests
docker compose run --rm app mix test

# Open an IEx console
docker compose run --rm app iex -S mix

# Run migrations
docker compose run --rm app mix ecto.migrate

# Generate a migration
docker compose run --rm app mix ecto.gen.migration add_something
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

Extensions are standalone services that integrate with Nexus via a `manifest.json`. They can:

- Register frontend JS bundles that inject React components into sidebar slots, the composer, and admin panels
- Subscribe to backend webhook events (new post, new reply, new member, etc.)
- Add settings tabs to the admin panel
- Expose their own API routes through the Nexus extension proxy

See the [nexus-extensions](https://github.com/ResofireV2/nexus-extensions) repository for the extension registry and published extensions.

---

## License

MIT
