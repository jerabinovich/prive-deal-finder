/**
 * ═══════════════════════════════════════════════════════════════════════
 *  JR INBOX MANAGER — Consolidated Script
 *  Account: jr@privegroup.com
 *  Version: 3.0 (Consolidated from "Labels gmail" + "Amanda Email Router")
 *
 *  WHAT THIS DOES:
 *  1. Triages JR's inbox → applies labels based on sender/content
 *  2. Forwards action-tagged emails to amanda@privegroup.com
 *  3. Respects Gmail API quotas with early-exit caching
 *
 *  TRIGGER: Time-based, every 30 minutes
 *
 *  REPLACES:
 *  - "Labels gmail" (jrTriageInbox_FULL) — every 15 min
 *  - "Amanda - Email Router (PRIVE GROUP)" (forwardToAmanda) — every 15 min
 *  - "Untitled project" (jrTriageInbox_FULL) — every 5 min ← DELETED
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ─────────────────────────────────────────────────
const CONFIG = {
  AMANDA_EMAIL: 'amanda@privegroup.com',
  JR_EMAIL: 'jr@privegroup.com',

  // Trigger interval (used for quota budgeting, not trigger setup)
  TRIGGER_INTERVAL_MIN: 30,

  // Max threads to process per run (quota guard)
  MAX_THREADS_PER_RUN: 15,

  // Max Gmail API calls per run (emergency brake)
  MAX_API_CALLS_PER_RUN: 40,

  // Working hours (ET) — skip processing outside these hours
  WORKING_HOURS_START: 6,  // 6 AM ET
  WORKING_HOURS_END: 23,   // 11 PM ET
  TIMEZONE: 'America/New_York',

  // Cache keys in PropertiesService
  CACHE_LAST_HISTORY_ID: 'lastHistoryId',
  CACHE_LAST_RUN_TS: 'lastRunTimestamp',
  CACHE_API_CALL_COUNT: 'dailyApiCallCount',
  CACHE_API_CALL_DATE: 'dailyApiCallDate',
};

// ─── TRIAGE RULES ──────────────────────────────────────────────────
// Add/modify rules here. Each rule maps a condition to a Gmail label.
// Priority order matters — first match wins for single-label rules.
const TRIAGE_RULES = [
  // ── Deal Flow / Opportunities ──
  { label: 'Opportunity RE',     match: { subject: /opportunity|deal|acquisition|off.?market|pocket.?listing/i } },
  { label: 'Opportunity RE',     match: { from: /@crexi\.com|@loopnet\.com|@costar\.com|@ten-x\.com/i } },

  // ── Construction / Development ──
  { label: 'Construction',       match: { subject: /draw.?request|change.?order|punch.?list|CO\b|certificate.?of.?occupancy|permit|inspection/i } },
  { label: 'Construction',       match: { from: /contractor|architect|engineer|builder/i } },

  // ── Legal ──
  { label: 'Legal',              match: { subject: /LOI|letter.?of.?intent|contract|lease|amendment|estoppel|title|closing|settlement/i } },

  // ── Finance / Banking ──
  { label: 'Finance',            match: { subject: /loan|mortgage|refinance|draw|appraisal|underwriting|term.?sheet/i } },
  { label: 'Finance',            match: { from: /@citynational\.com|@jpmorgan\.com|@bankofamerica\.com/i } },

  // ── Asset Management ──
  { label: 'Asset Mgmt',         match: { subject: /rent.?roll|NOI|occupancy|tenant|lease.?renewal|cap.?rate|P&L|financial.?report/i } },

  // ── Team / Internal ──
  { label: 'Team',               match: { from: /@privegroup\.com/i } },

  // ── Scheduling ──
  { label: 'Scheduling',         match: { subject: /meeting|call|appointment|schedule|calendar|availability/i } },
];

// ─── AMANDA FORWARD RULES ──────────────────────────────────────────
// Emails with these label matches get forwarded to Amanda with action tags
const AMANDA_ROUTES = [
  { label: 'Opportunity RE',      action: 'OPPORTUNITY_RE_FASTSCAN',    instruction: 'Run Fast Scan deal analysis. Apply Prive Group investment criteria. Provide GO/NO-GO/INFO-NEEDED verdict.' },
  { label: 'Legal',               action: 'LEGAL_REVIEW',               instruction: 'Review for key terms, red flags, deadlines. Flag items needing attorney review.' },
  { label: 'Construction',        action: 'CONSTRUCTION_REVIEW',        instruction: 'Review construction communication. Flag budget impacts, schedule changes, approval needs.' },
  { label: 'Finance',             action: 'FINANCE_REVIEW',             instruction: 'Review financial communication. Flag key terms, deadlines, action items.' },
];

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────
/**
 * Main function — called by time-based trigger every 30 minutes.
 * Combines inbox triage + Amanda forwarding in one pass.
 */
