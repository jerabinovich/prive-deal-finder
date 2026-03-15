/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AMANDA AGENT CORE — Consolidated Script
 *  Account: amanda@privegroup.com
 *  Version: 3.0 (Consolidated from v2.1-FINAL + Draft Queue Router FULL)
 *
 *  WHAT THIS DOES:
 *  1. Reads AMANDA/QUEUE/* labeled emails
 *  2. Builds structured <AMANDA_TASK> JSON payloads
 *  3. Creates Gmail drafts for AI backend processing
 *  4. Monitors HITL timeouts with Telegram escalation
 *  5. Sends daily morning brief via Telegram
 *  6. Logs all operations to Google Sheets
 *
 *  TRIGGERS:
 *  - routeAmandaQueue: Time-based, every 15 minutes
 *  - monitorHITL:      Time-based, every 30 minutes
 *  - morningBrief:     Time-based, daily at 8:00 AM ET
 *
 *  REPLACES:
 *  - "Amanda Agent Router v2.1-FINAL" (all functions)
 *  - "Amanda Draft Queue Router (FULL)" (all functions)
 *  - "Label Audit" (integrated as diagnostics)
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ─────────────────────────────────────────────────
const AMANDA_CONFIG = {
  JR_EMAIL: 'jr@privegroup.com',
  AMANDA_EMAIL: 'amanda@privegroup.com',

  // Quota guards
  MAX_THREADS_PER_RUN: 10,
  MAX_API_CALLS_PER_RUN: 30,

  // Working hours
  WORKING_HOURS_START: 6,
  WORKING_HOURS_END: 22,
  TIMEZONE: 'America/New_York',

  // Logging spreadsheet (create one and paste the ID here)
  // TODO: Replace with your actual Sheet ID
  LOG_SHEET_ID: PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID') || '',

  // Telegram — STORED SECURELY in PropertiesService
  // To set: Run setTelegramToken() once with your token
  TELEGRAM_CHAT_ID: PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '',
};

// ─── ROUTES: Label → Task Type Mapping ─────────────────────────────
const ROUTES = [
  {
    queueLabel: 'AMANDA/QUEUE/OPPORTUNITY_RE',
    taskType: 'OPPORTUNITY_RE_FASTSCAN',
    priority: 'HIGH',
    hitlRequired: false,  // Fast Scan auto-creates draft report, no outbound action
    hitlTimeoutMin: null,
    description: 'Real estate deal screening — Fast Scan analysis',
  },
  {
    queueLabel: 'AMANDA/QUEUE/LEGAL_REVIEW',
    taskType: 'LEGAL_REVIEW',
    priority: 'HIGH',
    hitlRequired: true,
    hitlTimeoutMin: 120,  // 2 hours
    description: 'Legal document review — flag red flags and deadlines',
  },
  {
    queueLabel: 'AMANDA/QUEUE/DRAFT_REPLY',
    taskType: 'DRAFT_REPLY',
    priority: 'MEDIUM',
    hitlRequired: true,
    hitlTimeoutMin: 60,
    description: 'Draft email reply for JR review before sending',
  },
  {
    queueLabel: 'AMANDA/QUEUE/FOLLOW_UP',
    taskType: 'FOLLOW_UP',
    priority: 'MEDIUM',
    hitlRequired: true,
    hitlTimeoutMin: 240,  // 4 hours
    description: 'Follow-up workflow — draft follow-up, track completion',
  },
  {
    queueLabel: 'AMANDA/QUEUE/SCHEDULING',
    taskType: 'SCHEDULING',
    priority: 'MEDIUM',
    hitlRequired: true,
    hitlTimeoutMin: 60,
    description: 'Schedule meeting/reservation — draft confirmation',
  },
  {
    queueLabel: 'AMANDA/QUEUE/CONSTRUCTION',
    taskType: 'CONSTRUCTION_REVIEW',
    priority: 'MEDIUM',
    hitlRequired: false,
    hitlTimeoutMin: null,
    description: 'Construction communication review and summary',
  },
  {
    queueLabel: 'AMANDA/QUEUE/FINANCE',
    taskType: 'FINANCE_REVIEW',
    priority: 'MEDIUM',
    hitlRequired: false,
    hitlTimeoutMin: null,
    description: 'Financial communication review and analysis',
  },
  {
    queueLabel: 'AMANDA/QUEUE/ESCALATE',
    taskType: 'ESCALATE_TO_JR',
    priority: 'URGENT',
    hitlRequired: true,
    hitlTimeoutMin: 30,
    description: 'Urgent item requiring immediate JR attention',
  },
];

// ─── MAIN QUEUE PROCESSOR ──────────────────────────────────────────
/**
 * Main entry — processes all AMANDA/QUEUE/* labels.
 * Called every 15 minutes by trigger.
 */
