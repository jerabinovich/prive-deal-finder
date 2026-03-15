#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[deploy] repo: $REPO_ROOT"

if [[ ! -f "$REPO_ROOT/apps/api/.env" ]]; then
  echo "[error] Missing apps/api/.env"
  exit 1
fi

if [[ ! -f "$REPO_ROOT/apps/web/.env" ]]; then
  echo "[error] Missing apps/web/.env"
  exit 1
fi

echo "[1/7] Install dependencies"
npm install

echo "[2/7] Prepare database (Prisma generate + migrate deploy)"
npm run db:prepare -w @prive/api

echo "[3/7] Build web + api"
npm run build

echo "[4/7] Configure user systemd services"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$SYSTEMD_USER_DIR"

cat > "$SYSTEMD_USER_DIR/prive-api.service" <<EOF
[Unit]
Description=Prive Deal Finder API
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT/apps/api
Environment=NODE_ENV=production
ExecStart=/usr/bin/env npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

cat > "$SYSTEMD_USER_DIR/prive-web.service" <<EOF
[Unit]
Description=Prive Deal Finder Web
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT/apps/web
Environment=NODE_ENV=production
ExecStart=/usr/bin/env npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now prive-api.service
systemctl --user enable --now prive-web.service
systemctl --user restart prive-api.service
systemctl --user restart prive-web.service

echo "[5/7] Ensure PostgreSQL container"
if command -v docker >/dev/null 2>&1; then
  POSTGRES_DB="prive_deal_finder"
  POSTGRES_USER="prive"
  POSTGRES_PASSWORD="prive_stage_2026"

  if [[ -f "$REPO_ROOT/.env.postgres.staging" ]]; then
    # shellcheck disable=SC1091
    source "$REPO_ROOT/.env.postgres.staging"
    POSTGRES_DB="${POSTGRES_DB:-prive_deal_finder}"
    POSTGRES_USER="${POSTGRES_USER:-prive}"
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-prive_stage_2026}"
  fi

  if docker ps -a --format '{{.Names}}' | grep -Fxq "prive-postgres"; then
    docker start prive-postgres >/dev/null || true
  else
    docker run -d \
      --name prive-postgres \
      --restart unless-stopped \
      -e POSTGRES_DB="$POSTGRES_DB" \
      -e POSTGRES_USER="$POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      -p 5432:5432 \
      postgres:16-alpine >/dev/null
  fi
else
  echo "[warn] docker not found; skipping PostgreSQL container"
fi

echo "[6/7] Ensure Caddy reverse proxy (optional)"
if command -v docker >/dev/null 2>&1 && [[ -f "$REPO_ROOT/deploy/caddy/Caddyfile" ]]; then
  if docker ps -a --format '{{.Names}}' | grep -Fxq "prive-caddy"; then
    docker start prive-caddy >/dev/null || true
  else
    docker run -d \
      --name prive-caddy \
      --restart unless-stopped \
      --network host \
      -v "$REPO_ROOT/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
      caddy:2 >/dev/null
  fi
else
  echo "[warn] Caddyfile missing or docker unavailable; skipping Caddy container"
fi

echo "[7/7] Health checks"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:4000/api/health" >/dev/null; then
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "[error] API healthcheck failed after waiting for startup"
    exit 1
  fi
  sleep 2
done
echo "[ok] API healthcheck passed"

if command -v ss >/dev/null 2>&1; then
  echo "[info] Listening ports (3000/4000/5432):"
  ss -ltnp | grep -E ':(3000|4000|5432)\b' || true
fi

echo "[done] deploy:staging completed"