function jrInboxManager() {
  const props = PropertiesService.getScriptProperties();

  // ── Quota guard: check daily API call budget ──
  if (isDailyQuotaExhausted_(props)) {
    Logger.log('⛔ Daily API quota budget reached. Skipping this run.');
    return;
  }

  // ── Working hours check ──
  if (!isWithinWorkingHours_()) {
    Logger.log('🌙 Outside working hours. Skipping.');
    return;
  }

  // ── Early exit: check if inbox has changed since last run ──
  if (!hasNewActivity_(props)) {
    Logger.log('✅ No new inbox activity since last run. Exiting early.');
    return;
  }

  let apiCalls = 0;

  try {
    // ── Step 1: Get unprocessed threads ──
    const threads = GmailApp.search('in:inbox is:unread', 0, CONFIG.MAX_THREADS_PER_RUN);
    apiCalls++;

    if (threads.length === 0) {
      Logger.log('📭 No unread threads. Done.');
      updateLastRun_(props);
      return;
    }

    Logger.log('📬 Processing ' + threads.length + ' unread threads.');

    // ── Step 2: Process each thread ──
    for (const thread of threads) {
      if (apiCalls >= CONFIG.MAX_API_CALLS_PER_RUN) {
        Logger.log('⚠️ API call budget reached for this run. Remaining threads deferred.');
        break;
      }

      try {
        const result = processThread_(thread);
        apiCalls += result.apiCalls;
      } catch (e) {
        // If we hit quota, stop immediately
        if (e.message && e.message.indexOf('Service invoked too many times') !== -1) {
          Logger.log('🛑 QUOTA HIT. Stopping all processing.');
          break;
        }
        Logger.log('❌ Error on thread: ' + e.message);
      }
    }

    updateLastRun_(props);

  } catch (e) {
    Logger.log('🛑 Fatal error: ' + e.message);
  } finally {
    // Track daily API usage
    incrementDailyApiCount_(props, apiCalls);
    Logger.log('📊 This run used ~' + apiCalls + ' API calls.');
  }
}

// ─── THREAD PROCESSING ────────────────────────────────────────────
function processThread_(thread) {
  let apiCalls = 0;
  const messages = thread.getMessages();
  apiCalls++;

  const latestMsg = messages[messages.length - 1];
  const subject = latestMsg.getSubject() || '';
  const from = latestMsg.getFrom() || '';
  const threadLabels = thread.getLabels().map(l => l.getName());
  apiCalls++;

  // ── Apply triage labels ──
  for (const rule of TRIAGE_RULES) {
    // Skip if already labeled
    if (threadLabels.indexOf(rule.label) !== -1) continue;

    let matched = false;
    if (rule.match.subject && rule.match.subject.test(subject)) matched = true;
    if (rule.match.from && rule.match.from.test(from)) matched = true;

    if (matched) {
      const label = getOrCreateLabel_(rule.label);
      thread.addLabel(label);
      apiCalls++;
      threadLabels.push(rule.label);
      Logger.log('🏷️ Labeled: "' + subject.substring(0, 50) + '" → ' + rule.label);
    }
  }

  // ── Check Amanda forwarding rules ──
  for (const route of AMANDA_ROUTES) {
    if (threadLabels.indexOf(route.label) === -1) continue;

    // Check if already forwarded (anti-loop)
    const fwdLabelName = 'Forwarded/Amanda/' + route.action;
    if (threadLabels.indexOf(fwdLabelName) !== -1) continue;

    // Forward to Amanda
    forwardToAmanda_(latestMsg, route, thread);
    apiCalls += 2; // forward + label

    // Mark as forwarded
    const fwdLabel = getOrCreateLabel_(fwdLabelName);
    thread.addLabel(fwdLabel);
    Logger.log('📤 Forwarded to Amanda: ' + route.action + ' — "' + subject.substring(0, 50) + '"');
  }

  return { apiCalls };
}