function routeAmandaQueue() {
  const props = PropertiesService.getScriptProperties();

  // Working hours check
  if (!amandaWithinHours_()) {
    Logger.log('🌙 Outside Amanda working hours. Skipping.');
    return;
  }

  // Daily quota check
  if (amandaQuotaExhausted_(props)) {
    Logger.log('⛔ Amanda daily quota budget reached.');
    sendTelegram_('⚠️ Amanda quota budget reached. Some tasks may be delayed.');
    return;
  }

  let totalApiCalls = 0;
  let tasksProcessed = 0;
  let tasksSkipped = 0;

  for (const route of ROUTES) {
    if (totalApiCalls >= AMANDA_CONFIG.MAX_API_CALLS_PER_RUN) {
      Logger.log('⚠️ API budget reached. Remaining routes deferred to next run.');
      break;
    }

    try {
      const label = GmailApp.getUserLabelByName(route.queueLabel);
      totalApiCalls++;

      if (!label) {
        Logger.log('⏭️ Label not found: ' + route.queueLabel + ' (skipping)');
        continue;
      }

      const threads = label.getThreads(0, AMANDA_CONFIG.MAX_THREADS_PER_RUN);
      totalApiCalls++;

      for (const thread of threads) {
        if (totalApiCalls >= AMANDA_CONFIG.MAX_API_CALLS_PER_RUN) break;

        try {
          // Anti-loop: check if already processed
          const processedLabel = getOrCreateAmandaLabel_('AMANDA/STATE/PROCESSED');
          const threadLabels = thread.getLabels().map(l => l.getName());
          totalApiCalls++;

          if (threadLabels.indexOf('AMANDA/STATE/PROCESSED') !== -1) {
            tasksSkipped++;
            continue;
          }

          // Build and create the task
          const result = buildAndCreateTask_(thread, route);
          totalApiCalls += result.apiCalls;
          tasksProcessed++;

          // Move from QUEUE to PROCESSING state
          const processingLabel = getOrCreateAmandaLabel_('AMANDA/STATE/PROCESSING');
          thread.addLabel(processingLabel);
          thread.removeLabel(label);
          totalApiCalls += 2;

          // Log to sheet
          logToSheet_(route.taskType, thread.getFirstMessageSubject(), 'QUEUED', route.priority);

          Logger.log('✅ Task created: ' + route.taskType + ' — "' + thread.getFirstMessageSubject().substring(0, 50) + '"');

        } catch (e) {
          if (e.message && e.message.indexOf('Service invoked too many times') !== -1) {
            Logger.log('🛑 QUOTA HIT. Emergency stop.');
            return;
          }
          Logger.log('❌ Error processing thread: ' + e.message);
        }
      }
    } catch (e) {
      Logger.log('❌ Error on route ' + route.queueLabel + ': ' + e.message);
    }
  }

  // Update daily count
  amandaIncrementApiCount_(props, totalApiCalls);
  Logger.log('📊 Processed: ' + tasksProcessed + ' tasks, Skipped: ' + tasksSkipped + ', API calls: ~' + totalApiCalls);
}

