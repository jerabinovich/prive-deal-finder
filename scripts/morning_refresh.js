#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require("child_process");

const PROJECT_ID = process.env.PROJECT_ID || "privegroup-cloud";
const REGION = process.env.REGION || "us-east1";
const API_SERVICE = process.env.API_SERVICE || "prive-deal-finder-api";
const SMOKE_EMAIL = process.env.SMOKE_EMAIL || "admin@privegroup.com";
const ALLOW_MDPA_AUTOSYNC = String(process.env.ALLOW_MDPA_AUTOSYNC || "false").toLowerCase() === "true";
const MORNING_MDPA_DATASET_TYPE = process.env.MORNING_MDPA_DATASET_TYPE || "MUNICIPAL_ROLLS";
const MORNING_MAX_DEALS = Number(process.env.MORNING_MAX_DEALS || 150);
const MORNING_ONLY_MISSING_FACTS =
  String(process.env.MORNING_ONLY_MISSING_FACTS || "true").toLowerCase() === "true";
const MORNING_RECOMPUTE_COMPS =
  String(process.env.MORNING_RECOMPUTE_COMPS || "true").toLowerCase() === "true";
const MORNING_RECOMPUTE_INSIGHTS =
  String(process.env.MORNING_RECOMPUTE_INSIGHTS || "true").toLowerCase() === "true";
const MORNING_BACKFILL_SOURCE = process.env.MORNING_BACKFILL_SOURCE || "";
const MORNING_BACKFILL_MARKET = process.env.MORNING_BACKFILL_MARKET || "";

