# Technical Architecture: Migration from Google Apps Script Polling to n8n Push-Based Email Processing

**Document Version:** 1.0
**Last Updated:** March 14, 2026
**Target Organization:** Prive Group
**System Name:** Amanda - AI Email Agent
**Author Notes:** This document provides a complete migration strategy from Gmail polling (5-15 min intervals) to push-based event-driven architecture using Gmail Pub/Sub and n8n.

---

## 1. Executive Summary

### Current State Problems
- **Quota Exhaustion**: Daily API quota limits hit due to 5-15 minute polling intervals on two accounts
- **Latency**: 5-15 minute delays between email arrival and processing
- **Inefficiency**: Hundreds of API calls checking empty inboxes
- **Scaling Issues**: Adding more accounts/workflows will further stress quotas
- **Resource Waste**: Continuous polling consumes compute resources unnecessarily

### Proposed Solution
Replace polling with an event-driven architecture using:
- **Gmail Pub/Sub Watch**: Push notifications when emails arrive
- **Google Cloud Pub/Sub**: Message queue for reliability and scaling
- **n8n Workflows**: Replace GAS with visual workflow automation
- **Webhook Receivers**: n8n listens for Pub/Sub messages instead of polling
- **State Machine**: Maintain label-based workflow state, now triggered by events

### Expected Benefits
- **99% API Call Reduction**: Eliminate unnecessary polling
- **Sub-second Latency**: Process emails immediately on arrival
- **Cost Savings**: Reduced API calls, reduced compute
- **Reliability**: Message queue ensures no events lost
- **Scalability**: Can monitor unlimited accounts within quotas
- **Maintainability**: Visual n8n workflows easier than GAS scripts

---

## 2. Architecture Overview

### 2.1 Current Architecture (As-Is)

```
┌─────────────────────────────────────────────────────────────┐
│                    Gmail Accounts                            │
│  ┌─────────────────┐        ┌─────────────────┐            │
│  │  jr@prive...    │        │ amanda@prive... │            │
│  │  Inbox          │        │  Inbox          │            │
│  └────────┬────────┘        └────────┬────────┘            │
└───────────┼───────────────────────────┼────────────────────┘
            │                           │
     Every 5-15 min            Every 5-15 min
   (Time-based triggers)     (Time-based triggers)
            │                           │
            v                           v
┌──────────────────┐        ┌──────────────────┐
│  Google Apps     │        │  Google Apps     │
│  Script (GAS)    │        │  Script (GAS)    │
│  Triage/Forward  │        │  Queue/Process   │
│                  │        │  & Draft Create  │
└────────┬─────────┘        └────────┬─────────┘
         │                           │
         │ (Poll Gmail API)          │ (Poll Gmail API)
         │ (Read/Label/Modify)       │ (Build JSON)
         │                           │
         └──────────────┬────────────┘
                        │
                        v
                ┌───────────────┐
                │  AI Backend   │
                │ (OpenAI/      │
                │  Claude)      │
                │               │
                │  + HITL       │
                │  (Telegram)   │
                └───────────────┘

Problems:
- Excessive polling (quota exhaustion)
- 5-15 min latency
- Hundreds of wasted API calls
```

### 2.2 Target Architecture (To-Be)

```
┌────────────────────────────────────────────────────────────┐
│                  Gmail Accounts                             │
│  ┌─────────────────┐        ┌─────────────────┐           │
│  │  jr@prive...    │        │ amanda@prive... │           │
│  │  Inbox          │        │  Inbox          │           │
│  │ (Watch enabled) │        │ (Watch enabled) │           │
│  └────────┬────────┘        └────────┬────────┘           │
└───────────┼───────────────────────────┼───────────────────┘
            │ Email arrives             │ Email arrives
            │ (Push notification)       │ (Push notification)
            v                           v
┌─────────────────────────────────────────────────────┐
│      Google Cloud Pub/Sub Topics                     │
│  ┌──────────────┐         ┌──────────────┐         │
│  │ gmail-jr     │         │ gmail-amanda │         │
│  │ Topic        │         │ Topic        │         │
│  └──────┬───────┘         └──────┬───────┘         │
│         │                        │                 │
│         └────────────┬───────────┘                 │
└──────────────────────┼─────────────────────────────┘
                       │ Subscriptions
                       v
         ┌─────────────────────────────┐
         │   n8n Webhook Listener      │
         │  (Always listening, no      │
         │   polling needed)           │
         └────────────┬────────────────┘
                      │
                      v
    ┌─────────────────────────────────────────┐
    │         n8n Workflows                    │
    │                                          │
    │  ┌────────────────────────────────────┐ │
    │  │ Workflow 1: Email Triage & Route   │ │
    │  │  - Parse email metadata            │ │
    │  │  - Apply labels (state machine)    │ │
    │  │  - Forward to Amanda if needed     │ │
    │  └────────────────────────────────────┘ │
    │                                          │
    │  ┌────────────────────────────────────┐ │
    │  │ Workflow 2: Queue Processing       │ │
    │  │  - Read AMANDA/QUEUE/* labeled    │ │
    │  │  - Build JSON task payload        │ │
    │  │  - Call AI backend (OpenAI API)   │ │
    │  │  - Handle HITL gates (Telegram)   │ │
    │  │  - Update state labels            │ │
    │  └────────────────────────────────────┘ │
    │                                          │
    │  ┌────────────────────────────────────┐ │
    │  │ Workflow 3: Morning Brief          │ │
    │  │  - Scheduled daily (9 AM)         │ │
    │  │  - Compile summary statistics     │ │
    │  │  - Send email summary to JR       │ │
    │  └────────────────────────────────────┘ │
    │                                          │
    │  [Additional 4-5 workflows as needed]    │
    └────────────────────┬────────────────────┘
                         │
                ┌────────┴────────┐
                │                 │
                v                 v
         ┌────────────┐    ┌──────────────┐
         │ Gmail API  │    │ AI Backend   │
         │  (Read,    │    │(OpenAI/      │
         │  Write,    │    │ Claude API)  │
         │  Label)    │    │              │
         └────────────┘    │ + HITL       │
                           │ (Telegram)   │
                           └──────────────┘

Benefits:
- Push-based (sub-second latency)
- No polling = 99% less API calls
- Event-driven state machine
- Scalable and maintainable
```

### 2.3 Key Components

| Component | Purpose | Technology |
|-----------|---------|-----------|
| **Gmail Watch** | Push notifications on email arrival | Gmail API `watch()` |
| **Pub/Sub Topics** | Message queue for each account | Google Cloud Pub/Sub |
| **Pub/Sub Subscriptions** | Deliver messages to n8n | Google Cloud Pub/Sub |
| **n8n Webhooks** | Receive Pub/Sub messages | n8n HTTP node |
| **n8n Workflows** | Process emails and build tasks | n8n |
| **Gmail API** | Read/write/label emails | Google Workspace Admin |
| **AI Backend** | Process tasks, generate responses | OpenAI/Claude API |
| **Telegram Bot** | HITL approvals and notifications | Telegram Bot API |
| **Persistent Storage** | Amanda's memory/context | PostgreSQL or Supabase |

---

## 3. Gmail Push Notifications Setup

### 3.1 How Gmail Watch Works

The Gmail API's `watch()` method establishes a push channel that notifies you when new messages arrive in a mailbox, instead of polling.

**Key Points:**
- When emails arrive in the watched mailbox, Google sends a Pub/Sub message
- Each message contains `emailAddress` and `historyId` (not the full email)
- You must query Gmail API using `historyId` to fetch full email details
- Watch needs to be renewed every 7 days (automatically handled in workflow)
- No message payload = increased privacy, but requires secondary API call

### 3.2 GCP Setup Steps

#### Step 1: Create a GCP Project (if not exists)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a Project" → "New Project"
3. Name: `prive-amanda-prod`
4. Organization: Select Prive Group organization
5. Click "Create"

#### Step 2: Enable Required APIs

In the GCP Console, navigate to "APIs & Services" → "Library":

