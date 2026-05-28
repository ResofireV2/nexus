#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  Nexus — one-command installer
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/ResofireV2/nexus/master/install.sh -o install.sh
#    bash install.sh
# ─────────────────────────────────────────────

INSTALL_DIR="/opt/nexus"
DATA_DIR="/opt/nexus-data"
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

banner() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()     { echo -e "${GREEN}✓ $1${NC}"; }
warn()   { echo -e "${YELLOW}! $1${NC}"; }
die()    { echo -e "${RED}✗ $1${NC}"; exit 1; }

echo -e "${CYAN}"
echo "  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗"
echo "  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝"
echo "  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗"
echo "  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║"
echo "  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║"
echo "  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝"
echo -e "${NC}"
echo "  Forum software installer"
echo "  https://github.com/ResofireV2/nexus"
echo ""

# ── Root check ───────────────────────────────
[[ $EUID -ne 0 ]] && die "Please run as root: sudo bash install.sh"

# ── Detect curl pipe ─────────────────────────
if [ ! -t 0 ]; then
  echo -e "${YELLOW}"
  echo "  It looks like you piped this script through curl."
  echo "  Please download and run it instead:"
  echo ""
  echo "    curl -fsSL https://raw.githubusercontent.com/ResofireV2/nexus/master/install.sh -o install.sh"
  echo "    bash install.sh"
  echo -e "${NC}"
  exit 1
fi

# ── Collect config ───────────────────────────
echo -e "${YELLOW}Configure your forum:${NC}\n"

read -p "  Domain (e.g. forum.example.com): " DOMAIN
[[ -z "$DOMAIN" ]] && die "Domain is required"

read -p "  Email for SSL certificate (Let's Encrypt): " LE_EMAIL
[[ -z "$LE_EMAIL" ]] && die "Email is required for SSL"

# Only offer the www redirect for apex domains (no dots in the subdomain position).
# A subdomain like forum.example.com already has a prefix — www.forum.example.com
# is not a meaningful redirect target.
WWW="n"
if [[ "$DOMAIN" =~ ^[^.]+\.[^.]+$ ]]; then
  read -p "  Include www redirect? (y/n) [y]: " WWW
  WWW=${WWW:-y}
fi

echo ""

# ── Install dependencies ─────────────────────
banner "Installing dependencies..."

apt-get update -qq
apt-get install -y -qq ca-certificates curl git

# Docker — official repo (docker-ce, not docker.io)
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# Install Caddy
if ! command -v caddy &>/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi

systemctl enable docker caddy
systemctl start docker
ok "Dependencies installed"

# ── Create persistent data directories ───────
banner "Creating persistent data directories..."
mkdir -p "$DATA_DIR/postgres"
mkdir -p "$DATA_DIR/uploads/posts"
mkdir -p "$DATA_DIR/uploads/avatars"
mkdir -p "$DATA_DIR/uploads/covers"
mkdir -p "$DATA_DIR/uploads/logos"
mkdir -p "$DATA_DIR/uploads/webp/posts"
mkdir -p "$DATA_DIR/uploads/webp/avatars"
mkdir -p "$DATA_DIR/uploads/webp/covers"
mkdir -p "$DATA_DIR/uploads/webp/logos"
chmod -R 755 "$DATA_DIR"
ok "Data directories created at $DATA_DIR"

# ── Fetch latest release ─────────────────────
banner "Fetching latest Nexus release..."

RELEASE_JSON=$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/ResofireV2/nexus/releases/latest") \
  || die "Could not reach GitHub API"

