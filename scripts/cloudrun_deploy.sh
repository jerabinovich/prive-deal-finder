#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="${PROJECT_ID:-privegroup-cloud}"
REGION="${REGION:-us-east1}"
AR_REPOSITORY="${AR_REPOSITORY:-prive-deal-finder}"
API_SERVICE="${API_SERVICE:-prive-deal-finder-api}"
WEB_SERVICE="${WEB_SERVICE:-prive-deal-finder-web}"
MIGRATE_JOB="${MIGRATE_JOB:-prive-deal-finder-migrate}"
DB_INSTANCE="${DB_INSTANCE:-prive-deal-finder-db}"
DB_NAME="${DB_NAME:-prive_deal_finder}"
DB_USER="${DB_USER:-prive}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_TIER="${DB_TIER:-db-custom-1-3840}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-false}"
DISABLE_INVOKER_IAM_CHECK="${DISABLE_INVOKER_IAM_CHECK:-true}"

API_ENV_FILE="apps/api/.env"
WEB_ENV_FILE="apps/web/.env"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[error] Missing command: $1"
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "[error] Missing file: $1"
    exit 1
  fi
}

env_get() {
  local key="$1"
  local file="$2"
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- || true
}

yaml_quote() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

require_cmd gcloud
require_cmd openssl
require_cmd node
require_file "$API_ENV_FILE"
require_file "$WEB_ENV_FILE"

url_encode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "[error] No active gcloud account. Run: gcloud auth login"
  exit 1
fi

export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
echo "[info] project=$PROJECT_ID region=$REGION"

if [[ "$ALLOW_UNAUTHENTICATED" == "true" ]]; then
  RUN_AUTH_FLAG="--allow-unauthenticated"
else
  RUN_AUTH_FLAG="--no-allow-unauthenticated"
fi

if [[ "$DISABLE_INVOKER_IAM_CHECK" == "true" ]]; then
  RUN_INVOKER_FLAG="--no-invoker-iam-check"
else
  RUN_INVOKER_FLAG="--invoker-iam-check"
fi

echo "[1/9] Enable required Google APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  iamcredentials.googleapis.com \
  secretmanager.googleapis.com >/dev/null

echo "[2/9] Ensure Artifact Registry repository"
if ! gcloud artifacts repositories describe "$AR_REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Prive Deal Finder images" >/dev/null
fi

echo "[3/9] Ensure Cloud SQL instance/database/user"
if ! gcloud sql instances describe "$DB_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$DB_INSTANCE" \
    --database-version=POSTGRES_15 \
    --tier="$DB_TIER" \
    --region="$REGION" \
    --storage-size=10 \
    --availability-type=ZONAL >/dev/null
fi

if ! gcloud sql databases describe "$DB_NAME" --instance="$DB_INSTANCE" >/dev/null 2>&1; then
  gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE" >/dev/null
fi

EXISTING_DATABASE_URL="$(
  gcloud run services describe "$API_SERVICE" --region "$REGION" --format=json 2>/dev/null \
    | node -e '
      let raw = "";
      process.stdin.on("data", (d) => { raw += d; });
      process.stdin.on("end", () => {
        try {
          const payload = JSON.parse(raw);
          const env = payload?.spec?.template?.spec?.containers?.[0]?.env || [];
          const row = env.find((item) => item?.name === "DATABASE_URL");
          process.stdout.write(row?.value || "");
        } catch (_error) {
          process.stdout.write("");
        }
      });
    '
)"

EXISTING_API_ENV_JSON="$(
  gcloud run services describe "$API_SERVICE" --region "$REGION" --format=json 2>/dev/null || true
)"

EXISTING_API_ANN_JSON="$(
  gcloud run services describe "$API_SERVICE" --region "$REGION" --format=json 2>/dev/null || true
)"

existing_api_ann_get() {
  local key="$1"
  if [[ -z "$EXISTING_API_ANN_JSON" ]]; then
    return 0
  fi
  printf '%s' "$EXISTING_API_ANN_JSON" | node -e '
    const key = process.argv[1];
    let raw = "";
    process.stdin.on("data", (d) => { raw += d; });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(raw);
        const ann = payload?.spec?.template?.metadata?.annotations || {};
        process.stdout.write(ann[key] || "");
      } catch (_error) {
        process.stdout.write("");
      }
    });
  ' "$key"
}

