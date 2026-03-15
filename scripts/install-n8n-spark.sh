#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Install n8n on NVIDIA DGX Spark
#
#  n8n was previously installed but has been removed.
#  This script reinstalls n8n + Postgres + Redis via Docker Compose
#  on the DGX Spark for the OpenClaw push architecture.
#
#  Prerequisites:
#  - SSH access to the DGX Spark
#  - Docker + Docker Compose installed on the Spark
#  - NVIDIA Container Toolkit configured (for future LLM containers)
#
#  Usage:
#    ssh into Spark, then:
#    ./scripts/install-n8n-spark.sh
#
#  Or remote:
#    ssh user@spark-ip 'bash -s' < scripts/install-n8n-spark.sh
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  OpenClaw — n8n Installation on DGX Spark"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── Configuration ──────────────────────────────────────────────────
INSTALL_DIR="${OPENCLAW_DIR:-/opt/openclaw}"
COMPOSE_FILE="${INSTALL_DIR}/docker/docker-compose.yml"

# ─── Step 0: Verify Docker ─────────────────────────────────────────
echo "▸ Checking Docker..."
if ! command -v docker &>/dev/null; then
  echo "  ❌ Docker not found. Install Docker first:"
  echo "     curl -fsSL https://get.docker.com | sh"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "  ❌ Docker Compose (v2) not found."
  echo "     Install via: sudo apt-get install docker-compose-plugin"
  exit 1
fi

echo "  ✅ Docker $(docker --version | awk '{print $3}')"
echo "  ✅ Docker Compose $(docker compose version --short)"

# ─── Step 1: Check NVIDIA runtime (for future LLM containers) ─────
echo ""
echo "▸ Checking NVIDIA Container Toolkit..."
if docker info 2>/dev/null | grep -q "nvidia"; then
  echo "  ✅ NVIDIA runtime available"
else
  echo "  ⚠️  NVIDIA runtime not detected (ok for n8n, needed later for vLLM)"
fi

# ─── Step 2: Create installation directory ─────────────────────────
echo ""
echo "▸ Setting up installation directory: ${INSTALL_DIR}"
sudo mkdir -p "${INSTALL_DIR}"/{docker,data,credentials,logs}
sudo chown -R "$(whoami)" "${INSTALL_DIR}"

# ─── Step 3: Copy Docker Compose file ──────────────────────────────
echo ""
echo "▸ Setting up Docker Compose..."

# Check if compose file exists in project, otherwise create it
if [ -f "$(dirname "$0")/../docker/docker-compose.yml" ]; then
  cp "$(dirname "$0")/../docker/docker-compose.yml" "${INSTALL_DIR}/docker/"
  cp "$(dirname "$0")/../docker/.env.example" "${INSTALL_DIR}/docker/.env.example"
  echo "  ✅ Compose files copied from project"
else
  echo "  ℹ️  Run this script from the openclaw-push-architecture project root"
  echo "     or copy docker/docker-compose.yml to ${INSTALL_DIR}/docker/ manually"
fi

# ─── Step 4: Generate .env if not exists ───────────────────────────
echo ""
ENV_FILE="${INSTALL_DIR}/docker/.env"
if [ ! -f "${ENV_FILE}" ]; then
  echo "▸ Generating .env with random secrets..."
  cat > "${ENV_FILE}" << EOF
# OpenClaw — DGX Spark Environment
# Generated on $(date)

# PostgreSQL
POSTGRES_PASSWORD=$(openssl rand -hex 24)

# n8n
N8N_ENCRYPTION_KEY=$(openssl rand -hex 16)
N8N_HOST=0.0.0.0
N8N_PROTOCOL=http
N8N_USER=admin
N8N_PASSWORD=$(openssl rand -hex 12)

# Webhook URL — UPDATE THIS with your Spark's public URL or tunnel
# For development: use Cloudflare Tunnel or ngrok
# For production: use your domain with SSL
WEBHOOK_URL=http://$(hostname -I | awk '{print $1}'):5678/
EOF
  echo "  ✅ .env created at ${ENV_FILE}"
  echo "  ⚠️  Review and update WEBHOOK_URL before production use!"
else
  echo "  ℹ️  .env already exists at ${ENV_FILE}"
fi

# ─── Step 5: Pull images ──────────────────────────────────────────
echo ""
echo "▸ Pulling Docker images (this may take a few minutes)..."
cd "${INSTALL_DIR}/docker"
docker compose pull

# ─── Step 6: Start services ───────────────────────────────────────
echo ""
echo "▸ Starting n8n + Postgres + Redis..."
docker compose up -d

# ─── Step 7: Wait for healthy ─────────────────────────────────────
echo ""
echo "▸ Waiting for services to be healthy..."
sleep 10

# Check health
if docker compose ps | grep -q "running"; then
  echo "  ✅ Services are running"
else
  echo "  ⚠️  Some services may not be healthy yet. Check with:"
  echo "     cd ${INSTALL_DIR}/docker && docker compose ps"
fi

# ─── Step 8: Create firewall rule (if needed) ─────────────────────
echo ""
echo "▸ Firewall check..."
SPARK_IP=$(hostname -I | awk '{print $1}')
echo "  ℹ️  n8n is running on port 5678"
echo "  ℹ️  Make sure port 5678 is accessible:"
echo "     sudo ufw allow 5678/tcp  (if using ufw)"
echo ""

# ─── Summary ──────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ n8n Installed on DGX Spark!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  n8n UI:      http://${SPARK_IP}:5678"
echo "  Install dir: ${INSTALL_DIR}"
echo "  Compose:     ${INSTALL_DIR}/docker/"
echo "  Data:        ${INSTALL_DIR}/data/"
echo ""
echo "  Login credentials (from .env):"
grep "N8N_USER\|N8N_PASSWORD" "${ENV_FILE}" | sed 's/^/    /'
echo ""
echo "  ──────────────────────────────────────────────────────"
echo "  Next steps:"
echo "  1. Open n8n at http://${SPARK_IP}:5678"
echo "  2. Import workflows from n8n-workflows/*.json"
echo "  3. Configure Gmail OAuth credentials in n8n"
echo "  4. Configure Telegram bot credentials in n8n"
echo "  5. Update GCP Cloud Function env vars with this URL"
echo "  6. For production: set up Cloudflare Tunnel or SSL"
echo "  ──────────────────────────────────────────────────────"
echo ""
echo "  Useful commands:"
echo "    cd ${INSTALL_DIR}/docker"
echo "    docker compose ps          # check status"
echo "    docker compose logs -f n8n # view logs"
echo "    docker compose restart     # restart all"
echo "    docker compose down        # stop all"
echo ""
