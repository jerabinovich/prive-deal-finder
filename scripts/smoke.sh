#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:4000/api}"
SMOKE_EMAIL="${SMOKE_EMAIL:-admin@privegroup.com}"
SERVICE_ID_TOKEN="${CLOUD_RUN_ID_TOKEN:-}"

log() {
  printf '\n[smoke] %s\n' "$1"
}

extract_json_field() {
  local json="$1"
  local field="$2"
  node -e "const data = JSON.parse(process.argv[1]); const value = data[process.argv[2]]; process.stdout.write(value ? String(value) : '');" "$json" "$field"
}

extract_json_path() {
  local json="$1"
  local path="$2"
  node -e "const data = JSON.parse(process.argv[1]); const value = process.argv[2].split('.').reduce((acc, key) => acc && acc[key], data); process.stdout.write(value ? String(value) : '');" "$json" "$path"
}

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local auth="${4:-}"
  local -a request_headers=()

  if [ -n "$SERVICE_ID_TOKEN" ]; then
    request_headers+=("-H" "X-Serverless-Authorization: Bearer $SERVICE_ID_TOKEN")
  fi

  if [ -n "$body" ]; then
    if [ -n "$auth" ]; then
      if [ -n "$SERVICE_ID_TOKEN" ]; then
        curl -sS -X "$method" "$url" "${request_headers[@]}" -H "Authorization: Bearer $auth" -H 'Content-Type: application/json' -d "$body"
      else
        curl -sS -X "$method" "$url" -H "Authorization: Bearer $auth" -H 'Content-Type: application/json' -d "$body"
      fi
    else
      if [ -n "$SERVICE_ID_TOKEN" ]; then
        curl -sS -X "$method" "$url" "${request_headers[@]}" -H 'Content-Type: application/json' -d "$body"
      else
        curl -sS -X "$method" "$url" -H 'Content-Type: application/json' -d "$body"
      fi
    fi
  else
    if [ -n "$auth" ]; then
      if [ -n "$SERVICE_ID_TOKEN" ]; then
        curl -sS -X "$method" "$url" "${request_headers[@]}" -H "Authorization: Bearer $auth"
      else
        curl -sS -X "$method" "$url" -H "Authorization: Bearer $auth"
      fi
    else
      if [ -n "$SERVICE_ID_TOKEN" ]; then
        curl -sS -X "$method" "$url" "${request_headers[@]}"
      else
        curl -sS -X "$method" "$url"
      fi
    fi
  fi
}

request_binary() {
  local url="$1"
  local auth="${2:-}"
  local -a request_headers=()

  if [ -n "$SERVICE_ID_TOKEN" ]; then
    request_headers+=("-H" "X-Serverless-Authorization: Bearer $SERVICE_ID_TOKEN")
  fi

  if [ -n "$SERVICE_ID_TOKEN" ]; then
    curl -sS -X GET "$url" "${request_headers[@]}" -H "Authorization: Bearer $auth" >/dev/null
  else
    curl -sS -X GET "$url" -H "Authorization: Bearer $auth" >/dev/null
  fi
}