existing_api_env_get() {
  local key="$1"
  if [[ -z "$EXISTING_API_ENV_JSON" ]]; then
    return 0
  fi
  printf '%s' "$EXISTING_API_ENV_JSON" | node -e '
    const key = process.argv[1];
    let raw = "";
    process.stdin.on("data", (d) => { raw += d; });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(raw);
        const env = payload?.spec?.template?.spec?.containers?.[0]?.env || [];
        const row = env.find((item) => item?.name === key);
        process.stdout.write(row?.value || "");
      } catch (_error) {
        process.stdout.write("");
      }
    });
  ' "$key"
}

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  OPENAI_API_KEY="$(existing_api_env_get OPENAI_API_KEY)"
fi
if [[ -z "${OPENAI_MODEL:-}" ]]; then
  OPENAI_MODEL="$(existing_api_env_get OPENAI_MODEL)"
fi
if [[ -z "${OPENAI_TIMEOUT_MS:-}" ]]; then
  OPENAI_TIMEOUT_MS="$(existing_api_env_get OPENAI_TIMEOUT_MS)"
fi
if [[ -z "${CHAT_MAX_CONTEXT_DEALS:-}" ]]; then
  CHAT_MAX_CONTEXT_DEALS="$(existing_api_env_get CHAT_MAX_CONTEXT_DEALS)"
fi
if [[ -z "${CHAT_ENABLE:-}" ]]; then
  CHAT_ENABLE="$(existing_api_env_get CHAT_ENABLE)"
fi
if [[ -z "${API_VPC_CONNECTOR:-}" ]]; then
  API_VPC_CONNECTOR="$(existing_api_ann_get run.googleapis.com/vpc-access-connector)"
fi
if [[ -z "${API_VPC_EGRESS:-}" ]]; then
  API_VPC_EGRESS="$(existing_api_ann_get run.googleapis.com/vpc-access-egress)"
fi

API_NETWORK_FLAGS=()
if [[ -n "${API_VPC_CONNECTOR:-}" ]]; then
  API_NETWORK_FLAGS+=(--vpc-connector "$API_VPC_CONNECTOR")
fi
if [[ -n "${API_VPC_EGRESS:-}" ]]; then
  API_NETWORK_FLAGS+=(--vpc-egress "$API_VPC_EGRESS")
fi

EXISTING_WEB_ENV_JSON="$(
  gcloud run services describe "$WEB_SERVICE" --region "$REGION" --format=json 2>/dev/null || true
)"

existing_web_env_get() {
  local key="$1"
  if [[ -z "$EXISTING_WEB_ENV_JSON" ]]; then
    return 0
  fi
  printf '%s' "$EXISTING_WEB_ENV_JSON" | node -e '
    const key = process.argv[1];
    let raw = "";
    process.stdin.on("data", (d) => { raw += d; });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(raw);
        const env = payload?.spec?.template?.spec?.containers?.[0]?.env || [];
        const row = env.find((item) => item?.name === key);
        process.stdout.write(row?.value || "");
      } catch (_error) {
        process.stdout.write("");
      }
    });
  ' "$key"
}

if [[ -z "${NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY:-}" ]]; then
  NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY="$(existing_web_env_get NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY)"
fi
if [[ -z "${NEXT_PUBLIC_CHAT_ENABLE:-}" ]]; then
  NEXT_PUBLIC_CHAT_ENABLE="$(existing_web_env_get NEXT_PUBLIC_CHAT_ENABLE)"
fi

DB_USER_EXISTS="false"
if gcloud sql users list --instance="$DB_INSTANCE" --format='value(name)' | grep -Fxq "$DB_USER"; then
  DB_USER_EXISTS="true"
fi

INSTANCE_CONNECTION_NAME="$(gcloud sql instances describe "$DB_INSTANCE" --format='value(connectionName)')"