function run(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

function resolveApiBase() {
  if (process.env.API_BASE) {
    return process.env.API_BASE.replace(/\/+$/, "");
  }

  const serviceUrl = run(
    `gcloud run services describe ${API_SERVICE} --project ${PROJECT_ID} --region ${REGION} --format='value(status.url)'`
  );
  if (!serviceUrl) {
    throw new Error("Could not resolve Cloud Run API service URL");
  }
  return `${serviceUrl.replace(/\/+$/, "")}/api`;
}

function resolveServiceToken(apiBase) {
  if (process.env.CLOUD_RUN_ID_TOKEN) return process.env.CLOUD_RUN_ID_TOKEN;

  const serviceOrigin = apiBase.replace(/(https:\/\/[^/]+).*/, "$1");
  try {
    return run(`gcloud auth print-identity-token --audiences="${serviceOrigin}"`);
  } catch (_error) {
    try {
      return run("gcloud auth print-identity-token");
    } catch (_innerError) {
      return "";
    }
  }
}

async function requestJson({ apiBase, serviceToken, path, method = "GET", authToken, body }) {
  const headers = { "Content-Type": "application/json" };
  if (serviceToken) {
    headers["X-Serverless-Authorization"] = `Bearer ${serviceToken}`;
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload?.message || payload?.raw || `HTTP ${response.status}`;
    throw new Error(`${method} ${path} failed: ${message}`);
  }

  return payload;
}

async function main() {
  const apiBase = resolveApiBase();
  const serviceToken = resolveServiceToken(apiBase);

  const summary = {
    apiBase,
    integrations: { attempted: 0, succeeded: 0, skipped: 0, errors: [] },
    backfill: null,
    chat: null,
    opportunityCoverage: null,
    chatUtility: null,
  };

  console.log(`[morning-refresh] API_BASE=${apiBase}`);
  console.log(`[morning-refresh] ALLOW_MDPA_AUTOSYNC=${ALLOW_MDPA_AUTOSYNC}`);

  const loginPayload = await requestJson({
    apiBase,
    serviceToken,
    path: "/auth/login",
    method: "POST",
    body: { email: SMOKE_EMAIL },
  });

  const accessToken = loginPayload?.accessToken;
  if (!accessToken) {
    throw new Error("Login did not return accessToken");
  }

  const integrationRows = await requestJson({
    apiBase,
    serviceToken,
    path: "/integrations/status",
    authToken: accessToken,
  });

  for (const row of integrationRows || []) {
    if (!row?.configured) {
      summary.integrations.skipped += 1;
      continue;
    }
    if (row.source === "mdpa" && !ALLOW_MDPA_AUTOSYNC) {
      summary.integrations.skipped += 1;
      continue;
    }

    summary.integrations.attempted += 1;
    try {
      const path =
        row.source === "mdpa" ? "/integrations/mdpa/import" : `/integrations/${row.source}/sync`;
      const body =
        row.source === "mdpa"
          ? { confirmPaidDataUse: true, datasetType: MORNING_MDPA_DATASET_TYPE }
          : undefined;
      await requestJson({
        apiBase,
        serviceToken,
        path,
        method: "POST",
        authToken: accessToken,
        body,
      });
      summary.integrations.succeeded += 1;
      console.log(`[morning-refresh] sync OK: ${row.source}`);
    } catch (error) {
      summary.integrations.errors.push(String(error.message || error));
      console.log(`[morning-refresh] sync ERROR: ${row.source} -> ${String(error.message || error)}`);
    }
  }

  summary.backfill = await requestJson({
    apiBase,
    serviceToken,
    path: "/deals/backfill-facts",
    method: "POST",
    authToken: accessToken,
    body: {
      source: MORNING_BACKFILL_SOURCE || undefined,
      market: MORNING_BACKFILL_MARKET || undefined,
      limit: Math.max(1, Math.min(MORNING_MAX_DEALS, 1000)),
      onlyMissingFacts: MORNING_ONLY_MISSING_FACTS,
      recomputeComparables: MORNING_RECOMPUTE_COMPS,
      recomputeInsights: MORNING_RECOMPUTE_INSIGHTS,
      dryRun: false,
    },
  });
  summary.triage = await requestJson({
    apiBase,
    serviceToken,
    path: "/deals/recompute-triage",
    method: "POST",
    authToken: accessToken,
    body: {
      limit: Math.max(1, Math.min(MORNING_MAX_DEALS, 1000)),
      onlyMissingLane: false,
    },
  });

  summary.chat = await requestJson({
    apiBase,
    serviceToken,
    path: "/chat/query",
    method: "POST",
    authToken: accessToken,
    body: {
      question: "prioritize top opportunities in Palm Beach by score and data quality",
      market: "Palm Beach",
    },
  });

  const totalsPayload = await requestJson({
    apiBase,
    serviceToken,
    path: "/deals?limit=1&offset=0",
    authToken: accessToken,
  });
  const totalDeals = Number(totalsPayload?.total || 0);
  const sampleDealId = totalsPayload?.items?.[0]?.id;

  async function countByClassification(classification) {
    const payload = await requestJson({
      apiBase,
      serviceToken,
      path: `/deals?limit=1&offset=0&classification=${encodeURIComponent(classification)}`,
      authToken: accessToken,
    });
    return Number(payload?.total || 0);
  }

  const [trueOpps, watchlist, pipelineListings, distressConfirmed] = await Promise.all([
    countByClassification("TRUE_OPPORTUNITY"),
    countByClassification("WATCHLIST"),
    countByClassification("PIPELINE_LISTING"),
    countByClassification("DISTRESS_CANDIDATE"),
  ]);
  async function countByLane(lane) {
    const payload = await requestJson({
      apiBase,
      serviceToken,
      path: `/deals?limit=1&offset=0&lane=${encodeURIComponent(lane)}`,
      authToken: accessToken,
    });
    return Number(payload?.total || 0);
  }

  const [distressLane, auctionLane, offMarketLane, govLane, noiseLane, researchLane] = await Promise.all([
    countByLane("DISTRESS_OWNER"),
    countByLane("AUCTION_MONITOR"),
    countByLane("OFF_MARKET_STANDARD"),
    countByLane("GOV_LAND_P3"),
    countByLane("NON_ACQUIRABLE_NOISE"),
    countByLane("RESEARCH_REQUIRED"),
  ]);

  const pct = (value) => (totalDeals > 0 ? Number(((value / totalDeals) * 100).toFixed(1)) : 0);
  summary.opportunityCoverage = {
    totalDeals,
    trueOpportunities: trueOpps,
    watchlist,
    pipelineListings,
    distressConfirmed,
    trueOpportunitiesPct: pct(trueOpps),
    watchlistPct: pct(watchlist),
    pipelineListingsPct: pct(pipelineListings),
    distressConfirmedPct: pct(distressConfirmed),
    lanes: {
      distressLane,
      auctionLane,
      offMarketLane,
      govLane,
      noiseLane,
      researchLane,
    },
  };

  const chatPrompts = [
    { question: "por que esto es un deal", dealId: sampleDealId || undefined },
    { question: "prioritize top opportunities in Palm Beach", market: "Palm Beach" },
  ];
  const chatChecks = [];
  for (const prompt of chatPrompts) {
    const response = await requestJson({
      apiBase,
      serviceToken,
      path: "/chat/query",
      method: "POST",
      authToken: accessToken,
      body: prompt,
    });
    const hasThesis = typeof response?.thesis === "string" && response.thesis.trim().length > 0;
    const hasNextAction = typeof response?.nextAction === "string" && response.nextAction.trim().length > 0;
    const hasAction = Array.isArray(response?.suggestedActions) && response.suggestedActions.length > 0;
    chatChecks.push({
      prompt: prompt.question,
      hasThesis,
      hasNextAction,
      hasAction,
      confidence: response?.confidence || "unknown",
    });
  }
  const utilityCount = chatChecks.filter((item) => item.hasThesis && item.hasAction && item.hasNextAction).length;
  summary.chatUtility = {
    checks: chatChecks,
    completeResponses: utilityCount,
    completeResponsesPct: chatChecks.length ? Number(((utilityCount / chatChecks.length) * 100).toFixed(1)) : 0,
  };

  console.log("[morning-refresh] summary");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.integrations.errors.length || (summary.backfill?.totals?.errors ?? 0) > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[morning-refresh] fatal: ${String(error.message || error)}`);
  process.exit(1);
});