if [[ "$API_BASE" == https://*.a.run.app/* ]] && [ -z "$SERVICE_ID_TOKEN" ] && command -v gcloud >/dev/null 2>&1; then
  SERVICE_AUDIENCE="$(printf '%s' "$API_BASE" | sed -E 's#(https://[^/]+).*#\1#')"
  SERVICE_ID_TOKEN="$(gcloud auth print-identity-token --audiences="$SERVICE_AUDIENCE" 2>/dev/null || true)"
  if [ -z "$SERVICE_ID_TOKEN" ]; then
    SERVICE_ID_TOKEN="$(gcloud auth print-identity-token 2>/dev/null || true)"
  fi
  if [ -n "$SERVICE_ID_TOKEN" ]; then
    log "Using Cloud Run identity token ($SERVICE_AUDIENCE)"
  fi
fi

log "Health check"
request_json GET "$API_BASE/health" >/dev/null

log "Login"
LOGIN_RESPONSE="$(request_json POST "$API_BASE/auth/login" "{\"email\":\"$SMOKE_EMAIL\"}")"
ACCESS_TOKEN="$(extract_json_field "$LOGIN_RESPONSE" "accessToken")"
REFRESH_TOKEN="$(extract_json_field "$LOGIN_RESPONSE" "refreshToken")"
USER_ROLE="$(extract_json_path "$LOGIN_RESPONSE" "user.role")"

if [ -z "$ACCESS_TOKEN" ] || [ -z "$REFRESH_TOKEN" ]; then
  echo "Smoke failed: login did not return tokens"
  exit 1
fi

if [ "$USER_ROLE" != "ADMIN" ]; then
  echo "Smoke failed: $SMOKE_EMAIL is role '$USER_ROLE' (required ADMIN for sync endpoints)."
  echo "Set AUTH_ADMIN_EMAILS to include this email, then retry."
  exit 1
fi

log "Auth /me"
request_json GET "$API_BASE/auth/me" "" "$ACCESS_TOKEN" >/dev/null

log "Auth refresh"
request_json POST "$API_BASE/auth/refresh" "{\"refreshToken\":\"$REFRESH_TOKEN\"}" >/dev/null

log "Integrations status"
request_json GET "$API_BASE/integrations/status" "" "$ACCESS_TOKEN" >/dev/null

log "Sync mdpa"
request_json POST "$API_BASE/integrations/mdpa/import" '{"datasetType":"MUNICIPAL_ROLLS","confirmPaidDataUse":true}' "$ACCESS_TOKEN" >/dev/null

log "Sync miami-dade-parcels"
request_json POST "$API_BASE/integrations/miami-dade-parcels/sync" "" "$ACCESS_TOKEN" >/dev/null

log "Sync broward-parcels"
request_json POST "$API_BASE/integrations/broward-parcels/sync" "" "$ACCESS_TOKEN" >/dev/null

log "Sync palm-beach-parcels"
request_json POST "$API_BASE/integrations/palm-beach-parcels/sync" "" "$ACCESS_TOKEN" >/dev/null

log "Reports"
request_json GET "$API_BASE/reports/pipeline" "" "$ACCESS_TOKEN" >/dev/null
request_binary "$API_BASE/reports/pipeline.csv" "$ACCESS_TOKEN"
request_binary "$API_BASE/reports/pipeline.pdf" "$ACCESS_TOKEN"

log "Deal overview + recompute"
DEALS_RESPONSE="$(request_json GET "$API_BASE/deals?limit=1&offset=0" "" "$ACCESS_TOKEN")"
DEAL_ID="$(node -e "const d=JSON.parse(process.argv[1]); const id = d?.items?.[0]?.id || ''; process.stdout.write(id);" "$DEALS_RESPONSE")"
if [ -z "$DEAL_ID" ]; then
  echo "Smoke failed: no deals available after sync"
  exit 1
fi
request_json GET "$API_BASE/deals/$DEAL_ID/overview" "" "$ACCESS_TOKEN" >/dev/null
request_json POST "$API_BASE/deals/$DEAL_ID/recompute-comps" "" "$ACCESS_TOKEN" >/dev/null
request_json POST "$API_BASE/deals/$DEAL_ID/recompute-insights" "" "$ACCESS_TOKEN" >/dev/null
request_json GET "$API_BASE/deals/$DEAL_ID/opportunity-summary" "" "$ACCESS_TOKEN" >/dev/null
request_json GET "$API_BASE/deals?classification=TRUE_OPPORTUNITY&limit=5&offset=0" "" "$ACCESS_TOKEN" >/dev/null
request_json POST "$API_BASE/deals/recompute-triage" '{"limit":10}' "$ACCESS_TOKEN" >/dev/null
request_json GET "$API_BASE/deals?lane=OFF_MARKET_STANDARD&limit=5&offset=0" "" "$ACCESS_TOKEN" >/dev/null
request_json POST "$API_BASE/deals/backfill-facts" '{"limit":5,"onlyMissingFacts":true,"recomputeComparables":true,"recomputeInsights":true}' "$ACCESS_TOKEN" >/dev/null

log "Chat decision response"
CHAT_RESPONSE="$(request_json POST "$API_BASE/chat/query" "{\"question\":\"por que esto es un deal\",\"dealId\":\"$DEAL_ID\"}" "$ACCESS_TOKEN")"
CHAT_HAS_THESIS="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write((typeof d.thesis==='string'&&d.thesis.trim().length>0)?'yes':'no');" "$CHAT_RESPONSE")"
CHAT_HAS_ACTION="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write((typeof d.nextAction==='string'&&d.nextAction.trim().length>0)?'yes':'no');" "$CHAT_RESPONSE")"
CHAT_HAS_LANE="$(node -e "const d=JSON.parse(process.argv[1]); process.stdout.write((typeof d.lane==='string'&&d.lane.trim().length>0)?'yes':'no');" "$CHAT_RESPONSE")"
if [ "$CHAT_HAS_THESIS" != "yes" ] || [ "$CHAT_HAS_ACTION" != "yes" ] || [ "$CHAT_HAS_LANE" != "yes" ]; then
  echo "Smoke failed: chat response missing thesis/nextAction/lane"
  exit 1
fi

log "Logout"
request_json POST "$API_BASE/auth/logout" "{\"refreshToken\":\"$REFRESH_TOKEN\"}" "$ACCESS_TOKEN" >/dev/null

log "Smoke complete"