// ─── TASK BUILDER ──────────────────────────────────────────────────
function buildAndCreateTask_(thread, route) {
  let apiCalls = 0;

  const messages = thread.getMessages();
  apiCalls++;
  const latest = messages[messages.length - 1];

  const subject = latest.getSubject() || '(no subject)';
  const from = latest.getFrom() || '';
  const to = latest.getTo() || '';
  const date = latest.getDate();
  const body = latest.getPlainBody();
  const replyTo = latest.getReplyTo() || extractEmail_(from);

  // Collect context labels (CTX/*)
  const threadLabels = thread.getLabels().map(l => l.getName());
  apiCalls++;
  const contextLabels = threadLabels.filter(l => l.startsWith('CTX/'));

  // Collect attachments metadata
  const attachments = latest.getAttachments();
  const attachmentInfo = attachments.map(a => ({
    name: a.getName(),
    type: a.getContentType(),
    size: a.getSize()
  }));

  // Build structured task payload
  const taskPayload = {
    taskType: route.taskType,
    priority: route.priority,
    hitlRequired: route.hitlRequired,
    hitlTimeoutMin: route.hitlTimeoutMin,
    description: route.description,
    metadata: {
      threadId: thread.getId(),
      messageId: latest.getId(),
      timestamp: new Date().toISOString(),
      routedBy: 'Amanda Agent Core v3.0',
    },
    email: {
      subject: subject,
      from: from,
      to: to,
      replyTo: replyTo,
      date: date.toISOString(),
      bodyPreview: body.substring(0, 2000),
      attachments: attachmentInfo,
      messageCount: messages.length,
    },
    context: {
      labels: contextLabels,
      threadLabelHistory: threadLabels,
    },
    instruction: route.description,
  };

  // Create draft with the structured payload
  const draftSubject = '[AMANDA_TASK:' + route.taskType + '] ' + subject;
  const draftBody = '<AMANDA_TASK>\n' + JSON.stringify(taskPayload, null, 2) + '\n</AMANDA_TASK>';

  GmailApp.createDraft(
    AMANDA_CONFIG.JR_EMAIL,  // "To" field for reference
    draftSubject,
    draftBody,
    {
      from: AMANDA_CONFIG.AMANDA_EMAIL,
      attachments: attachments.length > 0 ? attachments : undefined,
    }
  );
  apiCalls++;

  return { apiCalls };
}

// ─── HITL MONITOR ──────────────────────────────────────────────────
/**
 * Monitors tasks in PROCESSING state for HITL timeout.
 * If a task has been waiting longer than its threshold, sends Telegram alert.
 * Called every 30 minutes.
 */
function monitorHITL() {
  const processingLabel = GmailApp.getUserLabelByName('AMANDA/STATE/PROCESSING');
  if (!processingLabel) return;

  const threads = processingLabel.getThreads(0, 20);
  const now = new Date().getTime();

  for (const thread of threads) {
    try {
      const labels = thread.getLabels().map(l => l.getName());

      // Find which route this belongs to
      for (const route of ROUTES) {
        if (!route.hitlRequired || !route.hitlTimeoutMin) continue;

        // Check if this thread matches the route (by checking if it has the forwarded label pattern)
        const taskLabel = labels.find(l => l.indexOf(route.taskType) !== -1);
        if (!taskLabel) continue;

        // Check timeout
        const lastMsg = thread.getLastMessageDate();
        const elapsed = (now - lastMsg.getTime()) / (1000 * 60); // minutes

        if (elapsed > route.hitlTimeoutMin) {
          // Check if we already sent an alert (to avoid spam)
          const alertLabel = 'AMANDA/ALERT/TIMEOUT_SENT';
          if (labels.indexOf(alertLabel) !== -1) continue;

          const subject = thread.getFirstMessageSubject();
          sendTelegram_(
            '⏰ HITL TIMEOUT\n\n' +
            'Task: ' + route.taskType + '\n' +
            'Subject: ' + subject.substring(0, 80) + '\n' +
            'Waiting: ' + Math.round(elapsed) + ' min (limit: ' + route.hitlTimeoutMin + ' min)\n' +
            'Priority: ' + route.priority + '\n\n' +
            'Action needed: Review draft in Gmail.'
          );

          // Mark as alerted
          const alertLbl = getOrCreateAmandaLabel_(alertLabel);
          thread.addLabel(alertLbl);

          Logger.log('⏰ HITL timeout alert sent: ' + route.taskType + ' — ' + subject.substring(0, 50));
        }
      }
    } catch (e) {
      Logger.log('❌ HITL monitor error: ' + e.message);
    }
  }
}

