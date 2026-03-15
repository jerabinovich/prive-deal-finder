import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";
import { DealsService } from "../deals/deals.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { OutreachService } from "../outreach/outreach.service";
import { OpenAIResponsesClient } from "./openai-responses.client";
import { AgentToolName } from "./types";

const DEAL_CLASSIFICATIONS = ["PIPELINE_LISTING", "WATCHLIST", "TRUE_OPPORTUNITY", "DISTRESS_CANDIDATE"] as const;
type DealClassification = (typeof DEAL_CLASSIFICATIONS)[number];

const DEAL_LANES = [
  "DISTRESS_OWNER",
  "AUCTION_MONITOR",
  "GOV_LAND_P3",
  "OFF_MARKET_STANDARD",
  "NON_ACQUIRABLE_NOISE",
  "RESEARCH_REQUIRED",
] as const;
type DealLane = (typeof DEAL_LANES)[number];

function asDealClassification(value: unknown): DealClassification | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return DEAL_CLASSIFICATIONS.includes(normalized as DealClassification) ? (normalized as DealClassification) : undefined;
}

function asDealLane(value: unknown): DealLane | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return DEAL_LANES.includes(normalized as DealLane) ? (normalized as DealLane) : undefined;
}

function parseJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

function asPositiveInt(value: unknown, fallback: number, min = 1, max = 100) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

const READONLY_SQL_TABLE_ALLOWLIST: Record<string, string> = {
  deal: "\"Deal\"",
  dealmetric: "\"DealMetric\"",
  dealmedia: "\"DealMedia\"",
  dealdocument: "\"DealDocument\"",
  dealcomparable: "\"DealComparable\"",
  dealinsight: "\"DealInsight\"",
  dealpainpoint: "\"DealPainPoint\"",
  owner: "\"Owner\"",
  dealowner: "\"DealOwner\"",
  outreachlog: "\"OutreachLog\"",
  integration: "\"Integration\"",
  integrationrun: "\"IntegrationRun\"",
  mdpadatasetsnapshot: "\"MdpaDatasetSnapshot\"",
  mdpasale: "\"MdpaSale\"",
  mdpaassessment: "\"MdpaAssessment\"",
  mdparollevent: "\"MdpaRollEvent\"",
  dealdistresssignal: "\"DealDistressSignal\"",
  dealevent: "\"DealEvent\"",
  dealdecisionaudit: "\"DealDecisionAudit\"",
  dealrevenuesplitconfig: "\"DealRevenueSplitConfig\"",
  dealworkflowtask: "\"DealWorkflowTask\"",
  alertrule: "\"AlertRule\"",
  alertevent: "\"AlertEvent\"",
  alertinboxitem: "\"AlertInboxItem\"",
  agentrun: "\"AgentRun\"",
  chatsession: "\"ChatSession\"",
  chatmessage: "\"ChatMessage\"",
  chatcitationlog: "\"ChatCitationLog\"",
  stagingrecord: "\"StagingRecord\"",
};

const READONLY_SQL_FORBIDDEN_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|call|copy|merge|vacuum|analyze|refresh|set|reset|show|begin|commit|rollback)\b/i;

function normalizeIdentifierToken(raw: string) {
  let token = raw.trim().replace(/,+$/, "");
  if (!token) return "";
  if (token.includes(".")) token = token.split(".").pop() || token;
  token = token.replace(/^"+|"+$/g, "").replace(/^`+|`+$/g, "").replace(/^\[+|\]+$/g, "");
  return token.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function toSerializable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => toSerializable(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toSerializable(entry)]),
    );
  }
  return value;
}

