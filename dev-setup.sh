#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  Nexus — developer setup
#
#  Differs from install.sh in one and only one way: this script does a
#  git clone of master at /opt/nexus, where install.sh extracts the
#  latest tagged release tarball. Everything else — system deps, data
#  directories, secrets, Caddy, helper scripts — is identical.
#
#  Why a separate script: production users get the latest tagged release
#  for stability and updates via the host-side nexus-update command.
#  Developers want to pull master directly, run nexus-dev-update (which
#  does git pull), and iterate. Mixing the two models has bitten us —
#  this split keeps intent clear and the file-on-disk shape consistent
#  with how each one expects to be updated.
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/ResofireV2/nexus/master/dev-setup.sh -o dev-setup.sh
#    bash dev-setup.sh
# ─────────────────────────────────────────────

INSTALL_DIR="/opt/nexus"
DATA_DIR="/opt/nexus-data"
REPO_URL="https://github.com/ResofireV2/nexus.git"
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
echo "  Developer setup (clones master, updates via git pull)"
echo "  https://github.com/ResofireV2/nexus"
echo ""

# ── Root check ───────────────────────────────
[[ $EUID -ne 0 ]] && die "Please run as root: sudo bash dev-setup.sh"

# ── Detect curl pipe ─────────────────────────
if [ ! -t 0 ]; then
  echo -e "${YELLOW}"
  echo "  It looks like you piped this script through curl."
  echo "  Please download and run it instead:"
  echo ""
  echo "    curl -fsSL https://raw.githubusercontent.com/ResofireV2/nexus/master/dev-setup.sh -o dev-setup.sh"
  echo "    bash dev-setup.sh"
  echo -e "${NC}"
  exit 1
fi

# ── Collect config ───────────────────────────
echo -e "${YELLOW}Configure your forum:${NC}\n"

read -p "  Domain (e.g. forum.example.com): " DOMAIN
[[ -z "$DOMAIN" ]] && die "Domain is required"

read -p "  Email for SSL certificate (Let's Encrypt): " LE_EMAIL
[[ -z "$LE_EMAIL" ]] && die "Email is required for SSL"

read -p "  Include www redirect? (y/n) [y]: " WWW
WWW=${WWW:-y}

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

# ── Clone or update repo ─────────────────────
# Three cases to handle here:
#   1. $INSTALL_DIR doesn't exist → fresh clone.
#   2. $INSTALL_DIR exists and is a git checkout → git pull master.
#   3. $INSTALL_DIR exists but isn't a git checkout → probably a leftover
#      production install from install.sh. Bail with a clear error rather
#      than silently overwriting; the user can decide whether to wipe.
banner "Setting up Nexus source at $INSTALL_DIR..."
if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "$INSTALL_DIR is already a git checkout — pulling latest master..."
  cd "$INSTALL_DIR"
  git fetch origin
  # Discards local changes to tracked files. Untracked files (.env, etc.)
  # are preserved. If someone has uncommitted work here, they need to deal
  # with it before re-running dev-setup.sh; this script is for fresh-ish
  # installs, not a substitute for their own git hygiene.
  git reset --hard origin/master
elif [[ -d "$INSTALL_DIR" ]]; then
  die "$INSTALL_DIR exists but is not a git checkout. \
This is likely a previous production install. \
Remove or move it (e.g. mv $INSTALL_DIR ${INSTALL_DIR}.old) and re-run dev-setup.sh."
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Nexus source ready at $INSTALL_DIR (branch: $(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD), commit: $(git -C "$INSTALL_DIR" rev-parse --short HEAD))"

# ── Generate secrets ─────────────────────────
# Skip regeneration if .env already exists (re-running dev-setup.sh should
# not invalidate existing user sessions or break the DB password against
# what's already in postgres).
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  banner "Generating secrets..."
  SECRET_KEY_BASE=$(openssl rand -base64 48)
  JWT_SECRET=$(openssl rand -base64 32)
  SESSION_SIGNING_SALT=$(openssl rand -base64 16)
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  ok "Secrets generated"

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
else
  warn ".env already exists at $INSTALL_DIR/.env — keeping existing secrets"
fi

# ── Write Caddyfile ──────────────────────────
banner "Configuring Caddy..."
mkdir -p /etc/caddy

CADDY_WWW=""
if [[ "$WWW" =~ ^[Yy] ]]; then
  CADDY_WWW="
www.$DOMAIN {
    redir https://$DOMAIN{uri} permanent
}"
fi

cat > /etc/caddy/Caddyfile << EOF
{
    email $LE_EMAIL
}

$DOMAIN {
    reverse_proxy localhost:4000

    @websockets {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @websockets localhost:4000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # Exclude SSE endpoints from gzip — gzip buffers responses which breaks
    # Server-Sent Events streams that must flush data to the client immediately.
    @nosse {
        not path */live
    }
    encode @nosse gzip
}
$CADDY_WWW
EOF

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

# ── Write dev update script ──────────────────
# nexus-dev-update: git pull master + rebuild. Dev only. Production uses
# tagged-release-based nexus-update (written by install.sh, not here).
# The two scripts have different names so an admin SSH'd into a dev box
# can't accidentally hit the production updater and vice-versa.
banner "Installing management scripts..."
cat > /usr/local/bin/nexus-dev-update << 'UPDATESCRIPT'
#!/bin/bash
set -e
CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

# Refuse to run as non-root. Docker/rsync/systemctl all need root and
# failing partway through with permission errors is worse than failing
# at the start.
if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}✗ nexus-dev-update must be run as root${NC}"
  exit 1
fi

# Serialize concurrent invocations. flock -n exits immediately if the
# lock is held — two terminals running this at once would race on git
# pull and the docker compose rebuild.
LOCK_FILE="/var/lock/nexus-dev-update.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo -e "${RED}✗ Another nexus-dev-update is already running (lock: $LOCK_FILE)${NC}"
  exit 1
fi

echo -e "${CYAN}▶ Updating Nexus (dev)...${NC}"
cd /opt/nexus
git pull origin master
docker compose -f docker-compose.prod.yml up -d --build
systemctl reload caddy
echo -e "${GREEN}✓ Nexus updated. Database and uploads at /opt/nexus-data are untouched.${NC}"
UPDATESCRIPT
chmod +x /usr/local/bin/nexus-dev-update

# ── Write backup script ──────────────────────
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
ok "nexus-dev-update and nexus-backup installed"

echo ""
echo -e "${GREEN}"
echo "  ✓ Nexus is live (developer install)!"
echo ""
echo "  URL:        https://$DOMAIN"
echo "  App code:   $INSTALL_DIR  (git checkout, branch master)"
echo "  Data:       $DATA_DIR  ← database + uploads (never deleted on update)"
echo ""
echo "  To update:  sudo nexus-dev-update    (git pull master + rebuild)"
echo "  To backup:  sudo nexus-backup"
echo "  To view logs: docker compose -f $INSTALL_DIR/docker-compose.prod.yml logs -f app"
echo -e "${NC}"