if [[ -n "$DB_PASSWORD" ]]; then
  if [[ "$DB_USER_EXISTS" == "true" ]]; then
    gcloud sql users set-password "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD" >/dev/null
  else
    gcloud sql users create "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD" >/dev/null
  fi
  DB_PASSWORD_ENCODED="$(url_encode "$DB_PASSWORD")"
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD_ENCODED}@localhost/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION_NAME}"
elif [[ "$DB_USER_EXISTS" == "true" && -n "$EXISTING_DATABASE_URL" ]]; then
  DATABASE_URL="$EXISTING_DATABASE_URL"
else
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
  if [[ "$DB_USER_EXISTS" == "true" ]]; then
    gcloud sql users set-password "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD" >/dev/null
  else
    gcloud sql users create "$DB_USER" --instance="$DB_INSTANCE" --password="$DB_PASSWORD" >/dev/null
  fi
  DB_PASSWORD_ENCODED="$(url_encode "$DB_PASSWORD")"
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD_ENCODED}@localhost/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION_NAME}"
fi

echo "[4/9] Build container images"
AR_HOST="${REGION}-docker.pkg.dev"
TAG="$(date +%Y%m%d-%H%M%S)"
API_IMAGE="${AR_HOST}/${PROJECT_ID}/${AR_REPOSITORY}/${API_SERVICE}:${TAG}"
WEB_IMAGE="${AR_HOST}/${PROJECT_ID}/${AR_REPOSITORY}/${WEB_SERVICE}:${TAG}"

API_CLOUD_BUILD_CFG="$(mktemp)"
cat > "$API_CLOUD_BUILD_CFG" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-f', 'apps/api/Dockerfile', '-t', '${API_IMAGE}', '.']
images:
  - '${API_IMAGE}'
EOF
gcloud builds submit --config "$API_CLOUD_BUILD_CFG" . >/dev/null
rm -f "$API_CLOUD_BUILD_CFG"

WEB_CLOUD_BUILD_CFG="$(mktemp)"
cat > "$WEB_CLOUD_BUILD_CFG" <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-f', 'apps/web/Dockerfile', '-t', '${WEB_IMAGE}', '.']
images:
  - '${WEB_IMAGE}'
EOF
gcloud builds submit --config "$WEB_CLOUD_BUILD_CFG" . >/dev/null
rm -f "$WEB_CLOUD_BUILD_CFG"

