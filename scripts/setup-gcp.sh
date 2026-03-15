#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# GCP Setup — Pub/Sub Topics, Subscriptions, Service Account
# Run once to provision all GCP infrastructure for Gmail push notifications.
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────
# TODO: Replace these with your actual values
PROJECT_ID="${GCP_PROJECT_ID:-prive-openclaw}"
REGION="${GCP_REGION:-us-east1}"
SERVICE_ACCOUNT_NAME="openclaw-gmail-push"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "═══════════════════════════════════════════════════════════"
echo "  OpenClaw — GCP Infrastructure Setup"
echo "  Project: ${PROJECT_ID}"
echo "  Region:  ${REGION}"
echo "═══════════════════════════════════════════════════════════"

# ─── Step 1: Set project ────────────────────────────────────────────
echo ""
echo "▸ Setting GCP project..."
gcloud config set project "${PROJECT_ID}"

# ─── Step 2: Enable required APIs ──────────────────────────────────
echo ""
echo "▸ Enabling APIs..."
gcloud services enable \
  gmail.googleapis.com \
  pubsub.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com

echo "  ✅ APIs enabled"

# ─── Step 3: Create Pub/Sub topics ─────────────────────────────────
echo ""
echo "▸ Creating Pub/Sub topics..."

# Topic for JR's Gmail notifications
gcloud pubsub topics create gmail-jr-inbox \
  --message-retention-duration=1h \
  2>/dev/null || echo "  ℹ️ gmail-jr-inbox already exists"

# Topic for Amanda's Gmail notifications
gcloud pubsub topics create gmail-amanda-inbox \
  --message-retention-duration=1h \
  2>/dev/null || echo "  ℹ️ gmail-amanda-inbox already exists"

echo "  ✅ Topics created"

# ─── Step 4: Grant Gmail API permission to publish to topics ───────
echo ""
echo "▸ Granting Gmail publish permissions..."

# Gmail's service account needs publisher access
# This is Google's internal service account for Gmail push notifications
GMAIL_SA="serviceAccount:gmail-api-push@system.gserviceaccount.com"

gcloud pubsub topics add-iam-policy-binding gmail-jr-inbox \
  --member="${GMAIL_SA}" \
  --role="roles/pubsub.publisher" \
  --quiet

gcloud pubsub topics add-iam-policy-binding gmail-amanda-inbox \
  --member="${GMAIL_SA}" \
  --role="roles/pubsub.publisher" \
  --quiet

echo "  ✅ Gmail publish permissions granted"

# ─── Step 5: Create push subscriptions ─────────────────────────────
echo ""
echo "▸ Creating Pub/Sub subscriptions..."

# These will be updated later with the actual Cloud Function URL
# For now, create as pull subscriptions (we'll switch to push after deploying)
gcloud pubsub subscriptions create gmail-jr-inbox-sub \
  --topic=gmail-jr-inbox \
  --ack-deadline=30 \
  --message-retention-duration=1h \
  --expiration-period=never \
  2>/dev/null || echo "  ℹ️ gmail-jr-inbox-sub already exists"

gcloud pubsub subscriptions create gmail-amanda-inbox-sub \
  --topic=gmail-amanda-inbox \
  --ack-deadline=30 \
  --message-retention-duration=1h \
  --expiration-period=never \
  2>/dev/null || echo "  ℹ️ gmail-amanda-inbox-sub already exists"

echo "  ✅ Subscriptions created"

# ─── Step 6: Create service account ────────────────────────────────
echo ""
echo "▸ Creating service account..."
gcloud iam service-accounts create "${SERVICE_ACCOUNT_NAME}" \
  --display-name="OpenClaw Gmail Push Service" \
  --description="Service account for OpenClaw Gmail push notifications and n8n integration" \
  2>/dev/null || echo "  ℹ️ Service account already exists"

# Grant necessary roles
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/pubsub.subscriber" \
  --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/cloudfunctions.invoker" \
  --quiet

echo "  ✅ Service account configured"

# ─── Step 7: Create and download key ───────────────────────────────
echo ""
echo "▸ Creating service account key..."
KEY_FILE="./credentials/gcp-service-account.json"
mkdir -p ./credentials

if [ -f "${KEY_FILE}" ]; then
  echo "  ℹ️ Key file already exists at ${KEY_FILE}"
else
  gcloud iam service-accounts keys create "${KEY_FILE}" \
    --iam-account="${SERVICE_ACCOUNT_EMAIL}"
  echo "  ✅ Key saved to ${KEY_FILE}"
  echo "  ⚠️  DO NOT commit this file to git!"
fi

# ─── Step 8: Store secrets in Secret Manager ───────────────────────
echo ""
echo "▸ Storing secrets..."

# Telegram token — you'll need to set this manually
gcloud secrets create telegram-bot-token \
  --replication-policy="automatic" \
  2>/dev/null || echo "  ℹ️ telegram-bot-token secret already exists"

# n8n webhook secret
N8N_WEBHOOK_SECRET=$(openssl rand -hex 32)
echo -n "${N8N_WEBHOOK_SECRET}" | gcloud secrets versions add n8n-webhook-secret \
  --secret=n8n-webhook-secret --data-file=- 2>/dev/null || \
  (gcloud secrets create n8n-webhook-secret --replication-policy="automatic" && \
   echo -n "${N8N_WEBHOOK_SECRET}" | gcloud secrets versions add n8n-webhook-secret --data-file=-)

echo "  ✅ Secrets configured"
echo "  ℹ️  Set Telegram token: gcloud secrets versions add telegram-bot-token --data-file=<token-file>"

# ─── Summary ────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ GCP Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Topics:        gmail-jr-inbox, gmail-amanda-inbox"
echo "  Subscriptions: gmail-jr-inbox-sub, gmail-amanda-inbox-sub"
echo "  Service Acct:  ${SERVICE_ACCOUNT_EMAIL}"
echo "  Key File:      ${KEY_FILE}"
echo ""
echo "  Next steps:"
echo "  1. Run ./scripts/deploy-cloud-function.sh"
echo "  2. Update subscriptions to push (auto-done by deploy script)"
echo "  3. Run ./scripts/setup-gmail-watch.sh"
echo ""
