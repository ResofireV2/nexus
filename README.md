# Nexus

> Ultra fast · Ultra lightweight · Ultra modern

Open source, self-hosted forum software built on Elixir/Phoenix.

## Quick Start (Docker)

```bash
# Clone the repo
git clone https://github.com/yourorg/nexus.git
cd nexus

# Start the dev environment
docker compose up

# Forum is running at http://localhost:4000
# Phoenix LiveDashboard at http://localhost:4000/dev/dashboard
# Local mailbox preview at http://localhost:4000/dev/mailbox
```

That's it. The first `docker compose up` will:
- Pull the Elixir and PostgreSQL images
- Install mix dependencies
- Create and migrate the database
- Start the Phoenix server with hot reload

## Development

```bash
# Start services
docker compose up

# Run tests
docker compose run --rm app mix test

# Open an IEx console
docker compose run --rm app iex -S mix

# Run a migration
docker compose run --rm app mix ecto.migrate

# Generate a new migration
docker compose run --rm app mix ecto.gen.migration add_something
```

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Elixir / Phoenix |
| Real-time | Phoenix Channels + Presence |
| Database | PostgreSQL |
| Background jobs | Oban |
| Object storage | Cloudflare R2 |
| Search | pg tsvector → Meilisearch |
| Deployment | Docker Compose |

## Build Stages

- [x] Stage 1: Project skeleton, Docker Compose, CI
- [ ] Stage 2: Database schema, all migrations
- [ ] Stage 3: Authentication
- [ ] Stage 4: Spaces, tags, feed
- [ ] Stage 5: Posts, replies, composer
- ...

## License

MIT