1. **Enable Gmail API**
   - Search: "Gmail API"
   - Click result
   - Click "Enable"
   - (Should already be enabled if you're using Gmail)

2. **Enable Cloud Pub/Sub API**
   - Search: "Cloud Pub/Sub API"
   - Click result
   - Click "Enable"

3. **Enable Cloud Logging API**
   - Search: "Cloud Logging API"
   - Click result
   - Click "Enable"

#### Step 3: Create Service Account

Navigate to "APIs & Services" → "Credentials":

1. Click "Create Credentials" → "Service Account"
2. Service account name: `amanda-n8n-service`
3. Service account ID: `amanda-n8n-service` (auto-filled)
4. Click "Create and Continue"
5. Grant roles:
   - `Pub/Sub Editor` (for publishing/consuming from Pub/Sub)
   - `Cloud Logging Admin` (for debugging)
6. Click "Continue"
7. Click "Create Key"
8. Key type: "JSON"
9. Click "Create"
   - **SAVE THIS JSON FILE SECURELY** - You'll need it for n8n

#### Step 4: Create Pub/Sub Topics and Subscriptions

In GCP Console, navigate to "Pub/Sub" → "Topics":

**For JR Account:**

1. Click "Create Topic"
2. Name: `gmail-jr-incoming`
3. Click "Create Topic"
4. In topic, click "Create Subscription"
5. Subscription name: `gmail-jr-n8n`
6. Delivery type: "Push"
7. Push endpoint: `https://n8n.yourdomain.com/webhook/gmail-jr` (configure after n8n setup)
8. Click "Create"

**For Amanda Account:**

1. Create topic: `gmail-amanda-incoming`
2. Create subscription: `gmail-amanda-n8n`
3. Delivery type: "Push"
4. Push endpoint: `https://n8n.yourdomain.com/webhook/gmail-amanda`
5. Click "Create"

#### Step 5: Configure Service Account Permissions for Gmail

The service account must have permission to call Gmail `watch()` on both accounts. This requires domain-wide delegation.

1. Go to "APIs & Services" → "Credentials"
2. Click the service account name: `amanda-n8n-service`
3. Go to "Keys" tab
4. Under "User & Admin API privileges", copy the "Client ID"
5. Go to [Google Workspace Admin Console](https://admin.google.com/)
6. Navigate to "Security" → "API Controls" → "Domain-wide Delegation"
7. Click "Add new"
8. Client ID: Paste from step 4
9. OAuth scopes: Add these exact scopes:
   ```
   https://www.googleapis.com/auth/gmail.modify,
   https://www.googleapis.com/auth/pubsub
   ```
10. Click "Authorize"

#### Step 6: Set Up Gmail Watch

Create an n8n workflow to establish the watch. (See Workflow 0 below)

This can also be done via gcloud CLI:
```bash
gcloud pubsub topics create gmail-jr-incoming --project=prive-amanda-prod
gcloud pubsub subscriptions create gmail-jr-n8n \
  --topic=gmail-jr-incoming \
  --push-endpoint=https://n8n.yourdomain.com/webhook/gmail-jr \
  --project=prive-amanda-prod
```

### 3.3 Watch Renewal

Watches are only valid for 7 days. You must set up automatic renewal:

**Workflow 0: Gmail Watch Renewal (Scheduled Daily)**

```
Trigger:
  - Schedule: Every day at 3 AM UTC

Steps:
1. [Function node] Get current timestamp
2. [Gmail node] Call gmail.users.watch()
   - For both jr@privegroup.com and amanda@privegroup.com
   - topicName: "projects/prive-amanda-prod/topics/gmail-jr-incoming"
   - topicName: "projects/prive-amanda-prod/topics/gmail-amanda-incoming"
3. [Function node] Validate response contains "historyId"
4. [Error handling] If failed: Send Telegram alert to admin
```

---

## 4. n8n Workflow Design

### 4.1 n8n Architecture Overview

**Deployment Options:**
- **Recommended for Prive**: Self-hosted n8n on EC2 or Kubernetes
- **Alternative**: n8n Cloud (simpler but less control)
- **Future**: Can run on NVIDIA DGX Spark once on-prem AI is ready

**Workflow Structure:**
- 5-6 main workflows (described below)
- Shared subworkflows for common operations
- All workflows are event-driven (triggered by Pub/Sub or schedules)
- No polling, all stateless/idempotent

### 4.2 Workflow 1: Email Triage & Route (Event-Triggered)

**Trigger:** Webhook from Pub/Sub `gmail-jr-incoming`

**Purpose:** Filter JR's incoming emails, apply labels, forward qualified emails to Amanda

**n8n Nodes:**

```yaml
Trigger:
  Type: Webhook
  Method: POST
  Path: /webhook/gmail-jr
  Condition: "Check for valid Pub/Sub message"

Step 1: Parse Pub/Sub Message
  Node: Code
  Input: $json
  Code:
    const message = JSON.parse(Buffer.from(req.body.message.data, 'base64').toString());
    return {
      emailAddress: message.emailAddress,
      historyId: message.historyId
    };

Step 2: Fetch Full Email
  Node: Gmail
  Operation: users.messages.list
  User: jr@privegroup.com
  Query: "is:unread"
  Format: Full
  MaxResults: 10

Step 3: Filter Email
  Node: IF (conditional)
  Conditions:
    - From domain NOT in blacklist [domains]
    - Subject NOT contains ["unsubscribe", "alert"]
    - Size > 100 bytes

Step 4A: Apply Triage Label
  Node: Gmail
  Operation: users.messages.modify
  Predefined labels:
    - AMANDA/QUEUE/deal-screening (if contains: "deal", "property")
    - AMANDA/QUEUE/follow-up (if from known contacts, older than 2 days)
    - AMANDA/QUEUE/legal (if from legal@ domains)
    - STATE/spam (if detected as spam)

Step 4B: Forward to Amanda
  Node: Gmail
  Operation: users.messages.send
  To: amanda@privegroup.com
  Subject: "FW: [Original Subject] [LABEL]"
  Body: "This email was auto-forwarded from Amanda's triage system.\n\nOriginal: [email content]"
  Labels to add: AMANDA/INBOX/forwarded-from-jr

Step 5: Mark Original as Read
  Node: Gmail
  Operation: users.messages.modify
  Remove labels: UNREAD
  Add labels: CTX/processed-by-triage

Step 6: Log Event
  Node: PostgreSQL
  Query: INSERT INTO email_events (timestamp, email_id, action, labels)
         VALUES (NOW(), $messageId, 'triaged', $labels)
```

**Decision Matrix (Label Assignment):**

| Email Characteristic | Applied Label | Next Step |
|---------------------|---------------|-----------|
| Subject: "Deal" OR "Property" | `AMANDA/QUEUE/deal-screening` | Queue for Fast Scan AI |
| From: Known contact + 2+ days old | `AMANDA/QUEUE/follow-up` | Queue for Follow-Up response |
| From: legal@*, attorney, contract | `AMANDA/QUEUE/legal` | Queue for Legal Review (HITL) |
| From: noreply@*, unsubscribe link | `STATE/spam` | Archive immediately |
| Contains appointment link | `AMANDA/QUEUE/schedule` | Queue for Calendar entry |
| Generic inquiry response | `AMANDA/QUEUE/reply-draft` | Queue for Draft reply |

### 4.3 Workflow 2: Email Queue Processing (Event-Triggered)

**Trigger:** Webhook from Pub/Sub `gmail-amanda-incoming` OR on-demand when email labeled with `AMANDA/QUEUE/*`

**Purpose:** Process queued emails from Amanda's inbox, build task JSON, call AI backend, handle HITL gates

**n8n Nodes:**

```yaml
Trigger (Option A):
  Type: Webhook
  Path: /webhook/gmail-amanda

Trigger (Option B):
  Type: Gmail Watch
  Event: Label added (AMANDA/QUEUE/*)

Step 1: Get All Queued Emails
  Node: Gmail
  Operation: users.messages.list
  Query: 'label:AMANDA/QUEUE/*'
  Format: Full
  MaxResults: 10

Step 2: FOR EACH Email
  Node: Loop

  Step 2.1: Extract Queue Type
    Node: Code
    Extract from labels which AMANDA/QUEUE/* label is present
    Output: queueType = "deal-screening" | "follow-up" | "legal" | etc.

  Step 2.2: Extract Email Content
    Node: Code
    Parse email:
      - sender: from address
      - subject: subject line
      - body: email body (strip HTML)
      - attachments: list of file names
      - timestamp: email received date
      - messageId: Gmail message ID

  Step 2.3: Build Task Payload
    Node: Code
    Create JSON object:
      {
        "taskId": UUID,
        "taskType": queueType,
        "emailContext": {
          "messageId": email.id,
          "from": email.from,
          "subject": email.subject,
          "body": email.body,
          "timestamp": email.receivedTime
        },
        "metadata": {
          "account": "amanda@privegroup.com",
          "labels": email.labels,
          "importance": "high/medium/low"
        },
        "amandaContext": {
          "recentMemory": [fetch from PostgreSQL],
          "relatedDeals": [search PostgreSQL for related emails]
        }
      }

  Step 2.4: Check for HITL Gate
    Node: IF
    Condition: taskType == "legal" OR importance == "high"
    YES -> Go to Step 2.5 (HITL)
    NO -> Go to Step 2.6 (Direct AI)

  Step 2.5: HITL Gate (Telegram Approval)
    Node: Telegram
    Message: "📋 Legal Review Required\n\n"
             "From: {sender}\n"
             "Subject: {subject}\n\n"
             "First 500 chars: {body_preview}\n\n"
             "Button 1: ✅ Approve & Process\n"
             "Button 2: ⏸️ Hold for Manual Review\n"
             "Button 3: 🚫 Reject"

    Node: Wait
    Wait for Telegram callback (webhook)
    Timeout: 30 minutes

    If approved -> Continue to Step 2.6
    If rejected -> Move to STATE/rejected label, send reply
    If timeout -> Escalate to JR via Telegram

  Step 2.6: Call AI Backend
    Node: HTTP Request
    Method: POST
    URL: https://api.openai.com/v1/chat/completions (or Claude API)
    Headers: Authorization: Bearer $API_KEY
    Body (JSON):
      {
        "model": "gpt-4" or "claude-3-opus",
        "messages": [
          {
            "role": "system",
            "content": buildSystemPrompt(taskType, amandaContext)
          },
          {
            "role": "user",
            "content": taskPayload.emailContext.body
          }
        ],
        "temperature": 0.3,
        "max_tokens": 2000
      }

  Step 2.7: Parse AI Response
    Node: Code
    Extract from AI response:
      - action: "send_reply" | "create_draft" | "schedule_task" | "escalate"
      - content: generated email/response
      - confidence: confidence score
      - metadata: any additional processing notes

  Step 2.8: Create Gmail Draft
    Node: Gmail
    Operation: users.drafts.create
    To: email.from
    Subject: "Re: " + email.subject
    Body: AI-generated content
    Labels: AMANDA/STATE/draft-created

  Step 2.9: Send Notification
    Node: Telegram
    Message: "✅ Task processed: {taskType}\n"
             "📧 Draft created for: {email.from}\n"
             "📝 Preview: {first_100_chars_of_content}"

    (JR can review and send from Gmail, or approve here to auto-send)

  Step 2.10: Update State Labels
    Node: Gmail
    Operation: users.messages.modify
    Remove: AMANDA/QUEUE/{taskType}
    Add: AMANDA/STATE/processed, STATE/completed-{timestamp}

  Step 2.11: Log Task Completion
    Node: PostgreSQL
    Query: INSERT INTO task_completions
           (task_id, task_type, ai_model, status, created_at)
           VALUES ($taskId, $taskType, 'gpt-4', 'completed', NOW())
```

**System Prompt Template (varies by taskType):**

```python
# For deal-screening:
SYSTEM_PROMPT = """You are Amanda, an expert real estate AI agent for Prive Group.
Your role is to quickly scan incoming deal information and provide a brief assessment.

Respond in this exact JSON format:
{
  "verdict": "STRONG_INTEREST" | "MODERATE_INTEREST" | "PASS",
  "summary": "one sentence summary",
  "key_metrics": ["metric1", "metric2"],
  "recommendation": "next steps",
  "confidence": 0.0 to 1.0
}
"""

# For follow-up:
SYSTEM_PROMPT = """You are Amanda, drafting follow-up emails for the Prive Group team.
Keep responses professional, concise, and action-oriented.
The recipient has not responded to previous communication.
Draft a follow-up that:
1. References the original topic
2. Provides new information or value
3. Includes a clear call-to-action
4. Maintains professional tone

Respond with just the email body text (no subject line).
"""

# For legal:
SYSTEM_PROMPT = """You are Amanda, assisting with legal document review for Prive Group.
DO NOT PROVIDE LEGAL ADVICE. Instead:
1. Extract key terms and dates
2. Flag unusual or missing provisions
3. Highlight areas requiring attorney review
4. List any deadlines or action items

Format response as a structured summary for legal team review.
This will be reviewed by attorney before any action.
"""
```

### 4.4 Workflow 3: Morning Brief (Scheduled Daily)

**Trigger:** Schedule - Daily at 9:00 AM UTC (or configured time)

**Purpose:** Send JR a daily summary of Amanda's activities, pending items, deals processed

**n8n Nodes:**

```yaml
Trigger:
  Type: Schedule
  Frequency: Daily
  Time: 09:00 UTC

Step 1: Get Yesterday's Statistics
  Node: PostgreSQL
  Queries:
    - COUNT(*) FROM email_events WHERE DATE(timestamp) = YESTERDAY
    - COUNT(*) FROM task_completions WHERE DATE(completed_at) = YESTERDAY
    - AVG(ai_confidence) FROM task_completions WHERE DATE = YESTERDAY

Step 2: Get Pending Tasks
  Node: Gmail
  Operation: users.messages.list
  Query: 'label:AMANDA/STATE/draft-created'

  Step 2.1: Count and Summarize
    Node: Code
    Build list of:
      - Draft count
      - Types of drafts (deal-screening, replies, scheduling)
      - Oldest pending draft (waiting time)

Step 3: Get Recent Deals Processed
  Node: PostgreSQL
  Query: SELECT * FROM task_completions
         WHERE task_type = 'deal-screening'
         AND DATE(created_at) = YESTERDAY
         ORDER BY created_at DESC
         LIMIT 5

Step 4: Format Email Report
  Node: Code
  Build HTML email with:
    - Yesterday's summary table
    - Pending drafts awaiting review
    - Top deals from yesterday
    - Key metrics (avg response time, success rate)
    - Next actions

Step 5: Send Email to JR
  Node: Gmail
  Operation: users.messages.send
  To: jr@privegroup.com
  Subject: "📊 Amanda Daily Brief - {DATE}"
  Body: HTML report

Step 6: Create Draft for Review
  Node: Gmail
  Operation: users.drafts.create
  To: jr@privegroup.com
  Subject: "📊 Amanda Daily Brief - {DATE}"
  Body: HTML report
  (This lets JR review before auto-send, or just send immediately)

Step 7: Log Report Sent
  Node: PostgreSQL
  Query: INSERT INTO brief_reports (date_generated, recipient, status)
         VALUES (NOW(), 'jr@privegroup.com', 'sent')
```

**Sample Email Output:**

```
📊 Amanda Daily Brief - March 14, 2026

═══════════════════════════════════════════════════════════

✅ Yesterday's Performance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Emails Processed:        47
Tasks Completed:         34
AI Confidence (avg):     87%
Response Time (avg):     3.2 min

Task Breakdown:
  • Deal Screening:      12 deals (8 strong, 3 moderate, 1 pass)
  • Follow-up Drafts:    15 emails
  • Legal Reviews:       4 (all approved by counsel)
  • Schedule Updates:    3 calendar entries

═══════════════════════════════════════════════════════════

⏳ Pending Approvals
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You have 6 drafts awaiting your review/approval:

1. RE: Highland Park Property Inquiry
   From: investor@example.com (5 hours ago)
   [Preview: "Thank you for your interest..."]
   Status: Ready to send

2. RE: Contract Follow-up
   From: attorney@firm.com (2 hours ago)
   [Preview: "Per our previous discussion..."]
   Status: Ready to send

[Additional 4 pending items...]

═══════════════════════════════════════════════════════════

🔥 Top Deals Yesterday
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STRONG_INTEREST:
  • $2.4M Highland Park Development (David Chen)
  • $1.8M Mixed-Use Downtown (Sarah Martinez)

MODERATE_INTEREST:
  • $900K Commercial Lease (Generic Inquiry)

═══════════════════════════════════════════════════════════

Action Items:
[ ] Review 6 pending drafts
[ ] Contact high-confidence deal leads
[ ] Follow up on legal reviews

Questions? Reply to this email or contact Amanda directly.
```

### 4.5 Workflow 4: Manual Task Trigger (On-Demand)

**Trigger:** HTTP webhook or n8n UI button

**Purpose:** Allow JR to manually trigger Amanda to process a specific email or task

**Use Cases:**
- Manually process an email that wasn't auto-queued
- Re-process a failed task
- Bulk process a label (e.g., all emails from a contact)

**n8n Nodes:**

```yaml
Trigger:
  Type: Webhook
  Method: POST
  Path: /webhook/process-email
  Body:
    {
      "messageId": "Gmail message ID",
      "queueType": "deal-screening|follow-up|legal|etc",
      "priority": "high|medium|low"
    }

Step 1: Fetch Email by MessageId
  Node: Gmail
  Operation: users.messages.get
  MessageId: $json.messageId
  Format: Full

Step 2: Create Task Payload
  Node: Code
  [Same as Workflow 2, Step 2.3]

Step 3: Process Through AI
  Node: Code
  Call main processing workflow
  [Same as Workflow 2, Steps 2.4-2.11]

Step 4: Notify Completion
  Node: Telegram
  Message: "✅ Task processed on demand"
           "Type: {queueType}"
           "Priority: {priority}"
```

### 4.6 Workflow 5: Telegram HITL Callback Handler

**Trigger:** Webhook from Telegram (button clicks from approvals)

**Purpose:** Handle user approvals from Telegram notifications

**n8n Nodes:**

```yaml
Trigger:
  Type: Webhook
  Method: POST
  Path: /webhook/telegram-callback
  Authentication: Telegram webhook secret verification

Step 1: Parse Telegram Update
  Node: Code
  Extract:
    - callback_query_id
    - user_id (verify matches approved admin)
    - data (contains action: approve|reject|hold)
    - message_id
    - inline_keyboard_action

Step 2: Extract Task Context
  Node: Code
  From callback_query.data, extract:
    - taskId
    - emailId
    - taskType
    - action (approve|reject|hold)

Step 3: Route Based on Action
  Node: IF

  IF action == "approve":
    -> Continue with AI processing (resume Workflow 2 Step 2.6)

  IF action == "reject":
    -> Go to Step 4 (Reject Flow)

  IF action == "hold":
    -> Go to Step 5 (Escalate Flow)

Step 4: Reject Flow
  Node: Gmail
  Add label: STATE/rejected-by-hitl
  Add label: CTX/awaiting-manual-review

  Node: Telegram
  Reply to user: "✅ Rejected. Email moved to manual review queue."

Step 5: Escalate/Hold Flow
  Node: Gmail
  Add label: STATE/on-hold
  Remove label: AMANDA/QUEUE/*

  Node: Telegram
  Reply to user: "⏸️ Held for manual review. JR will review when available."

  Node: Telegram (send to JR)
  Message: "⚠️ Task on hold: {taskType}"
           "From: {sender}"
           "Reason: User requested manual review"
           "Action: Review in Gmail under STATE/on-hold"

Step 6: Send Success Confirmation
  Node: Telegram
  Edit message: "✅ {action} - Task processed"
  Remove inline keyboard (disable buttons)
```

### 4.7 Workflow 6: Watch Renewal & Health Check (Scheduled)

**Trigger:** Scheduled - Daily at 3:00 AM UTC

**Purpose:** Renew Gmail watch subscriptions (valid for 7 days), monitor system health

**n8n Nodes:**

```yaml
Trigger:
  Type: Schedule
  Frequency: Daily
  Time: 03:00 UTC

Step 1: Check Watch Status
  Node: Code
  Query Gmail API:
    gmail.users.watch()  // Call watch to refresh
  For both jr@privegroup.com and amanda@privegroup.com

Step 2: Validate Pub/Sub Subscription Health
  Node: Google Cloud Pub/Sub
  Operation: projects.subscriptions.get
  For: gmail-jr-n8n, gmail-amanda-n8n
  Extract: oldestUnackedMessageAge

Step 3: Check n8n Webhook Health
  Node: HTTP Request
  Check that webhook endpoints are responding
  GET /webhook/gmail-jr (should return 200)
  GET /webhook/gmail-amanda (should return 200)

Step 4: Verify Recent Message Processing
  Node: PostgreSQL
  Query: SELECT MAX(timestamp) FROM email_events
  Check: if timestamp > NOW() - INTERVAL '1 hour'
         (meaning emails processed in last hour)

Step 5: Alert if Issues Found
  Node: IF

  IF watch is stale:
    -> Node: Telegram
       Send admin alert: "⚠️ Gmail watch renewal needed"

  IF Pub/Sub has unacked messages:
    -> Node: Telegram
       Send admin alert: "⚠️ Pub/Sub delivery issue detected"

  IF no recent processing:
    -> Node: Telegram
       Send admin alert: "⚠️ No emails processed in last hour"

Step 6: Log Health Status
  Node: PostgreSQL
  Query: INSERT INTO system_health (timestamp, watch_status, pubsub_status, webhook_status)
         VALUES (NOW(), $watchOk, $pubsubOk, $webhookOk)

Step 7: Send Status Report
  Node: Telegram (to admin)
  Message: "✅ Daily health check: All systems operational"
           (Or show warnings if issues found)
```

### 4.8 Additional Workflows

#### Workflow 7: Email Search & Retrieve (On-Demand)

```yaml
Trigger: Webhook with email search criteria
  Path: /webhook/search-emails
  Params: { query, limit, dateFrom, dateTo }

Steps:
  1. Gmail: users.messages.list with query
  2. For each: Extract metadata and format
  3. Return: JSON array of matching emails

Purpose: Support ad-hoc searches, reports, audits
```

#### Workflow 8: Label Archival & Cleanup (Scheduled)

```yaml
Trigger: Schedule - Weekly (Sundays)

Steps:
  1. Find emails with STATE/completed-* labels older than 30 days
  2. Archive them (remove from inbox)
  3. Log cleanup action

Purpose: Keep inbox clean, maintain performance
```

#### Workflow 9: AI Model Failover (On-Error)

```yaml
Trigger: Error in Workflow 2 when calling primary AI (OpenAI)

Steps:
  1. Log OpenAI failure
  2. Retry with backup model (Claude API)
  3. If Claude fails: Store task in PostgreSQL queue for manual processing
  4. Alert admin via Telegram

Purpose: Ensure reliability, graceful degradation
```

---

## 5. Task Queue Design

### 5.1 Label-Based State Machine

Amanda's state machine uses Gmail labels as the source of truth. Instead of polling, workflows are triggered when labels are applied/removed.

**Label Hierarchy:**

```
AMANDA/
  ├── INBOX/
  │   ├── forwarded-from-jr      (Email forwarded from JR's triage)
  │   └── new-from-queue         (New email in Amanda's inbox)
  │
  ├── QUEUE/
  │   ├── deal-screening         (Incoming deal info to evaluate)
  │   ├── follow-up              (Follow-up email needed)
  │   ├── legal                  (Legal review required)
  │   ├── schedule               (Calendar/scheduling task)
  │   ├── reply-draft            (Generic reply needed)
  │   └── urgent                 (High-priority task)
  │
  └── STATE/
      ├── draft-created          (AI draft ready for review)
      ├── awaiting-approval      (HITL gate - pending)
      ├── processing             (Currently being processed)
      ├── completed              (Successfully processed)
      ├── failed                 (Processing failed)
      └── on-hold                (Manually held for review)

STATE/                           (Global state labels)
  ├── processed-by-triage       (Processed by JR's triage)
  ├── completed-{timestamp}     (Completed with date)
  ├── archived-{date}           (Archived after processing)
  ├── rejected-by-hitl          (Rejected at HITL gate)
  └── awaiting-manual-review    (Needs human intervention)

CTX/                            (Context labels)
  ├── deal-{dealId}             (Related to specific deal)
  ├── contact-{contactName}     (From/about specific contact)
  ├── hot-lead                  (High-interest deal)
  ├── legal-review              (Legal involvement)
  └── priority-high             (High priority)
```

### 5.2 State Transitions & Workflows

**State Machine Diagram:**

```
                    ┌─────────────────┐
                    │   Email Inbox   │
                    │    (unread)     │
                    └────────┬────────┘
                             │
                   [Triage Workflow Triggered]
                             │
                    ┌────────v────────┐
                    │ AMANDA/QUEUE/* │ ◄─ Label applied
                    │  (Queued)       │
                    └────────┬────────┘
                             │
                  [Queue Processing Workflow]
                             │
                        ┌────v──────┐
                        │   HITL    │
                        │   Gate    │
                        └────┬──────┘
                             │
                  ┌──────────┴──────────┐
                  │                     │
            [APPROVED]           [REJECTED]
                  │                     │
        ┌─────────v──────────┐  ┌───────v────────┐
        │ AI Processing      │  │ STATE/rejected │
        │ (OpenAI/Claude)    │  │ + Manual queue │
        └─────────┬──────────┘  └────────────────┘
                  │
        ┌─────────v──────────┐
        │ AMANDA/STATE/      │
        │ draft-created      │
        └─────────┬──────────┘
                  │
         [JR Reviews Draft]
                  │
        ┌─────────v──────────┐
        │   Send Email       │
        │   or Archive       │
        └─────────┬──────────┘
                  │
        ┌─────────v──────────────┐
        │ STATE/completed-{ts}   │
        │ + Archive (after 30d)  │
        └────────────────────────┘
```

### 5.3 Event-Driven Triggers (No Polling)

**Instead of:**
```
Every 5 minutes:
  - Check Gmail inbox
  - Look for labels
  - Process if found
```

**Now:**
```
When email arrives:
  → Gmail sends Pub/Sub message (immediate)
  → n8n webhook receives it (instant)
  → Workflow processes immediately
  → State updated in Gmail labels
  → Next workflow triggered if label changed
```

**Trigger Map:**

| Event | Trigger | Workflow |
|-------|---------|----------|
| Email arrives in JR's inbox | Pub/Sub: `gmail-jr-incoming` | Workflow 1 (Triage) |
| Email labeled `AMANDA/QUEUE/*` | Label applied | Workflow 2 (Process) |
| HITL gate action (Telegram) | Webhook: Telegram callback | Workflow 5 (HITL Handler) |
| Daily scheduled task | Cron: 9 AM UTC | Workflow 3 (Morning Brief) |
| Weekly cleanup | Cron: Sunday 2 AM UTC | Workflow 8 (Archival) |
| System health check | Cron: Daily 3 AM UTC | Workflow 6 (Health Check) |

### 5.4 Race Conditions & Idempotency

**Challenge:** Multiple workflows might process the same email concurrently.

**Solution:** Make all workflows idempotent:

```javascript
// In each workflow Step 1, check if already processed:

Node: PostgreSQL
Query: SELECT * FROM task_completions
       WHERE email_id = $messageId
       AND task_type = $currentTaskType

IF found:
  -> Return cached result (don't process again)
ELSE:
  -> Process normally and cache result
```

**Alternative:** Use Pub/Sub deadletter queue:

```
Pub/Sub Subscription settings:
  - Enable dead-letter topic: "gmail-jr-deadletter"
  - Max delivery attempts: 5
  - Max ack deadline: 60 seconds

This ensures:
  - If workflow fails: message retries
  - If workflow hangs: timeout + retry
  - If workflow fails 5x: moved to deadletter for manual review
```

---

## 6. HITL (Human-In-The-Loop) Integration

### 6.1 Approval Gates & Telegram Bot

Amanda needs human approval for:
- Legal-related emails (potential contractual obligations)
- High-value deals (above threshold)
- Emails from unknown senders
- Drafts making binding commitments

**Telegram Bot Setup:**

1. Create bot via @BotFather on Telegram
   - Bot name: `amanda-approval-bot`
   - Username: `@amanda_approval_bot`
   - Get bot token: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`

2. Configure webhook in n8n:
   - Go to n8n → Telegram node
   - Paste bot token
   - Telegram will validate and establish webhook

3. Create Telegram group for approvals:
   - Group name: `Amanda Approvals`
   - Add bot to group
   - Add JR and other approvers to group

### 6.2 HITL Workflow

**Workflow 2, Step 2.5 (HITL Gate) - Detailed:**

```yaml
HITL Gate Trigger:
  Condition: IF taskType == "legal"
             OR importance == "HIGH"
             OR (taskType == "deal-screening" AND value > $threshold)

Step 1: Build Telegram Message
  Node: Code
  Create inline keyboard:
    [
      [{"text": "✅ Approve", "callback_data": "approve|{taskId}"}],
      [{"text": "⏸️ Hold", "callback_data": "hold|{taskId}"}],
      [{"text": "🚫 Reject", "callback_data": "reject|{taskId}"}]
    ]

Step 2: Send Message to Telegram
  Node: Telegram
  Type: Message with inline keyboard
  Chat ID: {telegram_group_id}
  Text:
    "🔐 APPROVAL REQUIRED\n"
    "Type: {taskType}\n"
    "From: {sender}\n"
    "Subject: {subject}\n"
    "Preview: {first_200_chars}\n"
    "Importance: {importance}\n\n"
    "Please approve or reject below:"

  InlineKeyboard: [approve, hold, reject buttons]

Step 3: Wait for Response
  Node: Wait
  Wait for webhook callback from Telegram
  Timeout: 30 minutes
  Handler: Workflow 5 (Telegram HITL Callback)

Step 4: Resume on Callback
  Node: Code
  Check callback response from Workflow 5

  IF approved:
    -> Continue to Step 2.6 (AI Processing)

  IF rejected:
    -> Label: STATE/rejected-by-hitl
    -> Send reply: "Thank you, but this request was declined."
    -> End workflow

  IF hold:
    -> Label: STATE/on-hold
    -> Send Telegram to JR: "Task on hold, review manually"
    -> End workflow

  IF timeout (30 min, no response):
    -> Send reminder Telegram
    -> Wait another 30 min
    -> If still no response: Auto-escalate to JR with ⚠️ tag
```

### 6.3 HITL Approval Rules

**Decision Logic:**

```python
def requires_hitl_approval(email, task_type):
    """Determine if email requires human approval"""

    # Always require approval for legal
    if task_type == "legal":
        return True

    # Require for high-value deals
    if task_type == "deal-screening":
        if extract_deal_value(email) > THRESHOLD_AMOUNT:  # e.g., $2M
            return True

    # Require for unknown senders
    if email.from not in KNOWN_CONTACTS:
        if task_type in ["legal", "schedule", "commitments"]:
            return True

    # Require if email makes binding commitments
    commitment_keywords = ["agree", "commit", "contract", "terms", "obligate"]
    if any(kw in email.body.lower() for kw in commitment_keywords):
        if task_type != "deal-screening":  # DS doesn't make commitments
            return True

    return False
```

### 6.4 SLA & Escalation

**Escalation Policy:**

```
First Notification:    Telegram to Amanda Approvals group
                       Expected response: 5 minutes

Second Notification:   Same group, with @JR mention (if > 10 min)
                       Expected response: 15 minutes

Escalation:            If > 30 min, auto-escalate
                       1. Send email to JR with task details
                       2. Mark as ESCALATED in logs
                       3. Move to STATE/escalated
                       4. Telegram alert to JR: "⚠️ ESCALATION"

Manual Intervention:   JR can manually approve/reject in Gmail
                       by adding/removing labels directly
```

---

## 7. AI Backend Integration

### 7.1 API Choices

**Primary Option: OpenAI API (GPT-4)**
- **Pros**: Excellent for deal analysis, writing emails, general reasoning
- **Cons**: API costs, rate limits, no local on-prem option
- **Best for**: Email drafting, deal screening initial assessment, follow-ups

**Secondary Option: Anthropic Claude API**
- **Pros**: Strong reasoning, excellent at complex legal analysis
- **Cons**: Newer, less integration examples
- **Best for**: Legal review tasks, contract analysis, nuanced decisions

**Future: NVIDIA DGX Spark (Local LLM)**
- **When ready**: Replace API calls with local inference
- **Models**: Llama 2, Mistral, or other open-source models
- **Benefits**: No API costs, complete privacy, full control

### 7.2 API Integration in n8n

**Workflow 2, Step 2.6 - Detailed (AI Backend Call):**

```yaml
Step 2.6A: Prepare API Request
  Node: Code
  Input: taskPayload (from Step 2.3)

  systemPrompt = buildSystemPrompt(taskType, amandaContext)
  userMessage = taskPayload.emailContext.body

  maxTokens = {
    "deal-screening": 500,
    "follow-up": 1500,
    "legal": 2000,
    "reply-draft": 1000
  }[taskType]

Step 2.6B: Call OpenAI API
  Node: HTTP Request
  Method: POST
  URL: https://api.openai.com/v1/chat/completions

  Headers:
    Authorization: Bearer $OPENAI_API_KEY
    Content-Type: application/json

  Body (JSON):
  {
    "model": "gpt-4",
    "messages": [
      {
        "role": "system",
        "content": systemPrompt
      },
      {
        "role": "user",
        "content": userMessage
      }
    ],
    "temperature": 0.3,
    "max_tokens": maxTokens,
    "top_p": 1.0,
    "frequency_penalty": 0,
    "presence_penalty": 0
  }

Step 2.6C: Handle API Response
  Node: Code

  Extract:
    - response.choices[0].message.content (the AI response)
    - response.usage.total_tokens (for tracking costs)
    - response.id (for logging)

  Store in database:
    INSERT INTO ai_requests
    (task_id, model, tokens_used, cost, response_time, status)

Step 2.6D: Error Handling
  Node: IF (error handling)

  IF HTTP status != 200:
    -> Log error
    -> IF status == 429 (rate limit):
         - Retry with exponential backoff
         - Max retries: 3
    -> IF status == 401/403 (auth):
         - Alert admin: Invalid API key
         - Escalate task
    -> ELSE:
         - Retry after 30 seconds
         - If persistent: Use fallback (see 7.3)

Step 2.6E: Cost Tracking
  Node: Code

  tokens = response.usage.total_tokens
  cost = (tokens / 1000) * COST_PER_1K_TOKENS

  INSERT INTO ai_costs (date, model, tokens, cost)

  (Track spending to monitor budget)
```

### 7.3 Fallback Strategy

**If Primary AI Fails:**

```yaml
Fallback 1: Use Backup AI Model (Claude)
  Node: HTTP Request
  URL: https://api.anthropic.com/v1/messages
  Model: claude-3-opus-20240229

  IF Claude also fails:
    -> Fallback 2 (below)

Fallback 2: Use Template-Based Response
  Node: Code

  IF taskType == "deal-screening":
    response = """
    Unable to reach AI backend. Please review manually.

    Key details:
    From: {sender}
    Subject: {subject}
    Date: {date}

    Type: {taskType}
    """

  -> Create draft with template response
  -> Label: STATE/draft-created-with-template
  -> Alert admin: "AI unavailable, used template"

Fallback 3: Queue for Manual Processing
  Node: PostgreSQL

  INSERT INTO manual_queue
  (email_id, task_type, reason, created_at)
  VALUES ($emailId, $taskType, 'ai_unavailable', NOW())

  Send Telegram to admin:
  "⚠️ AI backend unavailable. Task queued for manual review."
```

### 7.4 Cost Optimization

**Strategies to Control API Spend:**

```yaml
1. Token Budgeting
   - Set max tokens per task type
   - Use summarization for long emails

2. Model Selection
   - Use GPT-3.5-Turbo for simple tasks (10x cheaper)
   - Use GPT-4 only for complex/legal tasks

3. Batching
   - Batch similar tasks to same API call
   - Process multiple emails in one request (if related)

4. Caching
   - Cache responses for identical queries
   - Reuse response for similar emails

5. Rate Limiting
   - Limit requests per hour
   - Queue excess requests for next hour

6. Budget Alerts
   - Alert if daily spend exceeds threshold
   - Auto-disable if monthly budget exceeded
```

**n8n Implementation:**

```yaml
Step: Cost Control (Before AI Request)
  Node: PostgreSQL

  Query: SELECT SUM(cost) FROM ai_costs
         WHERE DATE(timestamp) = TODAY

  IF daily_cost > DAILY_BUDGET:
    -> Skip AI call
    -> Use template response
    -> Queue for next day
    -> Alert: "Daily budget exceeded"

  IF monthly_cost > MONTHLY_BUDGET:
    -> STOP all AI requests
    -> Switch to fallback mode
    -> ALERT ADMIN IMMEDIATELY
```

### 7.5 System Prompt Engineering

**Prompt Strategy for Different Task Types:**

```python
# DEAL SCREENING - Fast, decisive
SYSTEM_PROMPTS["deal-screening"] = """
You are Amanda, an expert real estate analyst for Prive Group.
Evaluate this deal quickly and provide a clear verdict.

Respond ONLY with valid JSON (no extra text):
{
  "verdict": "STRONG_INTEREST" | "MODERATE_INTEREST" | "PASS",
  "summary": "one sentence (max 20 words)",
  "key_metrics": ["metric1", "metric2", "metric3"],
  "red_flags": ["flag1", "flag2"] or [],
  "next_steps": "single action item",
  "confidence": 0.65 to 1.0
}

Be concise. Prioritize: Location, Price, Deal Type, Investor Profile.
"""

# FOLLOW-UP - Professional, value-adding
SYSTEM_PROMPTS["follow-up"] = """
You are Amanda, drafting professional follow-up emails for Prive Group.

Write a concise follow-up email (2-3 paragraphs max) that:
1. References the original discussion
2. Adds new value or information
3. Includes a clear, single call-to-action
4. Maintains professional, warm tone
5. Is NOT pushy or over-eager

Recipient has not responded to previous communication.
Write only the email body (no subject line, no signature).
Keep under 200 words.
"""

# LEGAL REVIEW - Careful, structured
SYSTEM_PROMPTS["legal"] = """
You are Amanda assisting with legal document review.
⚠️  DO NOT PROVIDE LEGAL ADVICE. You assist only.

Analyze this document and provide a structured review:

KEY TERMS:
- [extract important dates, amounts, parties]

MISSING PROVISIONS:
- [note anything that seems missing]

RED FLAGS:
- [unusual or concerning language]

QUESTIONS FOR ATTORNEY:
- [list 3-5 questions attorney should review]

ACTION ITEMS:
- [any time-sensitive deadlines]

FORMAT: Use clear sections, bullet points.
TONE: Professional, analytical.
NOTE: This is for attorney review - they make final decisions.
"""

# REPLY DRAFT - Balanced, helpful
SYSTEM_PROMPTS["reply-draft"] = """
You are Amanda drafting email replies for Prive Group.

Draft a helpful, professional response to this inquiry.
- Match the sender's tone
- Be helpful and warm
- Include next steps if appropriate
- Keep it concise (1-2 paragraphs)

Write only the email body (no subject, no signature).
"""
```

---

## 8. Persistent Memory Layer (Amanda's Context)

### 8.1 Purpose & Design

Amanda needs to remember:
- Previous conversations with contacts
- Details about ongoing deals
- Context about relationships
- Task outcomes and learnings
- Patterns in email types

**Implementation: PostgreSQL with JSON context**

### 8.2 Schema

```sql
-- Core tables for Amanda's memory

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  organization VARCHAR(255),
  relationship_type VARCHAR(50),
  first_contact_date TIMESTAMP,
  last_contact_date TIMESTAMP,
  total_interactions INTEGER DEFAULT 0,
  tags JSON DEFAULT '[]',  -- e.g., ["investor", "hot_lead", "follow_up_needed"]
  context JSON,  -- Custom notes/metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_name VARCHAR(255) NOT NULL,
  deal_id VARCHAR(100) UNIQUE,
  status VARCHAR(50),  -- lead, active, closed, passed
  value DECIMAL(12, 2),
  location VARCHAR(255),
  deal_type VARCHAR(100),  -- residential, commercial, development, etc.
  contact_id UUID REFERENCES contacts(id),
  metadata JSON,  -- Property details, investment terms, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id VARCHAR(255) UNIQUE,
  message_id VARCHAR(255),
  sender_email VARCHAR(255),
  sender_contact_id UUID REFERENCES contacts(id),
  subject VARCHAR(500),
  received_at TIMESTAMP,
  labels JSON DEFAULT '[]',
  task_types JSON DEFAULT '[]',
  action VARCHAR(100),  -- triaged, processed, archived
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id VARCHAR(255) UNIQUE,
  task_type VARCHAR(50),  -- deal-screening, follow-up, legal, etc.
  email_id VARCHAR(255),
  contact_id UUID REFERENCES contacts(id),
  ai_model VARCHAR(100),  -- gpt-4, claude-3, etc.
  ai_response JSONB,
  status VARCHAR(50),  -- completed, failed, escalated
  approval_status VARCHAR(50),  -- approved, rejected, on-hold
  approved_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ai_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES task_completions(id),
  model VARCHAR(100),
  tokens_used INTEGER,
  cost DECIMAL(8, 4),
  request_time_ms INTEGER,
  status VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE,
  recent_deals JSONB,  -- Last 5 active deals
  key_contacts JSONB,  -- Most frequent contacts
  recent_patterns JSONB,  -- Task patterns from last 7 days
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_last_contact ON contacts(last_contact_date);
CREATE INDEX idx_deals_status ON deals(status);
CREATE INDEX idx_email_events_sender ON email_events(sender_email);
CREATE INDEX idx_task_completions_contact ON task_completions(contact_id);
CREATE INDEX idx_task_completions_task_type ON task_completions(task_type);
```

### 8.3 Memory Population Workflow

**Workflow: Update Amanda's Memory (Triggered after each task)**

```yaml
Trigger: After Workflow 2, Step 2.11 (after task completion)

Step 1: Extract Contact Info
  Node: Code
  From email:
    - email_from (sender email)
    - sender_name (from email header)
    - organization (inferred from email domain)

  Output: contact object

Step 2: Update/Insert Contact
  Node: PostgreSQL

  Query:
    INSERT INTO contacts (email, name, organization, last_contact_date)
    VALUES ($email_from, $sender_name, $organization, NOW())
    ON CONFLICT (email) DO UPDATE SET
      last_contact_date = NOW(),
      total_interactions = total_interactions + 1
    RETURNING id;

Step 3: Extract Deal Info (if applicable)
  Node: Code

  IF taskType == "deal-screening":
    - Parse email for deal name, location, value
    - Extract deal_type (residential, commercial, etc.)
    - Get contact_id from step 2

  ELSE:
    - Skip deal extraction

Step 4: Update Deal Record
  Node: PostgreSQL

  Query:
    INSERT INTO deals (deal_name, value, location, contact_id, status)
    VALUES ($deal_name, $value, $location, $contact_id, 'lead')
    ON CONFLICT (deal_id) DO UPDATE SET
      status = 'active',
      updated_at = NOW()
    RETURNING id;

Step 5: Log Task in Email Events
  Node: PostgreSQL

  Query:
    INSERT INTO email_events
    (email_id, sender_email, sender_contact_id, subject, labels, task_types, action)
    VALUES ($messageId, $sender_email, $contact_id, $subject, $labels, $task_types, 'processed');

Step 6: Log Task Completion with AI Details
  Node: PostgreSQL

  Query:
    INSERT INTO task_completions
    (task_id, task_type, email_id, contact_id, ai_model, ai_response, status, approved_by)
    VALUES ($taskId, $taskType, $messageId, $contact_id, $aiModel, $aiResponse_json, $status, $approvedBy);

Step 7: Update Contact Memory on Demand
  Node: Code

  (Once per week or on-demand)
  Generate memory snapshot from database:
    - Recent deals (last 7 days)
    - Key contacts (most frequent, highest value)
    - Patterns (task types, deal types, patterns)

  Store in memory_snapshots table
```

### 8.4 Memory Retrieval in AI Processing

**In Workflow 2, Step 2.3 (Build Task Payload):**

```yaml
Step: Add Context to Task Payload
  Node: PostgreSQL

  Query 1: Get contact history
    SELECT * FROM contacts WHERE email = $sender_email

  Query 2: Get recent interactions
    SELECT * FROM email_events
    WHERE sender_email = $sender_email
    ORDER BY received_at DESC
    LIMIT 10

  Query 3: Get related deals
    SELECT * FROM deals
    WHERE contact_id = $contact_id
    AND status IN ('active', 'lead')

  Query 4: Get recent memory snapshot
    SELECT * FROM memory_snapshots
    ORDER BY date DESC
    LIMIT 1

Step: Build Context String
  Node: Code

  amandaContext = {
    "senderHistory": [
      "Recent interaction: {date} - {summary}",
      "Known deals: {deal_names}",
      "Relationship level: {level}",
      "Total interactions: {count}"
    ],
    "recentPatterns": {
      "frequency": "monthly interactions",
      "primaryTopics": ["deals", "follow-ups"],
      "responseTime": "average 24 hours"
    }
  }

  Include in task payload to AI model

Step: Add to System Prompt
  Node: Code

  systemPrompt += f"""

  CONTEXT ABOUT SENDER:
  - Email: {sender.email}
  - Organization: {sender.organization}
  - Relationship: {relationship_type}
  - Previous interactions: {total_interactions}

  RECENT DEALS WITH THIS CONTACT:
  {deals_summary}

  Use this context to tailor your response.
  """
```

### 8.5 Memory Maintenance

**Weekly Memory Cleanup (Workflow 8):**

```yaml
Trigger: Schedule - Weekly (Sundays, 2 AM)

Step 1: Archive Old Contact Records
  Query: DELETE FROM contacts
         WHERE last_contact_date < NOW() - INTERVAL '180 days'
         AND total_interactions < 2
  (Keep only meaningful relationships)

Step 2: Summarize Completed Deals
  Query: UPDATE deals
         SET status = 'archived'
         WHERE status = 'closed'
         AND updated_at < NOW() - INTERVAL '90 days'

Step 3: Generate Weekly Memory Snapshot
  Query:
    INSERT INTO memory_snapshots (date, recent_deals, key_contacts, recent_patterns)
    SELECT
      CURRENT_DATE,
      (SELECT JSON_AGG(...) FROM deals WHERE status IN ('active', 'lead')),
      (SELECT JSON_AGG(...) FROM contacts WHERE total_interactions > 5),
      (SELECT JSON_AGG(...) FROM task_completions WHERE created_at > NOW() - INTERVAL '7 days')

Step 4: Prune AI Interactions Log
  Query: DELETE FROM ai_interactions
         WHERE created_at < NOW() - INTERVAL '90 days'
  (Keep only recent interactions for learning)
```

---

## 9. Morning Brief Workflow (Daily)

### 9.1 Detailed Workflow (Workflow 3 - Expanded)

See Section 4.4 for detailed nodes and implementation.

**Output Example:**

The workflow sends a formatted daily email to JR at 9:00 AM UTC containing:

```
📊 Amanda Daily Brief - March 14, 2026

PERFORMANCE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Emails Processed:      47
Tasks Completed:       34
AI Confidence Avg:     87%
Response Time Avg:     3.2 min

BY TASK TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Deal Screening:     12 deals
  - Strong Interest:  8 deals
  - Moderate:         3 deals
  - Pass:             1 deal

✓ Follow-up Drafts:   15 emails

✓ Legal Reviews:      4 (4/4 approved)

✓ Scheduling:         3 calendar entries

PENDING ACTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Drafts Awaiting Review:  6
  - Ready to send:       6
  - On hold:             0
  - Failed:              0

Top Pending:
1. RE: Highland Park Property (5 hours)
2. RE: Contract Follow-up (2 hours)

TOP DEALS YESTERDAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 STRONG INTEREST (8)
  • $2.4M Highland Park Development
    From: David Chen
    Confidence: 95%

  • $1.8M Mixed-Use Downtown
    From: Sarah Martinez
    Confidence: 92%

⭐ MODERATE (3)
  • $900K Commercial Lease
    From: Generic Inquiry
    Confidence: 72%

DAILY METRICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Response Latency:      2.1 min avg (target: < 5 min)
API Usage:             234 calls (quota: 250,000/day)
Cost (AI):             $12.47 (GPT-4: $7.81, Claude: $4.66)
System Health:         ✅ All systems operational

WEEKLY TREND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mon: 45 emails, 32 tasks, 86% confidence
Tue: 38 emails, 28 tasks, 84% confidence
Wed: 42 emails, 31 tasks, 88% confidence
Thu: 51 emails, 37 tasks, 89% confidence
Fri: 47 emails, 34 tasks, 87% confidence (today)

NOTES FOR JR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• No system issues detected
• API usage well within quota
• Legal review approval rate: 100%
• All escalated tasks resolved

NEXT ACTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Review 6 pending drafts
□ Follow up on 8 strong-interest deals
□ Check legal review approvals
□ Update calendar with scheduled items

Reply with questions or react with 👍 to acknowledge.
```

### 9.2 Database Queries for Brief

```sql
-- Total emails processed yesterday
SELECT COUNT(*) as total_emails
FROM email_events
WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day';

-- Tasks by type
SELECT
  task_type,
  COUNT(*) as count,
  AVG(CAST(ai_response->>'confidence' AS FLOAT)) as avg_confidence
FROM task_completions
WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
GROUP BY task_type;

-- Top deals (for deal-screening tasks)
SELECT
  tc.ai_response,
  tc.created_at,
  c.name,
  c.email
FROM task_completions tc
JOIN contacts c ON tc.contact_id = c.id
WHERE tc.task_type = 'deal-screening'
  AND DATE(tc.created_at) = CURRENT_DATE - INTERVAL '1 day'
  AND tc.ai_response->>'verdict' = 'STRONG_INTEREST'
ORDER BY CAST(tc.ai_response->>'confidence' AS FLOAT) DESC
LIMIT 10;

-- Pending drafts
SELECT COUNT(*) as pending_drafts
FROM email_events
WHERE 'AMANDA/STATE/draft-created' = ANY(labels)
  AND created_at > NOW() - INTERVAL '7 days';

-- 7-day trend
SELECT
  DATE(created_at) as date,
  COUNT(*) as email_count,
  SUM(CASE WHEN task_types IS NOT NULL THEN 1 ELSE 0 END) as task_count
FROM email_events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Cost summary
SELECT
  model,
  COUNT(*) as requests,
  SUM(tokens_used) as total_tokens,
  SUM(cost) as total_cost
FROM ai_interactions
WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
GROUP BY model;
```

---

## 10. Migration Plan

### 10.1 Pre-Migration Checklist

**Week 0: Planning & Preparation**

- [ ] Review current GAS code and document existing logic
- [ ] Identify all label patterns and state transitions
- [ ] Map Gmail quotas and current usage patterns
- [ ] Plan downtime window (suggest: Sunday night, 2-4 AM UTC)
- [ ] Brief JR and stakeholders on changes
- [ ] Set up staging environment for testing

**Infrastructure Prep:**

- [ ] Spin up n8n instance (EC2, Kubernetes, or cloud)
- [ ] Create GCP project and enable APIs
- [ ] Create service accounts and obtain credentials
- [ ] Create Pub/Sub topics and subscriptions
- [ ] Set up PostgreSQL database (or Supabase)
- [ ] Configure Telegram bot and group
- [ ] Obtain API keys: OpenAI, Claude, Gmail

### 10.2 Phase 1: Setup & Configuration (Week 1-2)

**Task 1.1: n8n Installation & Configuration**

```bash
# Option A: Docker on EC2
docker run -d \
  --name n8n \
  -p 5678:5678 \
  -e DB_TYPE=postgres \
  -e DB_POSTGRESDB_HOST=postgres.internal \
  -e DB_POSTGRESDB_PORT=5432 \
  -e DB_POSTGRESDB_DATABASE=n8n \
  -e DB_POSTGRESDB_USER=n8n \
  -e DB_POSTGRESDB_PASSWORD=$DB_PASSWORD \
  -e WEBHOOK_URL=https://n8n.yourdomain.com \
  n8nio/n8n

# Option B: Kubernetes
helm repo add n8n https://8gears.container-registry.com/chartrepo/public
helm install n8n n8n/n8n
```

**Task 1.2: GCP Configuration**

```bash
# Create service account
gcloud iam service-accounts create amanda-n8n-service

# Grant roles
gcloud projects add-iam-policy-binding prive-amanda-prod \
  --member="serviceAccount:amanda-n8n-service@prive-amanda-prod.iam.gserviceaccount.com" \
  --role="roles/pubsub.admin"

# Create key
gcloud iam service-accounts keys create credentials.json \
  --iam-account=amanda-n8n-service@prive-amanda-prod.iam.gserviceaccount.com

# Create Pub/Sub topics
gcloud pubsub topics create gmail-jr-incoming --project=prive-amanda-prod
gcloud pubsub topics create gmail-amanda-incoming --project=prive-amanda-prod

# Create subscriptions
gcloud pubsub subscriptions create gmail-jr-n8n \
  --topic=gmail-jr-incoming \
  --push-endpoint=https://n8n.yourdomain.com/webhook/gmail-jr \
  --project=prive-amanda-prod

gcloud pubsub subscriptions create gmail-amanda-n8n \
  --topic=gmail-amanda-incoming \
  --push-endpoint=https://n8n.yourdomain.com/webhook/gmail-amanda \
  --project=prive-amanda-prod
```

**Task 1.3: Database Setup**

```bash
# Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE amanda_prod;"

# Initialize schema (run all CREATE TABLE statements from Section 8.2)
psql -U postgres -d amanda_prod < schema.sql

# Create indexes
psql -U postgres -d amanda_prod < indexes.sql
```

**Task 1.4: Configure API Credentials in n8n**

In n8n UI:
1. Go to "Credentials" (gear icon)
2. Add credentials:
   - Google OAuth (for Gmail)
   - OpenAI API key
   - Anthropic Claude API key
   - PostgreSQL connection
   - Telegram Bot token
   - Google Cloud service account (JSON)

### 10.3 Phase 2: Build & Test Core Workflows (Week 2-3)

**Task 2.1: Build Workflow 0 (Watch Renewal)**

- [ ] Create scheduled trigger (daily 3 AM)
- [ ] Add Gmail watch() call for both accounts
- [ ] Add error handling and Telegram alerts
- [ ] Test with manual trigger
- [ ] Verify watch is renewed

**Task 2.2: Build Workflow 1 (Email Triage)**

- [ ] Create webhook listener for `gmail-jr-incoming`
- [ ] Implement Pub/Sub message parsing
- [ ] Add email filtering logic
- [ ] Implement label assignment rules
- [ ] Test with sample emails
- [ ] Verify email forwarding to Amanda

**Task 2.3: Build Workflow 2 (Queue Processing)**

- [ ] Create webhook listener for `gmail-amanda-incoming`
- [ ] Implement task payload building
- [ ] Add HITL gate logic (Telegram approval)
- [ ] Implement AI backend calls (OpenAI/Claude)
- [ ] Add draft creation in Gmail
- [ ] Add state label updates
- [ ] Add PostgreSQL logging
- [ ] Test with sample tasks

**Task 2.4: Build Workflow 3 (Morning Brief)**

- [ ] Create daily schedule (9 AM UTC)
- [ ] Implement all database queries
- [ ] Build HTML email template
- [ ] Test email formatting
- [ ] Verify delivery to JR

**Task 2.5: Build Workflow 5 (HITL Telegram Handler)**

- [ ] Create Telegram webhook listener
- [ ] Implement callback parsing
- [ ] Add approval/rejection logic
- [ ] Test button clicks
- [ ] Verify task resumption

**Testing Protocol for Each Workflow:**

```
For each workflow:
1. Create test email manually
2. Trigger workflow manually via "Execute" button
3. Verify each step runs correctly
4. Check database entries created
5. Verify Gmail labels applied correctly
6. Check Telegram notifications sent
7. Verify AI calls made (check API logs)
8. Validate final state
9. Document any issues
10. Fix and re-test
```

### 10.4 Phase 3: Parallel Running (Week 3-4)

**Run both old (GAS) and new (n8n) systems in parallel:**

```
┌─────────────────────────────────────────────────────────┐
│  PARALLEL RUNNING PERIOD (1-2 weeks)                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Gmail Inbox                                            │
│  ├── Triggers GAS scripts (old) - Continue running      │
│  └── Triggers n8n webhooks (new) - Monitor & verify     │
│                                                          │
│  Workflow Execution                                     │
│  ├── GAS: Processes emails as before                    │
│  ├── n8n: Processes same emails in parallel             │
│  └── COMPARE: Results should be identical               │
│                                                          │
│  Monitoring                                             │
│  ├── GAS logs: Check for errors                         │
│  ├── n8n execution: Track success rate                  │
│  ├── Gmail API quota: Monitor usage                     │
│  ├── Database: Verify all entries created               │
│  └── AI costs: Track spending                           │
│                                                          │
│  GATE: If success rate < 95% -> DO NOT PROCEED         │
│        Fix issues and re-test before cutover            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Validation Checklist:**

- [ ] n8n processes 100% of emails that GAS processes
- [ ] Labels applied identically in both systems
- [ ] Draft creation matches
- [ ] Telegram notifications working
- [ ] AI responses reasonable quality
- [ ] Database entries accurate
- [ ] No duplicate processing
- [ ] Error handling works
- [ ] Latency < 30 seconds per email
- [ ] API quotas not exceeded
- [ ] Costs within budget

### 10.5 Phase 4: Cutover & GAS Deactivation (Week 4)

**Step 1: Final Verification**

```
Last check before cutover:
- All Workflow tests passing ✓
- n8n monitoring dashboard active ✓
- Runbook prepared for rollback ✓
- Team briefed and on standby ✓
- Backup of GAS scripts created ✓
- Database backup taken ✓
```

**Step 2: Cutover Window (Sunday 2-4 AM UTC)**

```
Time: Sunday, 2:00 AM UTC
Duration: Max 2 hours
Backup: Yes (full DB snapshot)

Actions:
1. 01:55 - Notify team, start monitoring
2. 02:00 - Disable GAS time-based triggers
   - Edit each trigger in GAS to disable
   - Do NOT delete (keep as backup)
3. 02:05 - Verify n8n workflows active
   - Check webhook listeners online
   - Verify Pub/Sub subscriptions ready
4. 02:10 - Begin sending test emails
   - Send to jr@privegroup.com
   - Send to amanda@privegroup.com
   - Monitor processing in real-time
5. 02:30 - If all tests pass: CUTOVER COMPLETE
6. 03:00 - Monitoring period (watch system for 1 hour)
7. 04:00 - Send all-clear notification to team
```

**Step 3: Rollback Plan (if needed)**

```
IF critical issue detected:

1. Immediately re-enable GAS triggers
   - Go to each Apps Script project
   - Edit triggers to ACTIVE
   - Verify they execute on schedule

2. Disable n8n workflows
   - Set to "inactive" state
   - Keep configured (don't delete)

3. Investigate issue
   - Review n8n execution logs
   - Check database for errors
   - Verify API credentials

4. Fix and re-test
   - Don't retry cutover same night
   - Schedule for next Sunday after fixes

5. Communicate delay to team
```

### 10.6 Phase 5: Post-Cutover Monitoring (Week 4+)

**First 24 Hours:**

```yaml
Monitoring Frequency: Every 15 minutes

Checks:
  - n8n dashboard: All workflows executing
  - Telegram notifications: Being sent correctly
  - Gmail labels: Applied correctly
  - Database: New records being created
  - API usage: Within quotas
  - Error rate: < 1%

Dashboards:
  - n8n built-in monitoring
  - Custom dashboard in Grafana/DataDog
  - PostgreSQL query monitoring
  - Gmail API quota dashboard
```

**First Week:**

```yaml
Monitoring Frequency: Daily

Checks:
  - Total emails processed
  - Task completion rate
  - AI confidence scores
  - HITL approval rate
  - API costs
  - Error trends
  - Email latency

Weekly Review Meeting:
  - Summary of processing
  - Any issues encountered
  - Performance vs. baseline
  - Optimization opportunities
  - User feedback
```

**Ongoing Monitoring (After Week 1):**

```yaml
Monitoring Frequency: Weekly

Dashboards:
  - n8n workflow stats
  - Email processing volume
  - Task completion trends
  - AI cost tracking
  - System health metrics

Weekly Report Includes:
  - Total emails: {count}
  - Avg. latency: {milliseconds}
  - Task types: {breakdown}
  - Success rate: {percentage}
  - HITL approval rate: {percentage}
  - API cost: ${amount}
  - Any issues/escalations: {list}

Quarterly Deep Dive:
  - Performance trends
  - Optimization opportunities
  - Cost analysis
  - User satisfaction
  - Feature requests
```

### 10.7 Decommissioning Old System (Week 4+)

**After 2 weeks of stable operation:**

```
Actions:
1. Back up all GAS code & execution logs
   - Export scripts from Apps Script UI
   - Save as JSON/text files
   - Store in Google Cloud Storage

2. Keep GAS projects but disable all triggers
   - Set trigger to DISABLED (don't delete)
   - Keep scripts as reference

3. Document any custom logic
   - Create runbook for custom features
   - Link to n8n equivalent workflows

4. After 30 days of stable n8n operation:
   - Archive GAS projects
   - Remove from active development
   - Consider deleting if absolutely no regression

5. Update documentation
   - Remove references to GAS
   - Update team guides to use n8n
   - Archive old runbooks
```

---

## 11. Google Cloud Setup Steps (Console)

### 11.1 Step-by-Step GCP Console Navigation

**Access GCP:**
1. Go to https://console.cloud.google.com/
2. Sign in with Prive Group Google account
3. Select project: `prive-amanda-prod`

**Enable APIs:**

1. **In left sidebar**: Click "APIs & Services" → "Library"
2. **Search and enable**:
   - "Gmail API" → Click result → "Enable"
   - "Cloud Pub/Sub API" → Click result → "Enable"
   - "Cloud Logging API" → Click result → "Enable"

**Create Service Account:**

1. **In left sidebar**: "APIs & Services" → "Credentials"
2. **Click**: "Create Credentials" → "Service Account"
3. **Fill in**:
   - Service account name: `amanda-n8n-service`
   - ID: `amanda-n8n-service` (auto)
4. **Click**: "Create and Continue"
5. **Grant roles**:
   - Click "Grant roles to this service account"
   - Add role: "Pub/Sub Editor"
   - Add role: "Cloud Logging Admin"
6. **Click**: "Continue" → "Done"
7. **Create key**:
   - Back on Credentials page
   - Find `amanda-n8n-service` in list
   - Click on it
   - Go to "Keys" tab
   - "Add Key" → "Create new key"
   - Key type: "JSON"
   - Click "Create"
   - JSON file auto-downloads
   - **SAVE THIS FILE SECURELY**

**Create Pub/Sub Topics:**

1. **In left sidebar**: "Pub/Sub" → "Topics"
2. **Create first topic**:
   - Click "Create Topic"
   - Name: `gmail-jr-incoming`
   - Click "Create Topic"
3. **Create second topic**:
   - Click "Create Topic"
   - Name: `gmail-amanda-incoming`
   - Click "Create Topic"

**Create Pub/Sub Subscriptions:**

1. **For JR account**:
   - Go to Topics page
   - Click on `gmail-jr-incoming`
   - In Overview tab, scroll to "Subscriptions" section
   - Click "Create Subscription"
   - Subscription ID: `gmail-jr-n8n`
   - Delivery type: "Push"
   - Push endpoint: `https://n8n.yourdomain.com/webhook/gmail-jr`
   - Authentication: None (for now)
   - Click "Create"

2. **For Amanda account**:
   - Same process
   - Topic: `gmail-amanda-incoming`
   - Subscription ID: `gmail-amanda-n8n`
   - Push endpoint: `https://n8n.yourdomain.com/webhook/gmail-amanda`

**Set Up Domain-Wide Delegation:**

1. **In GCP Console**:
   - APIs & Services → Credentials
   - Click `amanda-n8n-service`
   - Copy "Client ID" (long number)

2. **In Google Workspace Admin Console** (https://admin.google.com/):
   - Go to "Security" → "API Controls" → "Domain-wide Delegation"
   - Click "Add new"
   - Client ID: Paste from step 1
   - OAuth scopes (paste exactly):
     ```
     https://www.googleapis.com/auth/gmail.modify,
     https://www.googleapis.com/auth/pubsub
     ```
   - Click "Authorize"

### 11.2 Verify Setup

**Test Pub/Sub Topic:**

In GCP Console:
1. Pub/Sub → Topics
2. Click `gmail-jr-incoming`
3. Click "Publish Message" button
4. Add attribute: `key: "test"`, `value: "true"`
5. Message body:
   ```json
   {
     "emailAddress": "jr@privegroup.com",
     "historyId": "123456"
   }
   ```
6. Click "Publish"
7. Verify n8n received it (check n8n webhook logs)

**Test Service Account Permissions:**

```bash
# Using gcloud CLI (if installed):
gcloud auth activate-service-account --key-file=credentials.json

# Try to list Pub/Sub subscriptions:
gcloud pubsub subscriptions list --project=prive-amanda-prod
```

---

## 12. Deployment Checklist

### 12.1 Pre-Deployment

- [ ] All Workflows 0-6 built and tested
- [ ] Database schema created and tested
- [ ] API keys configured in n8n
- [ ] GCP resources created (topics, subscriptions, service account)
- [ ] PostgreSQL database accessible
- [ ] Telegram bot configured
- [ ] SSL certificates valid
- [ ] Webhook endpoints reachable
- [ ] n8n instance running and stable
- [ ] Backup of current system taken
- [ ] Team notified of cutover window

### 12.2 Deployment Day

- [ ] All systems green (no alerts)
- [ ] Team on standby
- [ ] Rollback procedure documented
- [ ] Monitoring dashboards ready
- [ ] Test emails sent successfully
- [ ] Disable GAS triggers
- [ ] Monitor n8n for 30 minutes
- [ ] Send all-clear notification

### 12.3 Post-Deployment

- [ ] Daily monitoring for 1 week
- [ ] Weekly reviews for 1 month
- [ ] Archive GAS code after 30 days
- [ ] Optimize workflows based on learnings
- [ ] Document any issues encountered
- [ ] Update team documentation

---

## 13. Optimization & Future Roadmap

### 13.1 Short-Term Optimizations (Months 1-3)

**Workflow Performance:**
- Profile workflow execution times
- Add caching for repeated queries
- Batch process emails when possible
- Optimize database indexes

**AI Cost Reduction:**
- Experiment with GPT-3.5-Turbo for simpler tasks
- Implement prompt caching for similar emails
- Add response deduplication
- Track cost per task type

**System Reliability:**
- Implement comprehensive error handling
- Add retry mechanisms with backoff
- Monitor API rate limits
- Set up alerting thresholds

### 13.2 Medium-Term Enhancements (Months 3-6)

**Feature Additions:**
- Add deal tracking dashboard
- Implement contact intelligence (LinkedIn integration)
- Add calendar sync for scheduling tasks
- Create reporting/analytics dashboards

**Integration Expansions:**
- Connect to Slack (in addition to Telegram)
- Integrate with CRM system
- Add Zapier/IFTTT support
- Implement webhook outbound events

**Performance Upgrades:**
- Move to n8n Cloud with enterprise SLA
- Implement message queue retry logic
- Add workflow versioning and rollback
- Create workflow templates for common patterns

### 13.3 Long-Term Vision (Months 6+)

**On-Premises AI:**
- Deploy local LLM on NVIDIA DGX Spark
- Fine-tune model on Prive Group data
- Eliminate API dependency
- Reduce costs to near-zero

**Advanced Automation:**
- Multi-step deal workflows
- Predictive deal scoring
- Automated outreach campaigns
- Deal pipeline management

**Enterprise Features:**
- Multi-workspace support
- Role-based access control (RBAC)
- Audit logging
- Compliance features (GDPR, SOC 2)

---

## 14. Troubleshooting Guide

### 14.1 Common Issues & Solutions

**Issue: Emails not being processed**

```
Diagnosis:
1. Check Pub/Sub subscription has messages
   - GCP Console → Pub/Sub → Subscriptions
   - Look for "Unacked messages" > 0
2. Check n8n webhook is online
   - n8n → Workflows → Check webhook status
3. Check Gmail watch is active
   - Run Workflow 0 manually

Solution:
1. If Pub/Sub has unacked messages but n8n not receiving:
   - Webhook endpoint might be unreachable
   - Check firewall rules
   - Verify HTTPS certificate valid
   - Check n8n logs for errors

2. If watch is stale:
   - Run Workflow 0 (Watch Renewal)
   - Should re-establish watch within 30 seconds

3. If n8n webhook offline:
   - Check n8n server status
   - Restart n8n if needed
   - Check PostgreSQL connection
```

**Issue: High API costs**

```
Diagnosis:
1. Check which tasks are using most tokens
   - Query: SELECT task_type, SUM(tokens_used) FROM ai_interactions
   2. Check for repeated calls on same email
   - Query: SELECT email_id, COUNT(*) FROM task_completions GROUP BY email_id

Solution:
1. Implement caching for similar requests
2. Switch to cheaper model (GPT-3.5-Turbo)
3. Reduce max_tokens for less important tasks
4. Add deduplication before AI call
5. Batch process multiple emails
```

**Issue: HITL approvals timing out**

```
Diagnosis:
1. Check Telegram bot is working
   - Send test message to bot
   - Verify buttons appear
2. Check workflow is waiting for callback
   - Review Workflow 5 execution logs
3. Check user is in approval group

Solution:
1. Increase timeout from 30 min to 60 min (if needed)
2. Add reminder after 15 minutes
3. Add escalation after 30 minutes
4. Check user permissions on Telegram group
```

**Issue: Database size growing too large**

```
Diagnosis:
1. Check which tables are large
   - Query: SELECT tablename, pg_size_pretty(pg_total_relation_size(...))
2. Identify old data not needed

Solution:
1. Archive old email_events (older than 90 days)
2. Truncate ai_interactions log (keep last 30 days)
3. Summarize old task_completions into monthly summaries
4. Implement data retention policy
```

### 14.2 Emergency Procedures

**If n8n is completely down:**

```
1. Disable webhook subscriptions in GCP
   - Prevents error loops
   - Pub/Sub will queue messages

2. Restart n8n
   - docker restart n8n
   - Or use Kubernetes/systemd commands

3. Re-enable once running
   - Update Pub/Sub subscription endpoint
   - Test with manual message

4. Check for lost messages
   - If downtime > 1 hour, check Pub/Sub backlog
   - May need to manually process queued emails
```

**If GCP is having issues:**

```
1. Switch to fallback AI processing (Workflow 9)
   - System automatically retries with Claude
   - Then template fallback

2. Continue processing with degraded functionality
   - Emails still queue in Gmail labels
   - Drafts still created
   - Just reduced quality

3. Once GCP recovered, reprocess failed tasks
```

**If database is corrupted:**

```
1. Stop all n8n workflows
   - Prevents further corruption

2. Restore from backup
   - Use most recent backup (daily)
   - PostgreSQL restore command:
     psql -d amanda_prod < backup.sql

3. Re-run workflows for any lost period
   - Manually trigger Workflow 2 for emails
```

---

## 15. Cost Analysis & Estimation

### 15.1 Monthly Cost Breakdown

**Assuming 100 emails/day, 70 tasks/day:**

| Component | Unit Cost | Monthly Volume | Monthly Cost |
|-----------|-----------|-----------------|--------------|
| **Gmail API** | Free (quota-based) | 50,000 calls | $0 |
| **Pub/Sub** | $0.40 per GB | 10 GB | $4.00 |
| **OpenAI (GPT-4)** | $0.03 per 1K input, $0.06 per 1K output | 2M tokens | $120.00 |
| **Claude API** | $0.003 per 1K input, $0.015 per 1K output | 500K tokens | $9.00 |
| **PostgreSQL** | $14.50 (small instance) | - | $14.50 |
| **n8n (self-hosted)** | $0 (one-time setup) | - | $0 |
| **n8n Server (EC2 t3.small)** | $0.0208/hour | 730 hours | $15.18 |
| **Telegram Bot** | Free | - | $0 |
| **Gmail Workspace (existing)** | $12/user/month | 2 users | $24.00 |
| **Storage (backups)** | $0.02 per GB | 100 GB | $2.00 |
| | | **TOTAL** | **$188.68** |

**Previous System Cost (Polling):**
- Gmail API quotas: Still free, but less efficient
- Compute (GAS execution): ~$50/month
- Storage: $5/month
- Workspace: $24/month
- **Previous Total**: ~$79/month (but hitting quotas, limited scaling)

**Savings Analysis:**
- **Cost difference**: +$110/month additional AI costs
- **Benefits gained**:
  - Eliminate quota exhaustion (enables 10x scaling)
  - Reduce latency from 5-15 min to <30 sec
  - Better deal analysis quality
  - Full audit trail and monitoring
  - Professional n8n platform

**ROI Calculation:**
- If Amanda processing leads to just 1 extra deal/month worth $100K, AI cost easily justified
- If reduces time spent triaging emails (5 hrs/day × $50/hr = $12,500/month), ROI is massive

### 15.2 Cost Optimization Strategies

**Reduce AI Costs:**
- Use GPT-3.5-Turbo for 80% of tasks ($0.005 per 1K tokens vs $0.03)
- Implement caching for similar requests
- Fine-tune model on company data (one-time cost)
- Local LLM on DGX Spark (future: ~$0)

**Reduce Infrastructure Costs:**
- Use managed PostgreSQL (Supabase): $25-100/month
- Use n8n Cloud (cheaper than self-hosted): $50-200/month
- Combine with reserved instances: -30% savings

**Target Optimized Cost:**
- AI: $30/month (GPT-3.5-Turbo only, with caching)
- Infrastructure: $50/month (combined)
- **Optimized Total**: ~$104/month

---

## 16. Conclusion & Next Steps

### 16.1 Summary

This architecture provides Prive Group with:

✅ **Push-based event-driven system** - No polling, sub-second latency
✅ **99% reduction in API calls** - Sustainable quota management
✅ **Scalable to multiple accounts** - Add 10+ accounts without issues
✅ **HITL approval gates** - Human-in-the-loop safeguards
✅ **AI-powered task processing** - Intelligent email analysis
✅ **Comprehensive monitoring** - Dashboard visibility into all operations
✅ **Maintainable codebase** - Visual workflows vs. GAS scripts
✅ **Future-ready** - Prepared for on-premises AI with DGX Spark

### 16.2 Immediate Next Steps (Week 1)

1. **Get Stakeholder Buy-In**
   - Schedule meeting with JR and leadership
   - Present ROI analysis
   - Get approval to proceed

2. **Set Up Project Infrastructure**
   - Create GCP project
   - Provision EC2 for n8n
   - Obtain all API credentials
   - Create PostgreSQL database

3. **Build Core Workflows**
   - Implement Workflows 0-3
   - Test thoroughly
   - Document learnings

4. **Prepare Migration Plan**
   - Create detailed runbook
   - Schedule cutover window
   - Brief team on changes

### 16.3 Success Metrics

**Track these metrics to measure success:**

| Metric | Current | Target (After Migration) |
|--------|---------|--------------------------|
| Email processing latency | 5-15 min | < 30 sec |
| Daily API calls | 10,000+ | < 1,000 |
| Quota headroom | < 2.4% remaining | > 95% remaining |
| Task completion rate | ~95% | > 98% |
| HITL approval SLA | N/A | < 30 min |
| System uptime | ~99.5% | > 99.9% |
| Manual escalations/week | ~5 | < 1 |
| Total cost | $79/month | $104-188/month |

### 16.4 Support & Maintenance

**Post-deployment support model:**

```
Week 1-4: Daily monitoring and optimization
Week 4-12: Weekly check-ins and refinements
Month 3+: Monthly reviews and feature planning

Quarterly Deep Dives:
- Performance analysis
- Cost optimization review
- Feature request prioritization
- Security & compliance audit
```

---

## 17. Appendices

### A. Acronyms & Definitions

| Term | Definition |
|------|-----------|
| **GAS** | Google Apps Script |
| **n8n** | Low-code automation platform |
| **HITL** | Human-in-the-Loop |
| **Pub/Sub** | Google Cloud Pub/Sub messaging |
| **API** | Application Programming Interface |
| **RFC3339** | ISO 8601 timestamp format |
| **SLA** | Service Level Agreement |
| **TTL** | Time-to-Live |
| **UUID** | Universally Unique Identifier |
| **JSON** | JavaScript Object Notation |

### B. Useful Links & Resources

**Google Cloud:**
- Gmail API Docs: https://developers.google.com/gmail/api
- Cloud Pub/Sub Docs: https://cloud.google.com/pubsub/docs
- GCP Console: https://console.cloud.google.com/

**n8n:**
- n8n Docs: https://docs.n8n.io/
- n8n Nodes: https://docs.n8n.io/nodes/
- n8n Community: https://community.n8n.io/

**AI APIs:**
- OpenAI API: https://platform.openai.com/docs/
- Anthropic Claude: https://docs.anthropic.com/

**Tools:**
- Telegram Bot API: https://core.telegram.org/bots/api
- PostgreSQL Docs: https://www.postgresql.org/docs/

### C. Sample Code Snippets

**PostgreSQL Connection String (for n8n):**
```
postgresql://n8n:password@postgres.internal:5432/amanda_prod
```

**Gmail API Scopes (for service account):**
```
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/pubsub
```

**Pub/Sub Message Format (from Gmail watch):**
```json
{
  "message": {
    "data": "base64-encoded-json",
    "messageId": "123456",
    "publishTime": "2026-03-14T10:00:00Z"
  }
}
```

**Decoded Pub/Sub Message:**
```json
{
  "emailAddress": "jr@privegroup.com",
  "historyId": "123456789"
}
```

---

**End of Document**

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | March 14, 2026 | Claude AI | Initial comprehensive technical design |

**Document Status:** Ready for Implementation

**Next Review Date:** After Phase 1 completion (Week 2)

**Owner:** Prive Group Technical Leadership

---
