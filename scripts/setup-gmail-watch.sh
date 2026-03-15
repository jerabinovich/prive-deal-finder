#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Gmail Watch Setup — Activate push notifications for both accounts
#
# This uses the Gmail API watch() method to subscribe to inbox changes.
# Must be renewed every 7 days (use n8n scheduled workflow for renewal).
#
# Prerequisites:
# - OAuth2 credentials configured for both Gmail accounts
# - Pub/Sub topics created (run setup-gcp.sh first)
# - gcloud authenticated
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-prive-openclaw}"

echo "═══════════════════════════════════════════════════════════"
echo "  Gmail Watch Setup — Push Notifications"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── JR's Account ──────────────────────────────────────────────────
echo "▸ Setting up watch for jr@privegroup.com..."
echo ""
echo "  Run this in the Google API Explorer or via OAuth2 token:"
echo ""
echo "  POST https://gmail.googleapis.com/gmail/v1/users/me/watch"
echo "  Authorization: Bearer <JR_OAUTH_TOKEN>"
echo "  Content-Type: application/json"
echo ""
echo '  {'
echo '    "topicName": "projects/'"${PROJECT_ID}"'/topics/gmail-jr-inbox",'
echo '    "labelIds": ["INBOX"],'
echo '    "labelFilterBehavior": "INCLUDE"'
echo '  }'
echo ""

# ─── Amanda's Account ─────────────────────────────────────────────
echo "▸ Setting up watch for amanda@privegroup.com..."
echo ""
echo "  POST https://gmail.googleapis.com/gmail/v1/users/me/watch"
echo "  Authorization: Bearer <AMANDA_OAUTH_TOKEN>"
echo "  Content-Type: application/json"
echo ""
echo '  {'
echo '    "topicName": "projects/'"${PROJECT_ID}"'/topics/gmail-amanda-inbox",'
echo '    "labelIds": ["INBOX"],'
echo '    "labelFilterBehavior": "INCLUDE"'
echo '  }'
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  IMPORTANT: Gmail watch() expires after 7 days."
echo "  The n8n 'watch-renewal' workflow auto-renews daily."
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  To get OAuth tokens, use the Google OAuth Playground:"
echo "  https://developers.google.com/oauthplayground/"
echo "  Scope: https://www.googleapis.com/auth/gmail.readonly"
echo ""
echo "  Or use a service account with domain-wide delegation"
echo "  (recommended for production)."