// ─── MORNING BRIEF ─────────────────────────────────────────────────
/**
 * Sends a daily morning brief to JR via Telegram.
 * Called daily at 8:00 AM ET.
 */
function morningBrief() {
  try {
    // Count items in each state
    const states = [
      { label: 'AMANDA/STATE/PROCESSING', name: 'In Processing' },
      { label: 'AMANDA/STATE/PROCESSED', name: 'Completed' },
      { label: 'AMANDA/STATE/WAITING_HITL', name: 'Awaiting JR Approval' },
    ];

    let brief = '☀️ AMANDA MORNING BRIEF\n';
    brief += Utilities.formatDate(new Date(), AMANDA_CONFIG.TIMEZONE, 'EEEE, MMMM d, yyyy') + '\n\n';

    for (const state of states) {
      const label = GmailApp.getUserLabelByName(state.label);
      if (label) {
        const count = label.getThreads(0, 50).length;
        brief += '• ' + state.name + ': ' + count + '\n';
      }
    }

    // Count pending queue items
    let queueTotal = 0;
    for (const route of ROUTES) {
      const label = GmailApp.getUserLabelByName(route.queueLabel);
      if (label) {
        queueTotal += label.getThreads(0, 20).length;
      }
    }
    brief += '• Queued for Processing: ' + queueTotal + '\n';

    // JR's unread count
    const jrUnread = GmailApp.getInboxUnreadCount();
    brief += '\n📬 JR Inbox Unread: ' + jrUnread + '\n';

    brief += '\n---\nAmanda Agent Core v3.0';

    sendTelegram_(brief);
    Logger.log('☀️ Morning brief sent.');

  } catch (e) {
    Logger.log('❌ Morning brief error: ' + e.message);
    sendTelegram_('❌ Morning brief generation failed: ' + e.message);
  }
}

// ─── TELEGRAM ──────────────────────────────────────────────────────
function sendTelegram_(message) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  const chatId = AMANDA_CONFIG.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    Logger.log('⚠️ Telegram not configured. Message: ' + message);
    return;
  }

  try {
    const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('❌ Telegram send failed: ' + e.message);
  }
}

// ─── LOGGING ───────────────────────────────────────────────────────
function logToSheet_(taskType, subject, status, priority) {
  if (!AMANDA_CONFIG.LOG_SHEET_ID) return;

  try {
    const ss = SpreadsheetApp.openById(AMANDA_CONFIG.LOG_SHEET_ID);
    let sheet = ss.getSheetByName('Amanda Log');
    if (!sheet) {
      sheet = ss.insertSheet('Amanda Log');
      sheet.appendRow(['Timestamp', 'Task Type', 'Subject', 'Status', 'Priority']);
    }

    sheet.appendRow([
      new Date(),
      taskType,
      subject.substring(0, 100),
      status,
      priority,
    ]);
  } catch (e) {
    Logger.log('⚠️ Sheet logging failed: ' + e.message);
  }
}

// ─── UTILITIES ─────────────────────────────────────────────────────
function extractEmail_(fromString) {
  const match = fromString.match(/<(.+?)>/);
  return match ? match[1] : fromString;
}

const amandaLabelCache_ = {};
function getOrCreateAmandaLabel_(name) {
  if (amandaLabelCache_[name]) return amandaLabelCache_[name];
  let label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  amandaLabelCache_[name] = label;
  return label;
}