@Injectable()
export class ToolRegistry {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealsService: DealsService,
    private readonly integrationsService: IntegrationsService,
    private readonly outreachService: OutreachService,
    private readonly openAIResponsesClient: OpenAIResponsesClient,
  ) {}

  private resolveAllowedSqlTable(tableToken: string) {
    const normalized = normalizeIdentifierToken(tableToken);
    if (!normalized) return null;
    if (READONLY_SQL_TABLE_ALLOWLIST[normalized]) {
      return {
        key: normalized,
        tableName: READONLY_SQL_TABLE_ALLOWLIST[normalized],
      };
    }

    const compact = normalized.replace(/_/g, "");
    const match = Object.entries(READONLY_SQL_TABLE_ALLOWLIST).find(([key]) => key.replace(/_/g, "") === compact);
    if (!match) return null;
    return {
      key: match[0],
      tableName: match[1],
    };
  }

  private sanitizeReadonlySql(rawSql: string, maxRows: number) {
    const trimmed = rawSql.trim();
    if (!trimmed) return { error: "sql is required" as const };
    if (trimmed.length > 8000) return { error: "sql too long (max 8000 chars)" as const };

    let sql = trimmed.replace(/;\s*$/, "");
    if (sql.includes(";")) return { error: "multiple SQL statements are not allowed" as const };
    if (!/^\s*(select|with)\b/i.test(sql)) return { error: "only SELECT or WITH queries are allowed" as const };
    if (READONLY_SQL_FORBIDDEN_PATTERN.test(sql)) return { error: "query contains forbidden SQL keyword" as const };

    const tableMatches = Array.from(sql.matchAll(/\b(?:from|join)\s+([a-zA-Z0-9_."`[\]]+)/gi));
    if (!tableMatches.length) return { error: "query must include at least one FROM/JOIN table" as const };

    const allowedTables = new Set<string>();
    for (const match of tableMatches) {
      const token = match[1];
      if (!token || token.startsWith("(")) {
        return { error: "subqueries in FROM/JOIN are not supported by readonly_sql_query" as const };
      }
      const resolved = this.resolveAllowedSqlTable(token);
      if (!resolved) {
        const allowed = Object.values(READONLY_SQL_TABLE_ALLOWLIST)
          .map((table) => table.replace(/"/g, ""))
          .join(", ");
        return { error: `table not allowed: ${token}. Allowed tables: ${allowed}` as const };
      }
      allowedTables.add(resolved.tableName);
    }

    sql = sql.replace(/\b(from|join)\s+([a-zA-Z0-9_."`[\]]+)/gi, (all, clause, tableToken) => {
      const resolved = this.resolveAllowedSqlTable(String(tableToken));
      if (!resolved) return all;
      return `${clause} ${resolved.tableName}`;
    });

    const limitMatch = sql.match(/\blimit\s+(\d+)\b/i);
    if (limitMatch) {
      const current = Number(limitMatch[1]);
      if (Number.isFinite(current) && current > maxRows) {
        sql = sql.replace(/\blimit\s+\d+\b/i, `LIMIT ${maxRows}`);
      }
    } else {
      sql = `${sql} LIMIT ${maxRows}`;
    }

    return {
      sql,
      maxRows,
      tables: Array.from(allowedTables),
    };
  }

  private async runReadonlySqlQuery(sql: string, maxRows: number) {
    const sanitized = this.sanitizeReadonlySql(sql, maxRows);
    if ("error" in sanitized) {
      return {
        error: sanitized.error,
      };
    }

    const timeoutMs = Number(process.env.AGENTS_SQL_TIMEOUT_MS || 8000);
    const statementTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.round(timeoutMs) : 8000;
    const startedAt = Date.now();

    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
        const result = await tx.$queryRawUnsafe(sanitized.sql);
        return Array.isArray(result) ? result : [];
      });

      const serializableRows = rows.map((row) => toSerializable(row)) as Array<Record<string, unknown>>;
      const columns = serializableRows[0] ? Object.keys(serializableRows[0]) : [];

      return {
        sql: sanitized.sql,
        rowCount: serializableRows.length,
        columns,
        rows: serializableRows,
        tables: sanitized.tables,
        maxRows: sanitized.maxRows,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "readonly_sql_query failed",
        sql: sanitized.sql,
        tables: sanitized.tables,
      };
    }
  }

  async executeReadTool(name: AgentToolName, args: Record<string, unknown>) {
    if (name === "get_deal_overview") {
      const dealId = String(args.dealId || "");
      if (!dealId) return { error: "dealId is required" };
      return this.dealsService.getOverview(dealId);
    }

    if (name === "readonly_sql_query") {
      const sql = String(args.sql || "").trim();
      if (!sql) return { error: "sql is required" };
      const maxRows = asPositiveInt(args.maxRows, 50, 1, 200);
      return this.runReadonlySqlQuery(sql, maxRows);
    }

    if (name === "get_deal_knowledge_graph") {
      const dealId = String(args.dealId || "");
      if (!dealId) return { error: "dealId is required" };

      const [overview, dealCore, workflowTasks, alerts, outreachLogs, chatSessions] = await Promise.all([
        this.dealsService.getOverview(dealId),
        this.prisma.deal.findUnique({
          where: { id: dealId },
          include: {
            metrics: true,
            painPoints: true,
            owners: { include: { owner: true } },
            insight: true,
            distressSignals: { orderBy: { observedAt: "desc" }, take: 25 },
            events: { orderBy: { eventDate: "desc" }, take: 25 },
            decisionAudits: { orderBy: { createdAt: "desc" }, take: 15 },
            revenueSplitConfig: true,
          },
        }),
        this.prisma.dealWorkflowTask.findMany({
          where: { dealId },
          orderBy: [{ status: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
          take: 50,
        }),
        this.prisma.alertEvent.findMany({
          where: { dealId },
          orderBy: { eventAt: "desc" },
          take: 25,
        }),
        this.prisma.outreachLog.findMany({
          where: { dealId },
          orderBy: { createdAt: "desc" },
          take: 25,
        }),
        this.prisma.chatSession.findMany({
          where: { agentRuns: { some: { dealId } } },
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 6,
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 3,
        }),
      ]);

      if (!dealCore) return { error: "deal not found" };

      return {
        overview,
        deal: {
          ...dealCore,
          insight: dealCore.insight
            ? {
                demographic: parseJson(dealCore.insight.demographicJson),
                climateRisk: parseJson(dealCore.insight.climateRiskJson),
                valuation: parseJson(dealCore.insight.valuationJson),
                updatedAt: dealCore.insight.updatedAt,
              }
            : null,
        },
        workflowTasks,
        alerts: alerts.map((event) => ({
          id: event.id,
          triggerType: event.triggerType,
          severity: event.severity,
          eventAt: event.eventAt,
          payload: parseJson(event.payloadJson),
        })),
        outreachLogs,
        recentChatSessions: chatSessions.map((session) => ({
          id: session.id,
          updatedAt: session.updatedAt,
          messages: session.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
          })),
        })),
      };
    }

    if (name === "list_pipeline_rows") {
      return this.dealsService.list({
        limit: asPositiveInt(args.limit, 25, 1, 50),
        offset: typeof args.offset === "number" ? Math.max(0, args.offset) : 0,
        market: typeof args.market === "string" ? args.market : undefined,
        classification: asDealClassification(args.classification),
        lane: asDealLane(args.lane),
      });
    }

    if (name === "get_portfolio_snapshot") {
      const market = typeof args.market === "string" && args.market.trim() ? args.market.trim() : undefined;
      const where = market ? { market } : {};

      const [totalDeals, laneCounts, actionCounts, distressCounts, classificationCounts, topDeals, upcomingEvents, staleDeals, noisyDeals] =
        await Promise.all([
          this.prisma.deal.count({ where }),
          this.prisma.deal.groupBy({ by: ["lane"], _count: { _all: true }, where }),
          this.prisma.deal.groupBy({ by: ["recommendedAction"], _count: { _all: true }, where }),
          this.prisma.deal.groupBy({ by: ["distressStage"], _count: { _all: true }, where }),
          this.prisma.deal.groupBy({ by: ["status"], _count: { _all: true }, where }),
          this.prisma.deal.findMany({
            where,
            orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
            take: asPositiveInt(args.limit, 15, 1, 30),
            select: {
              id: true,
              name: true,
              market: true,
              score: true,
              lane: true,
              recommendedAction: true,
              distressStage: true,
              dataCompletenessScore: true,
              updatedAt: true,
            },
          }),
          this.prisma.deal.findMany({
            where: {
              ...(market ? { market } : {}),
              nextEventDate: { not: null },
            },
            orderBy: { nextEventDate: "asc" },
            take: 20,
            select: {
              id: true,
              name: true,
              market: true,
              lane: true,
              recommendedAction: true,
              distressStage: true,
              nextEventDate: true,
            },
          }),
          this.prisma.deal.findMany({
            where,
            orderBy: { updatedAt: "asc" },
            take: 20,
            select: {
              id: true,
              name: true,
              market: true,
              lane: true,
              recommendedAction: true,
              updatedAt: true,
            },
          }),
          this.prisma.deal.count({
            where: {
              ...(market ? { market } : {}),
              isNoise: true,
            },
          }),
        ]);

      return {
        market: market ?? null,
        totalDeals,
        noisyDeals,
        laneCounts,
        actionCounts,
        distressCounts,
        classificationCounts,
        topDeals,
        upcomingEvents,
        staleDeals,
      };
    }

    if (name === "get_integration_status") {
      return this.integrationsService.listStatus({});
    }

    if (name === "get_integration_snapshot") {
      const limit = asPositiveInt(args.limit, 50, 1, 200);
      const [integrations, runs] = await Promise.all([
        this.prisma.integration.findMany({
          orderBy: { updatedAt: "desc" },
          take: limit,
        }),
        this.prisma.integrationRun.findMany({
          orderBy: { startedAt: "desc" },
          take: limit,
        }),
      ]);
      const latestRunBySource = new Map<string, (typeof runs)[number]>();
      for (const run of runs) {
        if (!latestRunBySource.has(run.source)) latestRunBySource.set(run.source, run);
      }
      return integrations.map((integration) => {
        const run = latestRunBySource.get(integration.source);
        return {
          source: integration.source,
          status: integration.status,
          lastSyncAt: integration.lastSyncAt,
          lastError: integration.lastError,
          updatedAt: integration.updatedAt,
          latestRun: run
            ? {
                id: run.id,
                status: run.status,
                startedAt: run.startedAt,
                endedAt: run.endedAt,
                message: run.message,
                metrics: parseJson(run.metrics),
              }
            : null,
        };
      });
    }

    if (name === "get_recent_runs") {
      return this.integrationsService.listRuns({
        limit: asPositiveInt(args.limit, 20, 1, 50),
        operatorView: true,
      });
    }

    if (name === "get_pipeline_report") {
      const rows = await this.prisma.deal.groupBy({
        by: ["status"],
        _count: { status: true },
        _avg: { score: true },
      });
      return rows
        .map((row) => ({
          status: row.status,
          count: row._count.status,
          avgScore: row._avg.score ?? 0,
        }))
        .sort((a, b) => b.count - a.count || b.avgScore - a.avgScore);
    }

    if (name === "get_projection") {
      const dealId = String(args.dealId || "");
      if (!dealId) return { error: "dealId is required" };
      const scenario = typeof args.scenario === "string" ? args.scenario : "base";
      return this.dealsService.buildProjection(dealId, { scenario: scenario as "conservative" | "base" | "aggressive" });
    }

    if (name === "get_owner_profile") {
      const dealId = String(args.dealId || "");
      if (!dealId) return { error: "dealId is required" };
      const deal = await this.prisma.deal.findUnique({
        where: { id: dealId },
        select: {
          id: true,
          name: true,
          parcelId: true,
          address: true,
          market: true,
          mailingAddress: true,
          contactabilityScore: true,
          owners: {
            include: {
              owner: true,
            },
          },
        },
      });
      if (!deal) return { error: "deal not found" };

      return {
        dealId: deal.id,
        parcelId: deal.parcelId,
        address: deal.address,
        market: deal.market,
        mailingAddress: deal.mailingAddress,
        contactabilityScore: deal.contactabilityScore,
        owners: deal.owners.map((entry) => ({
          role: entry.role,
          id: entry.owner.id,
          name: entry.owner.name,
          entityType: entry.owner.entityType,
          email: entry.owner.email,
          phone: entry.owner.phone,
          createdAt: entry.owner.createdAt,
          updatedAt: entry.owner.updatedAt,
        })),
      };
    }

    if (name === "get_workflow_tasks") {
      const dealId = typeof args.dealId === "string" ? args.dealId : undefined;
      const userId = typeof args.userId === "string" ? args.userId : undefined;
      const limit = asPositiveInt(args.limit, 50, 1, 100);
      return this.prisma.dealWorkflowTask.findMany({
        where: {
          ...(dealId ? { dealId } : {}),
          ...(userId ? { ownerUserId: userId } : {}),
        },
        orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
        take: limit,
      });
    }

    if (name === "get_alerts_snapshot") {
      const userId = String(args.userId || "").trim();
      if (!userId) return { error: "userId is required" };
      const dealId = typeof args.dealId === "string" ? args.dealId : undefined;
      const limit = asPositiveInt(args.limit, 25, 1, 100);
      const [rules, unreadCount, inbox] = await Promise.all([
        this.prisma.alertRule.findMany({
          where: { userId },
          orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
          take: limit,
        }),
        this.prisma.alertInboxItem.count({
          where: { userId, readAt: null },
        }),
        this.prisma.alertInboxItem.findMany({
          where: {
            userId,
            ...(dealId ? { alertEvent: { dealId } } : {}),
          },
          include: {
            alertEvent: {
              include: {
                deal: {
                  select: {
                    id: true,
                    name: true,
                    lane: true,
                    recommendedAction: true,
                    market: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        }),
      ]);

      return {
        unreadCount,
        rules: rules.map((rule) => ({
          id: rule.id,
          triggerType: rule.triggerType,
          market: rule.market,
          lane: rule.lane,
          active: rule.active,
          delivery: rule.delivery,
          config: parseJson(rule.configJson),
          updatedAt: rule.updatedAt,
        })),
        inbox: inbox.map((item) => ({
          id: item.id,
          readAt: item.readAt,
          deliveredAt: item.deliveredAt,
          channel: item.channel,
          createdAt: item.createdAt,
          alertEvent: {
            id: item.alertEvent.id,
            dealId: item.alertEvent.dealId,
            triggerType: item.alertEvent.triggerType,
            severity: item.alertEvent.severity,
            eventAt: item.alertEvent.eventAt,
            payload: parseJson(item.alertEvent.payloadJson),
            deal: item.alertEvent.deal,
          },
        })),
      };
    }

    if (name === "get_chat_history") {
      const sessionId = String(args.sessionId || "");
      if (!sessionId) return { error: "sessionId is required" };
      return this.prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: asPositiveInt(args.limit, 20, 1, 100),
        select: {
          id: true,
          role: true,
          content: true,
          model: true,
          tokenUsage: true,
          createdAt: true,
          metadata: true,
        },
      });
    }

    if (name === "get_outreach_history") {
      const dealId = String(args.dealId || "");
      if (!dealId) return { error: "dealId is required" };
      return this.prisma.outreachLog.findMany({
        where: { dealId },
        orderBy: { createdAt: "desc" },
        take: 25,
      });
    }

    if (name === "get_distress_signals") {
      const dealId = String(args.dealId || "");
      if (!dealId) return { error: "dealId is required" };
      return this.prisma.dealDistressSignal.findMany({
        where: { dealId },
        orderBy: { observedAt: "desc" },
        take: 25,
      });
    }

    if (name === "web_verify") {
      const query = String(args.query || "").trim();
      if (!query) return { error: "query is required" };
      const intent = typeof args.intent === "string" ? args.intent : "general";
      const model = String(process.env.AGENTS_DEFAULT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini");
      const timeoutMs = Number(process.env.AGENTS_TIMEOUT_MS || 20000);
      const result = await this.openAIResponsesClient.webVerify({
        model,
        query,
        intent,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 20000,
      });
      return result.ok ? { summary: result.text } : { error: result.reason, detail: result.detail };
    }

    return { error: `Unsupported read tool: ${name}` };
  }

  async executeMutatingTool(name: AgentToolName, args: Record<string, unknown>) {
    if (name === "recompute_comps" || name === "recompute_insights" || name === "move_stage" || name === "sync_integration" || name === "archive_deal" || name === "create_alert_rule" || name === "create_workflow_task" || name === "log_outreach") {
      return {
        confirmationRequired: true,
        suggestedTool: name,
        args,
      };
    }
    return { error: `Unsupported mutating tool: ${name}` };
  }

  async logOutreachTemplate(params: { dealId: string; channel: "EMAIL" | "SMS" | "NOTE"; recipient?: string; subject?: string; body?: string }) {
    return this.outreachService.logOutreach({
      dealId: params.dealId,
      channel: params.channel,
      recipient: params.recipient,
      subject: params.subject,
      body: params.body,
      status: "DRAFT_LOGGED",
      sentAt: new Date(),
    });
  }
}
