#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-privegroup-cloud}"
REGION="${REGION:-us-east1}"
API_SERVICE="${API_SERVICE:-prive-deal-finder-api}"
WEB_SERVICE="${WEB_SERVICE:-prive-deal-finder-web}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[error] gcloud is required"
  exit 1
fi

export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
ID_TOKEN="$(gcloud auth print-identity-token 2>/dev/null || true)"

API_URL="$(gcloud run services describe "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"
WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"

echo "PROJECT_ID=$PROJECT_ID"
echo "REGION=$REGION"
echo "API_SERVICE=$API_SERVICE"
echo "WEB_SERVICE=$WEB_SERVICE"
echo "API_URL=${API_URL:-<missing>}"
echo "WEB_URL=${WEB_URL:-<missing>}"
echo

echo "== Cloud Run services =="
gcloud run services list --project "$PROJECT_ID" --region "$REGION" --format='table(metadata.name,status.url,status.conditions[0].status,metadata.generation,status.latestReadyRevisionName)'
echo

if [[ -n "$API_URL" ]]; then
  echo "== API health =="
  if [[ -n "$ID_TOKEN" ]]; then
    curl -sS -i -H "Authorization: Bearer ${ID_TOKEN}" "${API_URL}/api/health" | sed -n '1,14p'
  else
    curl -sS -i "${API_URL}/api/health" | sed -n '1,14p'
  fi
  echo
  echo "== Google OAuth status =="
  if [[ -n "$ID_TOKEN" ]]; then
    curl -sS -H "Authorization: Bearer ${ID_TOKEN}" "${API_URL}/api/auth/google/status"
  else
    curl -sS "${API_URL}/api/auth/google/status"
  fi
  echo
fi

if [[ -n "$WEB_URL" ]]; then
  echo "== Web status =="
  if [[ -n "$ID_TOKEN" ]]; then
    curl -sS -i -H "Authorization: Bearer ${ID_TOKEN}" "${WEB_URL}" | sed -n '1,14p'
  else
    curl -sS -i "${WEB_URL}" | sed -n '1,14p'
  fi
fi