JWT_SECRET="$(env_get JWT_SECRET "$API_ENV_FILE")"
JWT_EXPIRES_IN="$(env_get JWT_EXPIRES_IN "$API_ENV_FILE")"
JWT_REFRESH_SECRET="$(env_get JWT_REFRESH_SECRET "$API_ENV_FILE")"
JWT_REFRESH_EXPIRES_IN="$(env_get JWT_REFRESH_EXPIRES_IN "$API_ENV_FILE")"
AUTH_ADMIN_EMAILS="$(env_get AUTH_ADMIN_EMAILS "$API_ENV_FILE")"
GOOGLE_OAUTH_CLIENT_ID="$(env_get GOOGLE_OAUTH_CLIENT_ID "$API_ENV_FILE")"
GOOGLE_OAUTH_CLIENT_SECRET="$(env_get GOOGLE_OAUTH_CLIENT_SECRET "$API_ENV_FILE")"
MDPA_BULK_FILE_PATH="$(env_get MDPA_BULK_FILE_PATH "$API_ENV_FILE")"
MDPA_SOURCE_URL="$(env_get MDPA_SOURCE_URL "$API_ENV_FILE")"
MDPA_MAX_ROWS="$(env_get MDPA_MAX_ROWS "$API_ENV_FILE")"
MDPA_REQUIRE_CONFIRMATION="$(env_get MDPA_REQUIRE_CONFIRMATION "$API_ENV_FILE")"
MDPA_ESTIMATED_CREDITS="$(env_get MDPA_ESTIMATED_CREDITS "$API_ENV_FILE")"
ARCGIS_MAX_ROWS="$(env_get ARCGIS_MAX_ROWS "$API_ENV_FILE")"
MIAMI_DADE_PARCELS_URL="$(env_get MIAMI_DADE_PARCELS_URL "$API_ENV_FILE")"
MIAMI_DADE_FORECLOSURE_URL="$(env_get MIAMI_DADE_FORECLOSURE_URL "$API_ENV_FILE")"
MIAMI_DADE_FORECLOSURE_API_KEY="$(env_get MIAMI_DADE_FORECLOSURE_API_KEY "$API_ENV_FILE")"
MIAMI_DADE_FORECLOSURE_MAX_FOLIOS="$(env_get MIAMI_DADE_FORECLOSURE_MAX_FOLIOS "$API_ENV_FILE")"
BROWARD_FORECLOSURE_URL="$(env_get BROWARD_FORECLOSURE_URL "$API_ENV_FILE")"
BROWARD_FORECLOSURE_API_KEY="$(env_get BROWARD_FORECLOSURE_API_KEY "$API_ENV_FILE")"
BROWARD_FORECLOSURE_CASE_TYPES="$(env_get BROWARD_FORECLOSURE_CASE_TYPES "$API_ENV_FILE")"
BROWARD_FORECLOSURE_COURT_TYPE="$(env_get BROWARD_FORECLOSURE_COURT_TYPE "$API_ENV_FILE")"
BROWARD_FORECLOSURE_DATE_TO_USE="$(env_get BROWARD_FORECLOSURE_DATE_TO_USE "$API_ENV_FILE")"
BROWARD_FORECLOSURE_LOOKBACK_DAYS="$(env_get BROWARD_FORECLOSURE_LOOKBACK_DAYS "$API_ENV_FILE")"
BROWARD_FORECLOSURE_MAX_REQUESTS="$(env_get BROWARD_FORECLOSURE_MAX_REQUESTS "$API_ENV_FILE")"
BROWARD_FORECLOSURE_MAX_CASES="$(env_get BROWARD_FORECLOSURE_MAX_CASES "$API_ENV_FILE")"
BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION="$(env_get BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION "$API_ENV_FILE")"
BROWARD_FORECLOSURE_ESTIMATED_CREDITS="$(env_get BROWARD_FORECLOSURE_ESTIMATED_CREDITS "$API_ENV_FILE")"
BROWARD_PARCELS_URL="$(env_get BROWARD_PARCELS_URL "$API_ENV_FILE")"
PALM_BEACH_PARCELS_URL="$(env_get PALM_BEACH_PARCELS_URL "$API_ENV_FILE")"
GEOCODING_PROVIDER="$(env_get GEOCODING_PROVIDER "$API_ENV_FILE")"
GEOCODING_API_KEY="$(env_get GEOCODING_API_KEY "$API_ENV_FILE")"
TWILIO_ACCOUNT_SID="$(env_get TWILIO_ACCOUNT_SID "$API_ENV_FILE")"
TWILIO_AUTH_TOKEN="$(env_get TWILIO_AUTH_TOKEN "$API_ENV_FILE")"
TWILIO_FROM_NUMBER="$(env_get TWILIO_FROM_NUMBER "$API_ENV_FILE")"
CHAT_ENABLE="$(env_get CHAT_ENABLE "$API_ENV_FILE")"
CHAT_MAX_CONTEXT_DEALS="$(env_get CHAT_MAX_CONTEXT_DEALS "$API_ENV_FILE")"
OPENAI_API_KEY="$(env_get OPENAI_API_KEY "$API_ENV_FILE")"
OPENAI_MODEL="$(env_get OPENAI_MODEL "$API_ENV_FILE")"
OPENAI_TIMEOUT_MS="$(env_get OPENAI_TIMEOUT_MS "$API_ENV_FILE")"

preserve_existing_api_env_if_empty() {
  local key="$1"
  local value="$2"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return 0
  fi
  existing_api_env_get "$key"
}

