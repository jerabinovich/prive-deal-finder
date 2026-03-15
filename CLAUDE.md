# OpenClaw / Amanda Push Architecture — Project Context

## What This Project Is

This is the migration of Prive Group's Amanda AI agent system from Google Apps Script polling to a push-based event-driven architecture using Gmail Pub/Sub + n8n + Cloud Functions.

**Owner:** Javier Rabinovich (JR) — jr@privegroup.com
**AI Agent Account:** amanda@privegroup.com
**Company:** Prive Group — real estate development, income-producing assets, asset management, leasing/sales, construction, JVs.

## Infrastructure Notes

- **NVIDIA DGX Spark** is available on-prem for deployment (future on-prem LLM + n8n host)
- **n8n was previously installed on the Spark but has been uninstalled.** It needs to be reinstalled before Phase 2+ can proceed. See `scripts/install-n8n-spark.sh` for the reinstallation procedure.
- Target: run n8n + Postgres + Redis on the Spark via Docker Compose, then point the GCP Cloud Function webhooks to the Spark's public endpoint (or use a tunnel like Cloudflare Tunnel / ngrok for development).

## Current State (Broken)

The system currently runs 5-6 Google Apps Script projects across two Gmail accounts, polling every 5-15 minutes. They collectively exceed Gmail API daily quotas (~2,400 calls/day against a ~1,500 limit), causing all scripts to fail.

### Scripts Being Replaced

**JR's account (jr@privegroup.com):**
- `jrTriageInbox_FULL` — triages inbox, applies labels (Opportunity RE, Legal, Construction, Finance, etc.)
- `forwardToAmanda` — forwards action-tagged emails to amanda@privegroup.com

**Amanda's account (amanda@privegroup.com):**
- `routeToAmandaDrafts` — reads AMANDA/QUEUE/* labels, builds `<AMANDA_TASK>` JSON payloads, creates Gmail drafts
- `monitorTimeouts` — HITL timeout monitoring with Telegram alerts
- `sendMorningBrief` — daily status brief via Telegram
- `auditRequiredLabels` — diagnostics

### Key Architecture Concepts

1. **Label State Machine:** Gmail labels are used as workflow states:
   - `AMANDA/QUEUE/*` — task queues by type (OPPORTUNITY_RE, LEGAL_REVIEW, etc.)
   - `AMANDA/STATE/*` — processing states (PROCESSING, PROCESSED, WAITING_HITL)
   - `CTX/*` — context labels
   - `Forwarded/Amanda/*` — anti-loop guards

2. **HITL Gates:** Human-in-the-Loop approval required before any outbound actions. Different timeout thresholds per task type. Telegram bot (@PriveTelclawBot) for alerts.

3. **Task Payload:** Structured `<AMANDA_TASK>` JSON envelope with thread metadata, context, and instructions.

4. **AI Backend:** Processes drafts → produces outputs (deal screening, follow-ups, reply drafts). Currently uses cloud LLM API. Future: on-prem NVIDIA DGX Spark.

## Target Architecture

```
Gmail Inbox → Gmail watch() → GCP Pub/Sub → Cloud Function → n8n Webhook
                                                                    ↓
                                                        n8n Workflow Engine
                                                      /        |        \
                                              Triage    Route to      HITL
                                              & Label   Amanda Queue  Monitor
                                                                    ↓
                                                        AI Processing
                                                        (OpenAI/Claude)
                                                                    ↓
                                                        Gmail Draft Creation
                                                        + Telegram Notification
```

## Project Structure

```
openclaw-push-architecture/
├── CLAUDE.md                          ← You are here
├── README.md                          ← Setup instructions
├── docs/
│   └── architecture.md                ← Full technical design
├── gas-consolidated/
│   ├── JR_Inbox_Manager.gs           ← Phase 1: consolidated JR script
│   └── Amanda_Agent_Core.gs          ← Phase 1: consolidated Amanda script
├── cloud-functions/
│   └── gmail-webhook/
│       ├── index.js                   ← Cloud Function: Pub/Sub → n8n
│       ├── package.json
│       └── .env.example
├── n8n-workflows/
│   ├── jr-email-triage.json          ← n8n workflow: inbox triage
│   ├── amanda-queue-router.json      ← n8n workflow: task routing
│   ├── hitl-monitor.json             ← n8n workflow: HITL timeouts
│   └── morning-brief.json           ← n8n workflow: daily brief
├── scripts/
│   ├── setup-gcp.sh                  ← GCP Pub/Sub + service account setup
│   ├── setup-gmail-watch.sh          ← Gmail API watch() activation
│   └── deploy-cloud-function.sh      ← Deploy to GCP
└── docker/
    └── docker-compose.yml            ← n8n + Postgres + Redis
```

## Implementation Order

1. **Phase 0 (done):** Emergency trigger fixes in existing Apps Script
2. **Phase 1 (done):** Consolidated scripts in `gas-consolidated/`
3. **Phase 2:** GCP setup → `scripts/setup-gcp.sh`
4. **Phase 3:** Cloud Function → `cloud-functions/gmail-webhook/`
5. **Phase 4:** n8n workflows → `n8n-workflows/`
6. **Phase 5:** Docker deployment → `docker/`
7. **Phase 6:** Cutover from Apps Script to push architecture

## Key Credentials Needed (DO NOT commit)

- GCP Project ID
- GCP Service Account key (JSON)
- Gmail API OAuth client ID/secret
- Telegram Bot Token (for @PriveTelclawBot)
- Telegram Chat ID (JR's chat)
- OpenAI / Anthropic API key (for AI processing)
- n8n encryption key

## Commands

```bash
# GCP Setup
./scripts/setup-gcp.sh

# Deploy Cloud Function
./scripts/deploy-cloud-function.sh

# Start n8n locally
cd docker && docker compose up -d

# Activate Gmail watch
./scripts/setup-gmail-watch.sh
```
