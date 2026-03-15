#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRON_SCRIPT="${REPO_ROOT}/scripts/cron_go_live_report.sh"
LOG_FILE="${REPO_ROOT}/docs/ops-reports/cron.log"
SCHEDULE="${SCHEDULE:-0 8 * * *}"

mkdir -p "$(dirname "$LOG_FILE")"

CRON_CMD="/bin/bash \"${CRON_SCRIPT}\" >> \"${LOG_FILE}\" 2>&1"
CRON_LINE="${SCHEDULE} ${CRON_CMD}"

TMP_CRON="$(mktemp)"
trap 'rm -f "$TMP_CRON"' EXIT

if crontab -l >/dev/null 2>&1; then
  crontab -l | grep -v "cron_go_live_report.sh" > "$TMP_CRON" || true
fi

echo "$CRON_LINE" >> "$TMP_CRON"
crontab "$TMP_CRON"

echo "[cron] installed:"
echo "$CRON_LINE"