MDPA_SOURCE_URL="$(preserve_existing_api_env_if_empty MDPA_SOURCE_URL "$MDPA_SOURCE_URL")"
MIAMI_DADE_FORECLOSURE_URL="$(preserve_existing_api_env_if_empty MIAMI_DADE_FORECLOSURE_URL "$MIAMI_DADE_FORECLOSURE_URL")"
MIAMI_DADE_FORECLOSURE_API_KEY="$(preserve_existing_api_env_if_empty MIAMI_DADE_FORECLOSURE_API_KEY "$MIAMI_DADE_FORECLOSURE_API_KEY")"
BROWARD_FORECLOSURE_URL="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_URL "$BROWARD_FORECLOSURE_URL")"
BROWARD_FORECLOSURE_API_KEY="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_API_KEY "$BROWARD_FORECLOSURE_API_KEY")"
BROWARD_FORECLOSURE_CASE_TYPES="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_CASE_TYPES "$BROWARD_FORECLOSURE_CASE_TYPES")"
BROWARD_FORECLOSURE_COURT_TYPE="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_COURT_TYPE "$BROWARD_FORECLOSURE_COURT_TYPE")"
BROWARD_FORECLOSURE_DATE_TO_USE="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_DATE_TO_USE "$BROWARD_FORECLOSURE_DATE_TO_USE")"
BROWARD_FORECLOSURE_LOOKBACK_DAYS="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_LOOKBACK_DAYS "$BROWARD_FORECLOSURE_LOOKBACK_DAYS")"
BROWARD_FORECLOSURE_MAX_REQUESTS="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_MAX_REQUESTS "$BROWARD_FORECLOSURE_MAX_REQUESTS")"
BROWARD_FORECLOSURE_MAX_CASES="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_MAX_CASES "$BROWARD_FORECLOSURE_MAX_CASES")"
BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION "$BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION")"
BROWARD_FORECLOSURE_ESTIMATED_CREDITS="$(preserve_existing_api_env_if_empty BROWARD_FORECLOSURE_ESTIMATED_CREDITS "$BROWARD_FORECLOSURE_ESTIMATED_CREDITS")"
CHAT_ENABLE="$(preserve_existing_api_env_if_empty CHAT_ENABLE "$CHAT_ENABLE")"
CHAT_MAX_CONTEXT_DEALS="$(preserve_existing_api_env_if_empty CHAT_MAX_CONTEXT_DEALS "$CHAT_MAX_CONTEXT_DEALS")"
OPENAI_API_KEY="$(preserve_existing_api_env_if_empty OPENAI_API_KEY "$OPENAI_API_KEY")"
OPENAI_MODEL="$(preserve_existing_api_env_if_empty OPENAI_MODEL "$OPENAI_MODEL")"
OPENAI_TIMEOUT_MS="$(preserve_existing_api_env_if_empty OPENAI_TIMEOUT_MS "$OPENAI_TIMEOUT_MS")"

NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY="$(env_get NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY "$WEB_ENV_FILE")"
NEXT_PUBLIC_CHAT_ENABLE="$(env_get NEXT_PUBLIC_CHAT_ENABLE "$WEB_ENV_FILE")"
if [[ -z "$NEXT_PUBLIC_CHAT_ENABLE" ]]; then
  NEXT_PUBLIC_CHAT_ENABLE="${CHAT_ENABLE:-true}"
fi

TMP_DIR="$(mktemp -d)"
API_ENV_YAML="${TMP_DIR}/api.env.yaml"
WEB_ENV_YAML="${TMP_DIR}/web.env.yaml"

