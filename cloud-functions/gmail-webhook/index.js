/**
 * ═══════════════════════════════════════════════════════════════════════
 *  OpenClaw Gmail Webhook — Cloud Function
 *
 *  Receives Gmail Pub/Sub push notifications and forwards them to n8n.
 *  This function acts as a bridge between GCP Pub/Sub and n8n webhooks.
 *
 *  Flow:
 *  Gmail watch() → Pub/Sub → This Cloud Function → n8n Webhook
 *
 *  The Pub/Sub message contains:
 *  {
 *    emailAddress: "jr@privegroup.com",
 *    historyId: "12345"
 *  }
 *
 *  We use the historyId to fetch only NEW changes since last check,
 *  then forward the relevant message data to n8n for processing.
 * ═══════════════════════════════════════════════════════════════════════
 */

const { google } = require('googleapis');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// ─── Configuration ─────────────────────────────────────────────────
const CONFIG = {
  // n8n webhook URLs — set via environment variables
  N8N_WEBHOOK_JR: process.env.N8N_WEBHOOK_JR || 'http://localhost:5678/webhook/gmail-jr',
  N8N_WEBHOOK_AMANDA: process.env.N8N_WEBHOOK_AMANDA || 'http://localhost:5678/webhook/gmail-amanda',
  N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET || '',

  // GCP project (for Secret Manager)
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || 'prive-openclaw',

  // Account mapping
  ACCOUNTS: {
    'jr@privegroup.com': {
      webhookUrl: process.env.N8N_WEBHOOK_JR || 'http://localhost:5678/webhook/gmail-jr',
      role: 'triage',
    },
    'amanda@privegroup.com': {
      webhookUrl: process.env.N8N_WEBHOOK_AMANDA || 'http://localhost:5678/webhook/gmail-amanda',
      role: 'agent',
    },
  },
};

// ─── Main Entry Point ──────────────────────────────────────────────
/**
 * Cloud Function entry point — triggered by Pub/Sub message.
 *
 * @param {Object} message - Pub/Sub message
 * @param {Object} context - Cloud Function context
 */
exports.gmailWebhook = async (message, context) => {
  try {
    // Decode Pub/Sub message
    const data = message.data
      ? JSON.parse(Buffer.from(message.data, 'base64').toString())
      : {};

    const { emailAddress, historyId } = data;

    if (!emailAddress || !historyId) {
      console.warn('⚠️ Invalid Pub/Sub message — missing emailAddress or historyId');
      return;
    }

    console.log(`📬 Gmail notification: ${emailAddress} | historyId: ${historyId}`);

    // Determine which n8n webhook to call
    const account = CONFIG.ACCOUNTS[emailAddress];
    if (!account) {
      console.warn(`⚠️ Unknown email account: ${emailAddress}`);
      return;
    }

    // Forward to n8n
    const payload = {
      emailAddress,
      historyId,
      role: account.role,
      timestamp: new Date().toISOString(),
      source: 'gmail-pubsub',
    };

    const response = await fetch(account.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': CONFIG.N8N_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`❌ n8n webhook failed: ${response.status} ${response.statusText}`);
      // Don't throw — we don't want Pub/Sub to retry endlessly
      return;
    }

    console.log(`✅ Forwarded to n8n (${account.role}): ${emailAddress}`);

  } catch (error) {
    console.error('❌ Cloud Function error:', error.message);
    // Don't throw — prevents infinite retries
  }
};

/**
 * HTTP entry point — for direct webhook testing.
 * Can also be used if you prefer HTTP push subscriptions.
 *
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
exports.gmailWebhookHttp = async (req, res) => {
  try {
    // Verify webhook secret
    const secret = req.headers['x-webhook-secret'];
    if (CONFIG.N8N_WEBHOOK_SECRET && secret !== CONFIG.N8N_WEBHOOK_SECRET) {
      console.warn('⚠️ Invalid webhook secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Handle Pub/Sub push message format
    const pubsubMessage = req.body?.message;
    if (pubsubMessage) {
      const data = pubsubMessage.data
        ? JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString())
        : {};

      await exports.gmailWebhook({ data: pubsubMessage.data }, {});
      return res.status(200).json({ status: 'ok' });
    }

    // Handle direct POST (for testing)
    const { emailAddress, historyId } = req.body;
    if (emailAddress && historyId) {
      const encoded = Buffer.from(JSON.stringify({ emailAddress, historyId })).toString('base64');
      await exports.gmailWebhook({ data: encoded }, {});
      return res.status(200).json({ status: 'ok' });
    }

    return res.status(400).json({ error: 'Invalid request body' });

  } catch (error) {
    console.error('❌ HTTP handler error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
