#!/usr/bin/env node
"use strict";

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

async function fetchText(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} at ${url}`);
  }
  return response.text();
}

async function fetchJson(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} at ${url}`);
  }
  return response.json();
}

async function sendTelegram(message, botToken, chatId) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed ${response.status}: ${body}`);
  }
}

async function main() {
  const apiBase = process.env.API_BASE || "http://127.0.0.1:3001/api";
  const apiToken = process.env.API_BEARER_TOKEN || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.TELEGRAM_CHAT_ID || "";
  const mode = getArg("mode", "telegram");
  const status = getArg("status", "");
  const minCount = getArg("minCount", "");
  const sortBy = getArg("sortBy", "count");
  const sortDir = getArg("sortDir", "desc");

  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (minCount) query.set("minCount", minCount);
  if (sortBy) query.set("sortBy", sortBy);
  if (sortDir) query.set("sortDir", sortDir);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  if (mode === "telegram") {
    if (!botToken || !chatId) {
      throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required for mode=telegram");
    }
    const text = await fetchText(`${apiBase}/reports/pipeline.telegram${suffix}`, apiToken);
    await sendTelegram(text, botToken, chatId);
    console.log("pipeline report sent to Telegram");
    return;
  }

  const channels = await fetchJson(`${apiBase}/reports/pipeline.channels${suffix}`, apiToken);
  if (mode === "markdown" || mode === "md") {
    process.stdout.write(channels.markdown + "\n");
    return;
  }
  if (mode === "html") {
    process.stdout.write(channels.html + "\n");
    return;
  }
  if (mode === "json") {
    process.stdout.write(JSON.stringify(channels, null, 2) + "\n");
    return;
  }

  throw new Error(`Unsupported --mode=${mode}. Use telegram|markdown|html|json`);
}

main().catch((error) => {
  console.error(`[send_pipeline_report] ${String(error.message || error)}`);
  process.exit(1);
});
