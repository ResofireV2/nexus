#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  Nexus — one-command installer
#  Usage: curl -fsSL https://raw.githubusercontent.com/ResofireV2/nexus/master/install.sh | bash
# ─────────────────────────────────────────────

REPO="https://github.com/ResofireV2/nexus.git"
INSTALL_DIR="/opt/nexus"
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

# ── Collect config ───────────────────────────
echo -e "${YELLOW}Configure your forum:${NC}\n"

read -p "  Domain (e.g. billyrayfoss.com): " DOMAIN
[[ -z "$DOMAIN" ]] && die "Domain is required"

read -p "  Include www redirect? (y/n) [y]: " WWW
WWW=${WWW:-y}

echo ""

# ── Install dependencies ─────────────────────
banner "Installing dependencies..."

apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 git curl

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

# ── Clone repo ───────────────────────────────
banner "Cloning Nexus..."
if [[ -d "$INSTALL_DIR" ]]; then
  warn "Directory $INSTALL_DIR already exists — pulling latest..."
  cd "$INSTALL_DIR" && git pull
else
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "Repository ready at $INSTALL_DIR"

# ── Generate secrets ─────────────────────────
banner "Generating secrets..."
SECRET_KEY_BASE=$(openssl rand -base64 48)
JWT_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -base64 24)
ok "Secrets generated"

# ── Write .env ───────────────────────────────
banner "Writing configuration..."
cat > "$INSTALL_DIR/.env" <<EOF
PHX_HOST=$DOMAIN
SECRET_KEY_BASE=$SECRET_KEY_BASE
JWT_SECRET=$JWT_SECRET
DB_PASSWORD=$DB_PASSWORD
EOF
ok ".env written"

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

cat > /etc/caddy/Caddyfile <<EOF
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

    encode gzip
}
$CADDY_WWW
EOF

systemctl restart caddy
ok "Caddy configured for $DOMAIN"

# ── Launch ───────────────────────────────────
banner "Building and launching Nexus (this takes 5-10 minutes)..."
cd "$INSTALL_DIR"
docker compose -f docker-compose.prod.yml pull 2>/dev/null || true
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

echo ""
echo -e "${GREEN}"
echo "  ✓ Nexus is live!"
echo ""
echo "  URL:   https://$DOMAIN"
echo ""
echo "  To view logs:   docker compose -f $INSTALL_DIR/docker-compose.prod.yml logs -f app"
echo "  To update:      cd $INSTALL_DIR && git pull && docker compose -f docker-compose.prod.yml up -d --build"
echo -e "${NC}"