RELEASE_TAG=$(echo "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')
TARBALL_URL=$(echo "$RELEASE_JSON" | grep -o '"tarball_url": *"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')

[[ -z "$RELEASE_TAG" ]] && die "Could not determine latest release tag. Is there a tagged release on GitHub?"
[[ -z "$TARBALL_URL" ]] && die "Could not determine tarball URL for release $RELEASE_TAG"

ok "Latest release: $RELEASE_TAG"

TMP_ARCHIVE="/tmp/nexus-${RELEASE_TAG}.tar.gz"
TMP_EXTRACT="/tmp/nexus-${RELEASE_TAG}"

banner "Downloading release $RELEASE_TAG..."
curl -fsSL -L \
  -H "Accept: application/vnd.github+json" \
  "$TARBALL_URL" -o "$TMP_ARCHIVE" \
  || die "Failed to download release tarball"

banner "Extracting release..."
mkdir -p "$TMP_EXTRACT"
tar --strip-components=1 -xzf "$TMP_ARCHIVE" -C "$TMP_EXTRACT" \
  || die "Failed to extract release archive"

if [[ -d "$INSTALL_DIR" ]]; then
  warn "Directory $INSTALL_DIR already exists — updating files (preserving .env and data)..."
  rsync -a \
    --exclude=".env" \
    --exclude="docker-compose.yml" \
    --exclude="docker-compose.prod.yml" \
    "$TMP_EXTRACT/" "$INSTALL_DIR/" 2>/dev/null \
  || cp -r "$TMP_EXTRACT/." "$INSTALL_DIR/"
else
  mkdir -p "$INSTALL_DIR"
  cp -r "$TMP_EXTRACT/." "$INSTALL_DIR/"
fi

rm -rf "$TMP_ARCHIVE" "$TMP_EXTRACT"
cd "$INSTALL_DIR"
ok "Nexus $RELEASE_TAG ready at $INSTALL_DIR"

# ── Generate secrets ─────────────────────────
banner "Generating secrets..."
SECRET_KEY_BASE=$(openssl rand -base64 48)
JWT_SECRET=$(openssl rand -base64 32)
SESSION_SIGNING_SALT=$(openssl rand -base64 16)
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
ok "Secrets generated"

# ── Write .env ───────────────────────────────
banner "Writing configuration..."
cat > "$INSTALL_DIR/.env" << EOF
PHX_HOST=$DOMAIN
SECRET_KEY_BASE=$SECRET_KEY_BASE
JWT_SECRET=$JWT_SECRET
SESSION_SIGNING_SALT=$SESSION_SIGNING_SALT
DB_PASSWORD=$DB_PASSWORD
EOF
chmod 600 "$INSTALL_DIR/.env"
ok ".env written"

# ── Write Caddyfile ──────────────────────────
# The Caddyfile is written to /opt/nexus/Caddyfile — this is the
# canonical copy. The nexus-update script copies it from here to
# /etc/caddy/Caddyfile on every update, so any manual additions
# (e.g. a homepage or docs subdomain on the same server) should be
# made to /opt/nexus/Caddyfile to survive updates.
banner "Configuring Caddy..."

CADDY_WWW=""
if [[ "$WWW" =~ ^[Yy] ]]; then
  CADDY_WWW="
www.$DOMAIN {
    redir https://$DOMAIN{uri} permanent
}"
fi

cat > "$INSTALL_DIR/Caddyfile" << EOF
{
    email $LE_EMAIL
}

$DOMAIN {
    # Security headers for all responses
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    @static {
        path /assets/* /images/* /favicon.ico /robots.txt /manifest.json /sw.js
    }
    header @static Cache-Control "public, max-age=31536000, immutable"

    # User-uploaded avatars and logos use UUID filenames — new uploads always
    # get a new URL, so long-lived caching is safe.
    @uploads_immutable {
        path /uploads/avatars/* /uploads/logos/*
    }
    header @uploads_immutable Cache-Control "public, max-age=31536000, immutable"

    # Self-hosted Font Awesome — woff2 files are versioned by filename.
    @fonts {
        path /fonts/*
    }
    header @fonts Cache-Control "public, max-age=31536000, immutable"

    # Exclude SSE (Server-Sent Events) endpoints from gzip compression.
    # Gzip buffers the full response before compressing — this breaks SSE
    # streams which must flush data to the client incrementally.
    @nosse {
        not path */live */events */stream
    }
    encode @nosse gzip

    # --- Nexus (catch-all, must be last) ---
    @websockets {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    handle @websockets {
        reverse_proxy localhost:4000 {
            header_up X-Forwarded-For {remote_host}
        }
    }

    handle {
        reverse_proxy localhost:4000 {
            header_up X-Forwarded-For {remote_host}
        }
    }
}
$CADDY_WWW
EOF

cp "$INSTALL_DIR/Caddyfile" /etc/caddy/Caddyfile
systemctl restart caddy
ok "Caddy configured for $DOMAIN"

# ── Launch ───────────────────────────────────
banner "Building and launching Nexus (this takes 5-10 minutes)..."
cd "$INSTALL_DIR"
docker compose -f docker-compose.prod.yml up -d --build

# ── Wait for startup ─────────────────────────
echo ""
echo -n "  Waiting for Nexus to start"
for i in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml logs app 2>/dev/null | grep -q "Running NexusWeb.Endpoint"; then
    echo ""
    break
  fi
  echo -n "."
  sleep 5
done

# ── Write management scripts ─────────────────
# Production installs ship two scripts:
#
#   nexus-update — fetches the latest tagged release from GitHub, rsyncs
#                  it over /opt/nexus (preserving .env and compose files),
#                  and rebuilds the container. Mirrors what install.sh
#                  does on a fresh install, minus the system-deps and
#                  data-directory setup.
#
#   nexus-backup — snapshots database and uploads to /opt/nexus-backups,
#                  keeping the last 10 of each.
#
# Both refuse to run as non-root and use flock to prevent concurrent
# invocations. The admin panel surfaces "an update is available" with
# copy-to-clipboard instructions for the nexus-update command; applying
# the update from inside the running container cannot work (no docker
# CLI, no docker socket, no host filesystem access).
#
# Developer installs (dev-setup.sh) write nexus-dev-update instead,
# which does git pull master rather than tarball fetch. The two scripts
# are deliberately named differently so an admin can't accidentally hit
# the wrong one.
banner "Installing management scripts..."

cat > /usr/local/bin/nexus-update << 'UPDATESCRIPT'
#!/bin/bash
set -e
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

# Refuse to run as non-root. Docker, rsync into /opt/nexus, and Caddy
# reload all require root.
if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}✗ nexus-update must be run as root (try: sudo nexus-update)${NC}"
  exit 1
fi

# Serialize concurrent invocations. Two simultaneous updates would race
# on rsync and the docker compose rebuild.
LOCK_FILE="/var/lock/nexus-update.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo -e "${RED}✗ Another nexus-update is already running (lock: $LOCK_FILE)${NC}"
  exit 1
fi

INSTALL_DIR="/opt/nexus"

echo -e "${CYAN}▶ Fetching latest Nexus release...${NC}"
RELEASE_JSON=$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/ResofireV2/nexus/releases/latest") \
  || { echo -e "${RED}✗ Could not reach GitHub API${NC}"; exit 1; }

RELEASE_TAG=$(echo "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')
TARBALL_URL=$(echo "$RELEASE_JSON" | grep -o '"tarball_url": *"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')

if [[ -z "$RELEASE_TAG" || -z "$TARBALL_URL" ]]; then
  echo -e "${RED}✗ Could not determine latest release tag or tarball URL${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Latest release: $RELEASE_TAG${NC}"

# Temp paths — both cleaned up unconditionally on exit so a failed
# update doesn't leave a half-extracted tarball behind to confuse the
# next run.
TMP_ARCHIVE="/tmp/nexus-${RELEASE_TAG}.tar.gz"
TMP_EXTRACT="/tmp/nexus-${RELEASE_TAG}"
trap 'rm -rf "$TMP_ARCHIVE" "$TMP_EXTRACT"' EXIT

echo -e "${CYAN}▶ Downloading $RELEASE_TAG...${NC}"
# Same Accept header that install.sh uses successfully — empirically
# verified against GitHub. Do not change to application/octet-stream;
# that returns 415 Unsupported Media Type from the tarball endpoint.
curl -fsSL -L \
  -H "Accept: application/vnd.github+json" \
  "$TARBALL_URL" -o "$TMP_ARCHIVE" \
  || { echo -e "${RED}✗ Failed to download release tarball${NC}"; exit 1; }

echo -e "${CYAN}▶ Extracting...${NC}"
mkdir -p "$TMP_EXTRACT"
tar --strip-components=1 -xzf "$TMP_ARCHIVE" -C "$TMP_EXTRACT" \
  || { echo -e "${RED}✗ Failed to extract release archive${NC}"; exit 1; }

echo -e "${CYAN}▶ Applying files to $INSTALL_DIR (preserving .env and compose files)...${NC}"
rsync -a \
  --exclude=".env" \
  --exclude=".env" \
  --exclude="docker-compose.yml" \
  --exclude="docker-compose.prod.yml" \
  "$TMP_EXTRACT/" "$INSTALL_DIR/"

echo -e "${CYAN}▶ Rebuilding container (this takes a few minutes)...${NC}"
cd "$INSTALL_DIR"
# Migrations run on container boot via Nexus.Release.migrate() — see
# the compose command in docker-compose.prod.yml. We don't run them
# explicitly here.
docker compose -f docker-compose.prod.yml up -d --build

echo -e "${CYAN}▶ Reloading Caddy...${NC}"
cp /opt/nexus/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

echo -e "${GREEN}✓ Nexus updated to $RELEASE_TAG. Database and uploads at /opt/nexus-data are untouched.${NC}"
UPDATESCRIPT
chmod +x /usr/local/bin/nexus-update

cat > /usr/local/bin/nexus-backup << 'BACKUPSCRIPT'
#!/bin/bash
set -e
BACKUP_DIR="/opt/nexus-backups"
DATE=$(date +%Y%m%d_%H%M%S)
CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'

mkdir -p "$BACKUP_DIR"

echo -e "${CYAN}▶ Backing up database...${NC}"
docker exec nexus-db-1 pg_dump -U nexus nexus_prod | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

echo -e "${CYAN}▶ Backing up uploads...${NC}"
tar -czf "$BACKUP_DIR/uploads_$DATE.tar.gz" -C /opt/nexus-data uploads/

# Keep last 10 backups of each
ls -t "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null | tail -n +11 | xargs rm -f
ls -t "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | tail -n +11 | xargs rm -f

echo -e "${GREEN}✓ Backup complete${NC}"
ls -lh "$BACKUP_DIR/db_$DATE.sql.gz" "$BACKUP_DIR/uploads_$DATE.tar.gz"
BACKUPSCRIPT
chmod +x /usr/local/bin/nexus-backup
ok "nexus-update and nexus-backup installed"

echo ""
echo -e "${GREEN}"
echo "  ✓ Nexus is live!"
echo ""
echo "  URL:        https://$DOMAIN"
echo "  App code:   $INSTALL_DIR"
echo "  Data:       $DATA_DIR  ← database + uploads (never deleted on update)"
echo ""
echo "  To add other sites to this server (e.g. a homepage or docs site),"
echo "  edit /opt/nexus/Caddyfile and run: cp /opt/nexus/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy"
echo "  This file is the canonical Caddyfile — it survives nexus-update."
echo ""
echo "  To update:  sudo nexus-update    (when a new release is tagged)"
echo "  To backup:  sudo nexus-backup"
echo "  To view logs: docker compose -f $INSTALL_DIR/docker-compose.prod.yml logs -f app"
echo -e "${NC}"
