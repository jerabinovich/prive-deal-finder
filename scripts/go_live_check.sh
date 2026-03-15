#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="${PROJECT_ID:-privegroup-cloud}"
REGION="${REGION:-us-east1}"
API_SERVICE="${API_SERVICE:-prive-deal-finder-api}"
SMOKE_EMAIL="${SMOKE_EMAIL:-admin@privegroup.com}"
UX_TEST_EMAIL="${UX_TEST_EMAIL:-$SMOKE_EMAIL}"

echo "[go-live] project=${PROJECT_ID} region=${REGION} api_service=${API_SERVICE}"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"

echo "[1/5] Cloud Run status"
PROJECT_ID="$PROJECT_ID" REGION="$REGION" npm run cloudrun:status >/dev/null

API_URL="$(gcloud run services describe "$API_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
if [ -z "$API_URL" ]; then
  echo "[go-live] ERROR: could not resolve API URL"
  exit 1
fi
API_BASE="${API_URL}/api"

ID_TOKEN="$(gcloud auth print-identity-token --audiences="$API_URL" 2>/dev/null || true)"
if [ -z "$ID_TOKEN" ]; then
  ID_TOKEN="$(gcloud auth print-identity-token 2>/dev/null || true)"
fi

auth_header=()
if [ -n "$ID_TOKEN" ]; then
  auth_header=(-H "X-Serverless-Authorization: Bearer $ID_TOKEN")
fi

echo "[2/5] OAuth status"
OAUTH_STATUS="$(curl -sS "${auth_header[@]}" "${API_BASE}/auth/google/status")"
echo "[go-live] oauth_status=${OAUTH_STATUS}"

echo "[3/5] API smoke"
API_BASE="$API_BASE" SMOKE_EMAIL="$SMOKE_EMAIL" CLOUD_RUN_ID_TOKEN="$ID_TOKEN" npm run smoke >/dev/null
echo "[go-live] smoke=PASS"

echo "[4/5] UX smoke"
WEB_URL="${WEB_URL:-}" UX_TEST_EMAIL="$UX_TEST_EMAIL" npm run test:ux >/dev/null
echo "[go-live] ux=PASS"

echo "[5/5] Content quality check"
LOGIN_RESPONSE="$(curl -sS "${auth_header[@]}" -X POST "${API_BASE}/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"${SMOKE_EMAIL}\"}")"
ACCESS_TOKEN="$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(d.accessToken||'')" "$LOGIN_RESPONSE")"
if [ -z "$ACCESS_TOKEN" ]; then
  echo "[go-live] ERROR: login did not return access token"
  exit 1
fi

DEALS_RESPONSE="$(curl -sS "${auth_header[@]}" "${API_BASE}/deals?limit=200&offset=0" -H "Authorization: Bearer ${ACCESS_TOKEN}")"

FIRST_DEAL_ID="$(node -e 'const payload = JSON.parse(process.argv[1]); const id = payload?.items?.[0]?.id || ""; process.stdout.write(id);' "$DEALS_RESPONSE")"
if [ -z "$FIRST_DEAL_ID" ]; then
  echo "[go-live] ERROR: no deals available"
  exit 1
fi

curl -sS "${auth_header[@]}" "${API_BASE}/deals/${FIRST_DEAL_ID}/overview" -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null
curl -sS -X POST "${auth_header[@]}" "${API_BASE}/deals/${FIRST_DEAL_ID}/recompute-comps" -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null
curl -sS -X POST "${auth_header[@]}" "${API_BASE}/deals/${FIRST_DEAL_ID}/recompute-insights" -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null
curl -sS -X POST "${auth_header[@]}" "${API_BASE}/deals/backfill-facts" -H "Authorization: Bearer ${ACCESS_TOKEN}" -H 'Content-Type: application/json' -d '{"limit":20,"onlyMissingFacts":true,"recomputeComparables":true,"recomputeInsights":true}' >/dev/null

SUMMARY="$(node -e '
  const payload = JSON.parse(process.argv[1]);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const total = Number(payload.total || items.length || 0);
  const withAddress = items.filter((d) => typeof d.address === "string" && d.address.trim()).length;
  const withAssetType = items.filter((d) => typeof d.assetType === "string" && d.assetType.trim()).length;
  const withLot = items.filter((d) => typeof d.lotSizeSqft === "number" && Number.isFinite(d.lotSizeSqft) && d.lotSizeSqft > 0).length;
  const withBldg = items.filter((d) => typeof d.buildingSizeSqft === "number" && Number.isFinite(d.buildingSizeSqft) && d.buildingSizeSqft > 0).length;
  const withYear = items.filter((d) => typeof d.yearBuilt === "number" && Number.isFinite(d.yearBuilt) && d.yearBuilt > 1800).length;
  const withPrice = items.filter((d) => typeof d.askingPrice === "number" && Number.isFinite(d.askingPrice) && d.askingPrice >= 1000).length;
  const markets = [...new Set(items.map((d) => d.market).filter(Boolean))];
  if (total <= 0) {
    console.error("NO_DEALS");
    process.exit(2);
  }
  if (withAddress <= 0) {
    console.error("NO_ADDRESSES");
    process.exit(3);
  }
  process.stdout.write(JSON.stringify({ total, withAddress, withAssetType, withLot, withBldg, withYear, withPrice, markets }, null, 2));
' "$DEALS_RESPONSE")"

echo "$SUMMARY"
CLASSIFICATION_SUMMARY="$(node -e '
  const payload = JSON.parse(process.argv[1]);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const counts = items.reduce((acc, item) => {
    const key = item.classification || "PIPELINE_LISTING";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  process.stdout.write(JSON.stringify(counts));
' "$DEALS_RESPONSE")"
echo "[go-live] classifications=${CLASSIFICATION_SUMMARY}"
LANE_SUMMARY="$(node -e '
  const payload = JSON.parse(process.argv[1]);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const counts = items.reduce((acc, item) => {
    const key = item.lane || "RESEARCH_REQUIRED";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  process.stdout.write(JSON.stringify(counts));
' "$DEALS_RESPONSE")"
echo "[go-live] lanes=${LANE_SUMMARY}"
CHAT_RESPONSE="$(curl -sS "${auth_header[@]}" -X POST "${API_BASE}/chat/query" -H "Authorization: Bearer ${ACCESS_TOKEN}" -H 'Content-Type: application/json' -d '{"question":"show top opportunities by market","market":"Palm Beach"}')"
CHAT_OK="$(node -e '
  const payload = JSON.parse(process.argv[1]);
  const hasAnswer = typeof payload.answer === "string" && payload.answer.trim().length > 0;
  const hasThesis = typeof payload.thesis === "string" && payload.thesis.trim().length > 0;
  const hasNextAction = typeof payload.nextAction === "string" && payload.nextAction.trim().length > 0;
  const hasLane = typeof payload.lane === "string" && payload.lane.trim().length > 0;
  const citations = Array.isArray(payload.citations) ? payload.citations.length : 0;
  if (!hasAnswer || citations <= 0 || !hasThesis || !hasNextAction || !hasLane) {
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({ confidence: payload.confidence || "unknown", citations, actions: Array.isArray(payload.suggestedActions) ? payload.suggestedActions.length : 0, intent: payload.intent || "unknown", lane: payload.lane || "unknown" }));
' "$CHAT_RESPONSE" || true)"
if [ -z "$CHAT_OK" ]; then
  echo "[go-live] ERROR: chat check failed"
  exit 1
fi
echo "[go-live] chat=${CHAT_OK}"
echo "[go-live] PASS"
