#!/bin/bash
set -e

echo "=== Nexus server setup ==="
echo "Run this once on a fresh Ubuntu 24.04 VPS as root or with sudo."
echo ""

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Install Caddy
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# Allow Docker without sudo for current user
usermod -aG docker $SUDO_USER 2>/dev/null || true

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Upload your nexus folder to the server"
echo "2. cd nexus"
echo "3. cp .env.example .env"
echo "4. Edit .env with your domain and generated secrets"
echo "5. cp Caddyfile /etc/caddy/Caddyfile"
echo "6. Edit /etc/caddy/Caddyfile — replace {$PHX_HOST} with your actual domain"
echo "7. systemctl restart caddy"
echo "8. docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "Generate secrets with:"
echo "  openssl rand -base64 48   # for SECRET_KEY_BASE"
echo "  openssl rand -base64 32   # for JWT_SECRET"
echo "  openssl rand -base64 24   # for DB_PASSWORD"
