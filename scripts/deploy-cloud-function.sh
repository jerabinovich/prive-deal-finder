#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Deploy Gmail Webhook Cloud Function
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-prive-openclaw}"
REGION="${GCP_REGION:-us-east1}"
FUNCTION_NAME="openclaw-gmail-webhook"

echo "▸ Deploying Cloud Function: ${FUNCTION_NAME}..."

cd "$(dirname "$0")/../cloud-functions/gmail-webhook"

# Deploy as Cloud Function (2nd gen / Cloud Run based)
gcloud functions deploy "${FUNCTION_NAME}" \
  --gen2 \
  --runtime=nodejs18 \
  --region="${REGION}" \
  --source=. \
  --entry-point=gmailWebhookHttp \
  --trigger-http \
  --allow-unauthenticated \
  --memory=256MB \
  --timeout=30s \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID}" \
  --set-env-vars="N8N_WEBHOOK_JR=${N8N_WEBHOOK_JR:-http://localhost:5678/webhook/gmail-jr}" \
  --set-env-vars="N8N_WEBHOOK_AMANDA=${N8N_WEBHOOK_AMANDA:-http://localhost:5678/webhook/gmail-amanda}" \
  --set-env-vars="N8N_WEBHOOK_SECRET=${N8N_WEBHOOK_SECRET:-}"

# Get the function URL
FUNCTION_URL=$(gcloud functions describe "${FUNCTION_NAME}" \
  --gen2 --region="${REGION}" \
  --format="value(serviceConfig.uri)")

echo ""
echo "  ✅ Deployed: ${FUNCTION_URL}"
echo ""

# Update Pub/Sub subscriptions to push to this URL
echo "▸ Updating Pub/Sub subscriptions to push mode..."

gcloud pubsub subscriptions modify-push-config gmail-jr-inbox-sub \
  --push-endpoint="${FUNCTION_URL}" \
  --push-auth-service-account="openclaw-gmail-push@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud pubsub subscriptions modify-push-config gmail-amanda-inbox-sub \
  --push-endpoint="${FUNCTION_URL}" \
  --push-auth-service-account="openclaw-gmail-push@${PROJECT_ID}.iam.gserviceaccount.com"

echo "  ✅ Subscriptions updated to push mode"
echo ""
echo "  Function URL: ${FUNCTION_URL}"
echo "  Next: Run ./scripts/setup-gmail-watch.sh"
