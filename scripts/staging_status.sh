#!/usr/bin/env bash
set -euo pipefail

STAGING_HOST="${STAGING_HOST:-100.112.25.118}"

echo "== systemd user services =="
systemctl --user --no-pager --full status prive-api.service prive-web.service | sed -n '1,80p' || true

echo
echo "== containers =="
if command -v docker >/dev/null 2>&1; then
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
else
  echo "docker not installed"
fi

echo
echo "== listening ports (3000/4000/5432) =="
if command -v ss >/dev/null 2>&1; then
  ss -ltnp | grep -E ':(3000|4000|5432)\b' || true
else
  echo "ss not installed"
fi

echo
echo "== healthchecks =="
echo "[local] http://127.0.0.1:4000/api/health"
curl -sS -i "http://127.0.0.1:4000/api/health" | sed -n '1,20p'

echo
echo "[tls] https://${STAGING_HOST}/api/health"
curl -k -sS -i "https://${STAGING_HOST}/api/health" | sed -n '1,20p'