echo "[5/9] First API deploy (bootstrap URL values)"
cat > "$API_ENV_YAML" <<EOF
NODE_ENV: 'production'
DATABASE_URL: $(yaml_quote "$DATABASE_URL")
JWT_SECRET: $(yaml_quote "$JWT_SECRET")
JWT_EXPIRES_IN: $(yaml_quote "${JWT_EXPIRES_IN:-1d}")
JWT_REFRESH_SECRET: $(yaml_quote "$JWT_REFRESH_SECRET")
JWT_REFRESH_EXPIRES_IN: $(yaml_quote "${JWT_REFRESH_EXPIRES_IN:-7d}")
AUTH_ADMIN_EMAILS: $(yaml_quote "$AUTH_ADMIN_EMAILS")
AUTH_COOKIE_SECURE: 'true'
AUTH_COOKIE_SAME_SITE: 'none'
WEB_APP_URL: 'https://example.com'
GOOGLE_OAUTH_CLIENT_ID: $(yaml_quote "$GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET: $(yaml_quote "$GOOGLE_OAUTH_CLIENT_SECRET")
GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/api/auth/google/callback'
MDPA_BULK_FILE_PATH: $(yaml_quote "$MDPA_BULK_FILE_PATH")
MDPA_SOURCE_URL: $(yaml_quote "$MDPA_SOURCE_URL")
MDPA_MAX_ROWS: $(yaml_quote "${MDPA_MAX_ROWS:-1000}")
MDPA_REQUIRE_CONFIRMATION: $(yaml_quote "${MDPA_REQUIRE_CONFIRMATION:-true}")
MDPA_ESTIMATED_CREDITS: $(yaml_quote "${MDPA_ESTIMATED_CREDITS:-50}")
ARCGIS_MAX_ROWS: $(yaml_quote "${ARCGIS_MAX_ROWS:-50}")
MIAMI_DADE_PARCELS_URL: $(yaml_quote "$MIAMI_DADE_PARCELS_URL")
MIAMI_DADE_FORECLOSURE_URL: $(yaml_quote "$MIAMI_DADE_FORECLOSURE_URL")
MIAMI_DADE_FORECLOSURE_API_KEY: $(yaml_quote "$MIAMI_DADE_FORECLOSURE_API_KEY")
MIAMI_DADE_FORECLOSURE_MAX_FOLIOS: $(yaml_quote "${MIAMI_DADE_FORECLOSURE_MAX_FOLIOS:-40}")
BROWARD_FORECLOSURE_URL: $(yaml_quote "$BROWARD_FORECLOSURE_URL")
BROWARD_FORECLOSURE_API_KEY: $(yaml_quote "$BROWARD_FORECLOSURE_API_KEY")
BROWARD_FORECLOSURE_CASE_TYPES: $(yaml_quote "$BROWARD_FORECLOSURE_CASE_TYPES")
BROWARD_FORECLOSURE_COURT_TYPE: $(yaml_quote "$BROWARD_FORECLOSURE_COURT_TYPE")
BROWARD_FORECLOSURE_DATE_TO_USE: $(yaml_quote "$BROWARD_FORECLOSURE_DATE_TO_USE")
BROWARD_FORECLOSURE_LOOKBACK_DAYS: $(yaml_quote "${BROWARD_FORECLOSURE_LOOKBACK_DAYS:-7}")
BROWARD_FORECLOSURE_MAX_REQUESTS: $(yaml_quote "${BROWARD_FORECLOSURE_MAX_REQUESTS:-200}")
BROWARD_FORECLOSURE_MAX_CASES: $(yaml_quote "${BROWARD_FORECLOSURE_MAX_CASES:-250}")
BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION: $(yaml_quote "${BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION:-true}")
BROWARD_FORECLOSURE_ESTIMATED_CREDITS: $(yaml_quote "${BROWARD_FORECLOSURE_ESTIMATED_CREDITS:-250}")
BROWARD_PARCELS_URL: $(yaml_quote "$BROWARD_PARCELS_URL")
PALM_BEACH_PARCELS_URL: $(yaml_quote "$PALM_BEACH_PARCELS_URL")
GEOCODING_PROVIDER: $(yaml_quote "${GEOCODING_PROVIDER:-none}")
GEOCODING_API_KEY: $(yaml_quote "$GEOCODING_API_KEY")
TWILIO_ACCOUNT_SID: $(yaml_quote "$TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN: $(yaml_quote "$TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER: $(yaml_quote "$TWILIO_FROM_NUMBER")
CHAT_ENABLE: $(yaml_quote "${CHAT_ENABLE:-true}")
CHAT_MAX_CONTEXT_DEALS: $(yaml_quote "${CHAT_MAX_CONTEXT_DEALS:-20}")
OPENAI_API_KEY: $(yaml_quote "$OPENAI_API_KEY")
OPENAI_MODEL: $(yaml_quote "${OPENAI_MODEL:-gpt-4.1-mini}")
OPENAI_TIMEOUT_MS: $(yaml_quote "${OPENAI_TIMEOUT_MS:-12000}")
EOF

gcloud run deploy "$API_SERVICE" \
  --image "$API_IMAGE" \
  --region "$REGION" \
  --platform managed \
  "$RUN_AUTH_FLAG" \
  "$RUN_INVOKER_FLAG" \
  --port 4000 \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  "${API_NETWORK_FLAGS[@]}" \
  --env-vars-file "$API_ENV_YAML" >/dev/null

API_URL="$(gcloud run services describe "$API_SERVICE" --region "$REGION" --format='value(status.url)')"
if [[ -z "$API_URL" ]]; then
  echo "[error] Could not resolve API URL after deploy."
  exit 1
fi

echo "[6/10] Run DB migrations"
gcloud run jobs deploy "$MIGRATE_JOB" \
  --region "$REGION" \
  --image "$API_IMAGE" \
  --set-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  --env-vars-file "$API_ENV_YAML" \
  --command npm \
  --args run,db:migrate:deploy,-w,@prive/api \
  --max-retries 0 \
  --tasks 1 \
  --task-timeout 1200s >/dev/null

gcloud run jobs execute "$MIGRATE_JOB" --region "$REGION" --wait >/dev/null

echo "[7/10] Deploy web with API URL"
cat > "$WEB_ENV_YAML" <<EOF
NODE_ENV: 'production'
NEXT_PUBLIC_API_URL: $(yaml_quote "${API_URL}/api")
NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY: $(yaml_quote "$NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY")
NEXT_PUBLIC_CHAT_ENABLE: $(yaml_quote "${NEXT_PUBLIC_CHAT_ENABLE:-true}")
EOF

gcloud run deploy "$WEB_SERVICE" \
  --image "$WEB_IMAGE" \
  --region "$REGION" \
  --platform managed \
  "$RUN_AUTH_FLAG" \
  "$RUN_INVOKER_FLAG" \
  --port 3000 \
  --env-vars-file "$WEB_ENV_YAML" >/dev/null

WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --region "$REGION" --format='value(status.url)')"
if [[ -z "$WEB_URL" ]]; then
  echo "[error] Could not resolve WEB URL after deploy."
  exit 1
fi

echo "[8/10] Redeploy API with final WEB_APP_URL + OAuth redirect"
cat > "$API_ENV_YAML" <<EOF
NODE_ENV: 'production'
DATABASE_URL: $(yaml_quote "$DATABASE_URL")
JWT_SECRET: $(yaml_quote "$JWT_SECRET")
JWT_EXPIRES_IN: $(yaml_quote "${JWT_EXPIRES_IN:-1d}")
JWT_REFRESH_SECRET: $(yaml_quote "$JWT_REFRESH_SECRET")
JWT_REFRESH_EXPIRES_IN: $(yaml_quote "${JWT_REFRESH_EXPIRES_IN:-7d}")
AUTH_ADMIN_EMAILS: $(yaml_quote "$AUTH_ADMIN_EMAILS")
AUTH_COOKIE_SECURE: 'true'
AUTH_COOKIE_SAME_SITE: 'none'
WEB_APP_URL: $(yaml_quote "$WEB_URL")
GOOGLE_OAUTH_CLIENT_ID: $(yaml_quote "$GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET: $(yaml_quote "$GOOGLE_OAUTH_CLIENT_SECRET")
GOOGLE_OAUTH_REDIRECT_URI: $(yaml_quote "${API_URL}/api/auth/google/callback")
MDPA_BULK_FILE_PATH: $(yaml_quote "$MDPA_BULK_FILE_PATH")
MDPA_SOURCE_URL: $(yaml_quote "$MDPA_SOURCE_URL")
MDPA_MAX_ROWS: $(yaml_quote "${MDPA_MAX_ROWS:-1000}")
MDPA_REQUIRE_CONFIRMATION: $(yaml_quote "${MDPA_REQUIRE_CONFIRMATION:-true}")
MDPA_ESTIMATED_CREDITS: $(yaml_quote "${MDPA_ESTIMATED_CREDITS:-50}")
ARCGIS_MAX_ROWS: $(yaml_quote "${ARCGIS_MAX_ROWS:-50}")
MIAMI_DADE_PARCELS_URL: $(yaml_quote "$MIAMI_DADE_PARCELS_URL")
MIAMI_DADE_FORECLOSURE_URL: $(yaml_quote "$MIAMI_DADE_FORECLOSURE_URL")
MIAMI_DADE_FORECLOSURE_API_KEY: $(yaml_quote "$MIAMI_DADE_FORECLOSURE_API_KEY")
MIAMI_DADE_FORECLOSURE_MAX_FOLIOS: $(yaml_quote "${MIAMI_DADE_FORECLOSURE_MAX_FOLIOS:-40}")
BROWARD_FORECLOSURE_URL: $(yaml_quote "$BROWARD_FORECLOSURE_URL")
BROWARD_FORECLOSURE_API_KEY: $(yaml_quote "$BROWARD_FORECLOSURE_API_KEY")
BROWARD_FORECLOSURE_CASE_TYPES: $(yaml_quote "$BROWARD_FORECLOSURE_CASE_TYPES")
BROWARD_FORECLOSURE_COURT_TYPE: $(yaml_quote "$BROWARD_FORECLOSURE_COURT_TYPE")
BROWARD_FORECLOSURE_DATE_TO_USE: $(yaml_quote "$BROWARD_FORECLOSURE_DATE_TO_USE")
BROWARD_FORECLOSURE_LOOKBACK_DAYS: $(yaml_quote "${BROWARD_FORECLOSURE_LOOKBACK_DAYS:-7}")
BROWARD_FORECLOSURE_MAX_REQUESTS: $(yaml_quote "${BROWARD_FORECLOSURE_MAX_REQUESTS:-200}")
BROWARD_FORECLOSURE_MAX_CASES: $(yaml_quote "${BROWARD_FORECLOSURE_MAX_CASES:-250}")
BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION: $(yaml_quote "${BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION:-true}")
BROWARD_FORECLOSURE_ESTIMATED_CREDITS: $(yaml_quote "${BROWARD_FORECLOSURE_ESTIMATED_CREDITS:-250}")
BROWARD_PARCELS_URL: $(yaml_quote "$BROWARD_PARCELS_URL")
PALM_BEACH_PARCELS_URL: $(yaml_quote "$PALM_BEACH_PARCELS_URL")
GEOCODING_PROVIDER: $(yaml_quote "${GEOCODING_PROVIDER:-none}")
GEOCODING_API_KEY: $(yaml_quote "$GEOCODING_API_KEY")
TWILIO_ACCOUNT_SID: $(yaml_quote "$TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN: $(yaml_quote "$TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER: $(yaml_quote "$TWILIO_FROM_NUMBER")
CHAT_ENABLE: $(yaml_quote "${CHAT_ENABLE:-true}")
CHAT_MAX_CONTEXT_DEALS: $(yaml_quote "${CHAT_MAX_CONTEXT_DEALS:-20}")
OPENAI_API_KEY: $(yaml_quote "$OPENAI_API_KEY")
OPENAI_MODEL: $(yaml_quote "${OPENAI_MODEL:-gpt-4.1-mini}")
OPENAI_TIMEOUT_MS: $(yaml_quote "${OPENAI_TIMEOUT_MS:-12000}")
EOF

gcloud run deploy "$API_SERVICE" \
  --image "$API_IMAGE" \
  --region "$REGION" \
  --platform managed \
  "$RUN_AUTH_FLAG" \
  "$RUN_INVOKER_FLAG" \
  --port 4000 \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  "${API_NETWORK_FLAGS[@]}" \
  --env-vars-file "$API_ENV_YAML" >/dev/null

echo "[9/10] Health checks"
ID_TOKEN="$(gcloud auth print-identity-token)"
curl -fsS -H "Authorization: Bearer ${ID_TOKEN}" "${API_URL}/api/health" >/dev/null
curl -fsS -H "Authorization: Bearer ${ID_TOKEN}" "${API_URL}/api/auth/google/status" >/dev/null
curl -fsS -H "Authorization: Bearer ${ID_TOKEN}" "${WEB_URL}" >/dev/null

echo "[10/10] Done"
echo "PROJECT_ID=${PROJECT_ID}"
echo "REGION=${REGION}"
echo "API_URL=${API_URL}"
echo "WEB_URL=${WEB_URL}"
echo "GOOGLE_REDIRECT_URI=${API_URL}/api/auth/google/callback"
echo "JS_ORIGIN=${WEB_URL}"
echo "CLOUD_SQL_CONNECTION=${INSTANCE_CONNECTION_NAME}"
echo "DISABLE_INVOKER_IAM_CHECK=${DISABLE_INVOKER_IAM_CHECK}"