function amandaWithinHours_() {
  const hour = parseInt(Utilities.formatDate(new Date(), AMANDA_CONFIG.TIMEZONE, 'H'), 10);
  return hour >= AMANDA_CONFIG.WORKING_HOURS_START && hour < AMANDA_CONFIG.WORKING_HOURS_END;
}

function amandaQuotaExhausted_(props) {
  const today = Utilities.formatDate(new Date(), AMANDA_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const savedDate = props.getProperty('amandaDailyDate');
  if (savedDate !== today) {
    props.setProperty('amandaDailyDate', today);
    props.setProperty('amandaDailyCount', '0');
    return false;
  }
  return parseInt(props.getProperty('amandaDailyCount') || '0', 10) >= 600;
}

function amandaIncrementApiCount_(props, calls) {
  const c = parseInt(props.getProperty('amandaDailyCount') || '0', 10);
  props.setProperty('amandaDailyCount', String(c + calls));
}

// ─── LABEL AUDIT (diagnostics) ─────────────────────────────────────
function auditLabels() {
  const required = ROUTES.map(r => r.queueLabel);
  required.push('AMANDA/STATE/PROCESSING', 'AMANDA/STATE/PROCESSED', 'AMANDA/STATE/WAITING_HITL', 'AMANDA/ALERT/TIMEOUT_SENT');

  const missing = [];
  for (const name of required) {
    if (!GmailApp.getUserLabelByName(name)) {
      missing.push(name);
    }
  }

  if (missing.length === 0) {
    Logger.log('✅ All ' + required.length + ' required labels exist.');
  } else {
    Logger.log('⚠️ Missing labels: ' + missing.join(', '));
    Logger.log('Run bootstrapLabels() to create them.');
  }
}

function bootstrapLabels() {
  const allLabels = ROUTES.map(r => r.queueLabel);
  allLabels.push(
    'AMANDA/STATE/PROCESSING',
    'AMANDA/STATE/PROCESSED',
    'AMANDA/STATE/WAITING_HITL',
    'AMANDA/ALERT/TIMEOUT_SENT'
  );

  let created = 0;
  for (const name of allLabels) {
    if (!GmailApp.getUserLabelByName(name)) {
      GmailApp.createLabel(name);
      created++;
      Logger.log('🆕 Created: ' + name);
    }
  }
  Logger.log('✅ Bootstrap complete. Created ' + created + ' labels.');
}

// ─── SECURITY SETUP (run once) ─────────────────────────────────────
/**
 * Run ONCE to store Telegram credentials securely.
 * After running, delete or comment out the token value.
 */
function setTelegramToken() {
  const props = PropertiesService.getScriptProperties();

  // TODO: Replace with your actual values, run once, then clear
  props.setProperty('TELEGRAM_TOKEN', 'YOUR_BOT_TOKEN_HERE');
  props.setProperty('TELEGRAM_CHAT_ID', 'YOUR_CHAT_ID_HERE');

  // TODO: Set your Google Sheets log ID
  props.setProperty('LOG_SHEET_ID', 'YOUR_SHEET_ID_HERE');

  Logger.log('✅ Credentials stored securely in PropertiesService.');
  Logger.log('⚠️ Now delete the token values from this function!');
}

// ─── TRIGGER SETUP (run once) ──────────────────────────────────────
function setupAmandaTriggers() {
  // Delete all existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    ScriptApp.deleteTrigger(t);
  }

  // Queue processor — every 15 minutes
  ScriptApp.newTrigger('routeAmandaQueue')
    .timeBased()
    .everyMinutes(15)
    .create();

  // HITL monitor — every 30 minutes
  ScriptApp.newTrigger('monitorHITL')
    .timeBased()
    .everyMinutes(30)
    .create();

  // Morning brief — daily at 8 AM ET
  ScriptApp.newTrigger('morningBrief')
    .timeBased()
    .atHour(8)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(AMANDA_CONFIG.TIMEZONE)
    .create();

  Logger.log('✅ All Amanda triggers configured.');
}