// ─── AMANDA FORWARDING ─────────────────────────────────────────────
function forwardToAmanda_(message, route, thread) {
  const subject = message.getSubject();
  const originalFrom = message.getFrom();
  const originalTo = message.getTo();
  const originalDate = message.getDate();
  const body = message.getPlainBody();

  // Build the structured envelope Amanda expects
  const envelope = [
    'FROM JAVIER RABINOVICH',
    'Action: [' + route.action + ']',
    'Instruction: ' + route.instruction,
    '',
    'Original From: ' + originalFrom,
    'Original To: ' + (originalTo || CONFIG.JR_EMAIL),
    'Original Date: ' + originalDate,
    'Original Subject: ' + subject,
    '',
    '--- ORIGINAL MESSAGE ---',
    '',
    body
  ].join('\n');

  // Forward with attachments
  const attachments = message.getAttachments();

  GmailApp.sendEmail(
    CONFIG.AMANDA_EMAIL,
    '[' + route.action + '] ' + subject,
    envelope,
    {
      from: CONFIG.JR_EMAIL,
      name: 'Javier Rabinovich (via Gmail Router)',
      replyTo: CONFIG.JR_EMAIL,
      attachments: attachments.length > 0 ? attachments : undefined
    }
  );
}

// ─── QUOTA MANAGEMENT ──────────────────────────────────────────────
function isDailyQuotaExhausted_(props) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const savedDate = props.getProperty(CONFIG.CACHE_API_CALL_DATE);

  if (savedDate !== today) {
    // New day — reset counter
    props.setProperty(CONFIG.CACHE_API_CALL_DATE, today);
    props.setProperty(CONFIG.CACHE_API_CALL_COUNT, '0');
    return false;
  }

  const count = parseInt(props.getProperty(CONFIG.CACHE_API_CALL_COUNT) || '0', 10);
  // Conservative budget: 800 calls/day (leaving headroom from the ~1500 limit)
  return count >= 800;
}

function incrementDailyApiCount_(props, calls) {
  const current = parseInt(props.getProperty(CONFIG.CACHE_API_CALL_COUNT) || '0', 10);
  props.setProperty(CONFIG.CACHE_API_CALL_COUNT, String(current + calls));
}

// ─── EARLY EXIT CHECK ──────────────────────────────────────────────
function hasNewActivity_(props) {
  // Simple approach: check if there are unread messages
  // More advanced: use Gmail API historyId (requires advanced Gmail API)
  const lastRun = props.getProperty(CONFIG.CACHE_LAST_RUN_TS);
  if (!lastRun) return true; // First run, always process

  // Check if any unread threads exist
  const unread = GmailApp.search('in:inbox is:unread newer_than:1h', 0, 1);
  return unread.length > 0;
}

function updateLastRun_(props) {
  props.setProperty(CONFIG.CACHE_LAST_RUN_TS, String(new Date().getTime()));
}

// ─── WORKING HOURS ─────────────────────────────────────────────────
function isWithinWorkingHours_() {
  const now = new Date();
  const hour = parseInt(Utilities.formatDate(now, CONFIG.TIMEZONE, 'H'), 10);
  return hour >= CONFIG.WORKING_HOURS_START && hour < CONFIG.WORKING_HOURS_END;
}

// ─── LABEL MANAGEMENT ──────────────────────────────────────────────
const labelCache_ = {};

function getOrCreateLabel_(name) {
  if (labelCache_[name]) return labelCache_[name];

  let label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
    Logger.log('🆕 Created label: ' + name);
  }
  labelCache_[name] = label;
  return label;
}

// ─── SETUP (run once manually) ─────────────────────────────────────
/**
 * Run this function once to set up the 30-minute trigger.
 * Go to: Run > setupTrigger
 */
function setupTrigger() {
  // Delete all existing triggers for this project
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  // Create new 30-minute trigger
  ScriptApp.newTrigger('jrInboxManager')
    .timeBased()
    .everyMinutes(30)
    .create();

  Logger.log('✅ Trigger set: jrInboxManager every 30 minutes.');
}

/**
 * Manual test — run this to process inbox once without trigger.
 */
function testRun() {
  jrInboxManager();
}
