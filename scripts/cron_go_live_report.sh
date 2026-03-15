#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="${REPO_ROOT}/docs/ops-reports"
TMP_OUTPUT="$(mktemp)"
TMP_REFRESH="$(mktemp)"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
export PROJECT_ID="${PROJECT_ID:-privegroup-cloud}"
export REGION="${REGION:-us-east1}"

mkdir -p "$REPORT_DIR"

DATE_STAMP="$(date '+%Y-%m-%d')"
DATE_HUMAN="$(date '+%Y-%m-%d %H:%M:%S %Z')"
REPORT_FILE="${REPORT_DIR}/go-live-${DATE_STAMP}.md"
LATEST_FILE="${REPORT_DIR}/LATEST.md"

STATUS="PASS"
if ! node "${REPO_ROOT}/scripts/morning_refresh.js" >"$TMP_REFRESH" 2>&1; then
  STATUS="FAIL"
fi

if ! /bin/bash "${REPO_ROOT}/scripts/go_live_check.sh" >"$TMP_OUTPUT" 2>&1; then
  STATUS="FAIL"
fi

{
  echo "# Go-Live Automated Report"
  echo
  echo "- Date: ${DATE_HUMAN}"
  echo "- Host: $(hostname)"
  echo "- Status: **${STATUS}**"
  echo "- Project: \`${PROJECT_ID}\`"
  echo "- Region: \`${REGION}\`"
  echo
  echo "## Command"
  echo
  echo '```bash'
  echo "PROJECT_ID=${PROJECT_ID} REGION=${REGION} node scripts/morning_refresh.js"
  echo "PROJECT_ID=${PROJECT_ID} REGION=${REGION} npm run go-live:check"
  echo '```'
  echo
  echo "## Morning Refresh Output"
  echo
  echo '```text'
  cat "$TMP_REFRESH"
  echo '```'
  echo
  echo "## Go-Live Check Output"
  echo
  echo '```text'
  cat "$TMP_OUTPUT"
  echo '```'
} >"$REPORT_FILE"

cp "$REPORT_FILE" "$LATEST_FILE"
rm -f "$TMP_OUTPUT"
rm -f "$TMP_REFRESH"

if [ "$STATUS" = "FAIL" ]; then
  exit 1
fi
