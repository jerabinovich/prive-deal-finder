import { Injectable } from "@nestjs/common";
import { AgentRunStatus, WorkflowTaskSource, WorkflowTaskStatus } from "@prisma/client";
import { createHash } from "crypto";
import { PrismaService } from "../shared/prisma.service";
import { promptForTask } from "./prompts";
import { agentResponseSchema } from "./schemas/agent-response.schema";
import { computeCloseProbability } from "./scoring/close-probability";
import { computeOpportunityActionabilityScore } from "./scoring/opportunity-score";
import { applyRevenueSplit, normalizeSplitConfig } from "./scoring/revenue-split";
import { OpenAIResponsesClient } from "./openai-responses.client";
import { ToolRegistry } from "./tool-registry";
import {
  AgentDecision,
  AgentExecutionContext,
  AgentRecommendationPayload,
  AgentWorkflowTaskInput,
  AgentWorkflowTaskSummary,
} from "./types";

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistry,
    private readonly openaiResponsesClient: OpenAIResponsesClient,
  ) {}

  private agentsEnabled() {
    return String(process.env.AGENTS_V1_ENABLED || "false").toLowerCase() === "true";
  }

  private responsesEnabled() {
    return String(process.env.AGENTS_RESPONSES_ENABLED || "false").toLowerCase() === "true";
  }

  private webVerifyEnabled() {
    return String(process.env.AGENTS_WEB_VERIFY_ENABLED || "false").toLowerCase() === "true";
  }

  private model() {
    return process.env.AGENTS_DEFAULT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  }

  private timeoutMs() {
    const parsed = Number(process.env.AGENTS_TIMEOUT_MS || 20000);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
  }

  private needsLiveVerification(params: {
    hasMissingCritical: boolean;
    nextEventDate?: Date | null;
    updatedAt?: Date | null;
    hasOfficialDistressEvidence: boolean;
  }) {
    if (params.hasMissingCritical) return true;
    const now = Date.now();
    if (params.nextEventDate) {
      const diffHours = (now - params.nextEventDate.getTime()) / (1000 * 60 * 60);
      if (diffHours > 72) return true;
    }
    if (params.updatedAt) {
      const diffHours = (now - params.updatedAt.getTime()) / (1000 * 60 * 60);
      if (diffHours > 24 && !params.hasOfficialDistressEvidence) return true;
    }
    return false;
  }

  private extractSqlAdhocQuery(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return null;

    const codeBlock = trimmed.match(/```sql\s*([\s\S]*?)```/i);
    if (codeBlock?.[1]?.trim()) return codeBlock[1].trim();

    const prefixed = trimmed.match(/^(?:\/sql|sql:|consulta_sql:)\s*([\s\S]+)$/i);
    if (prefixed?.[1]?.trim()) return prefixed[1].trim();

    if (/^\s*(select|with)\b/i.test(trimmed)) return trimmed;
    return null;
  }

  private buildWorkflowTasks(input: {
    lane?: string | null;
    recommendedAction: AgentDecision;
    hasOfficialDistressEvidence: boolean;
    hasCriticalMissing: boolean;
  }): AgentWorkflowTaskInput[] {
    const lane = String(input.lane || "RESEARCH_REQUIRED").toUpperCase();
    if (lane === "NON_ACQUIRABLE_NOISE") {
      return [
        {
          lane,
          taskType: "ARCHIVE_NOISE",
          title: "Archive non-acquirable parcel",
          description: "Route non-actionable parcel out of active acquisition queue.",
          priority: 1,
        },
      ];
    }
    if (lane === "DISTRESS_OWNER") {
      return [
        {
          lane,
          taskType: "VERIFY_FILING",
          title: "Validate official distress filing",
          description: "Confirm case/reference/date from official county/court source.",
          priority: 1,
        },
        {
          lane,
          taskType: "PREPARE_OUTREACH",
          title: "Prepare owner outreach script",
          description: "Generate transparent outreach script and log draft.",
          priority: 2,
        },
      ];
    }
    if (lane === "AUCTION_MONITOR") {
      return [
        {
          lane,
          taskType: "VERIFY_AUCTION_DATE",
          title: "Confirm auction date and case number",
          description: "Verify auction milestone in official docket/trustee feed.",
          priority: 1,
        },
        {
          lane,
          taskType: "SET_AUCTION_ALERT",
          title: "Create auction change alert",
          description: "Track date changes, postponements, and status updates.",
          priority: 1,
        },
      ];
    }
    if (lane === "GOV_LAND_P3") {
      return [
        {
          lane,
          taskType: "VERIFY_DISPOSITION",
          title: "Verify disposition evidence",
          description: "Confirm surplus/RFP/IFB/auction source before pursuit.",
          priority: 1,
        },
      ];
    }

    const tasks: AgentWorkflowTaskInput[] = [
      {
        lane,
        taskType: "COMPLETE_FACTS",
        title: "Complete missing critical facts",
        description: "Enrich APN/address/asking/sqft before final decision.",
        priority: 1,
      },
    ];
    if (input.recommendedAction === "CONTACT_NOW" && input.hasOfficialDistressEvidence) {
      tasks.push({
        lane,
        taskType: "OUTREACH_DRAFT",
        title: "Draft compliant outreach and log",
        description: "Prepare call/email/SMS draft and register workflow step.",
        priority: 2,
      });
    }
    if (input.hasCriticalMissing) {
      tasks.push({
        lane,
        taskType: "RECOMPUTE",
        title: "Recompute comps and insights",
        description: "Recompute after missing critical fields are filled.",
        priority: 2,
      });
    }
    return tasks;
  }

  private async persistWorkflowTasks(dealId: string, tasks: AgentWorkflowTaskInput[]) {
    const existing = await this.prisma.dealWorkflowTask.findMany({
      where: { dealId, status: { in: [WorkflowTaskStatus.TODO, WorkflowTaskStatus.IN_PROGRESS, WorkflowTaskStatus.BLOCKED] } },
      select: { id: true, taskType: true, title: true },
    });
    const fingerprint = new Set(existing.map((item) => `${item.taskType}::${item.title}`));

    const created: AgentWorkflowTaskSummary[] = [];
    for (const task of tasks) {
      const key = `${task.taskType}::${task.title}`;
      if (fingerprint.has(key)) continue;
      const row = await this.prisma.dealWorkflowTask.create({
        data: {
          dealId,
          lane: (task.lane as any) ?? null,
          taskType: task.taskType,
          title: task.title,
          description: task.description,
          priority: task.priority ?? 3,
          status: (task.status as WorkflowTaskStatus) ?? WorkflowTaskStatus.TODO,
          source: (task.source as WorkflowTaskSource) ?? WorkflowTaskSource.AGENT,
          dueAt: task.dueAt ? new Date(task.dueAt) : null,
          metadata: task.metadata ? JSON.stringify(task.metadata) : null,
        },
      });
      created.push({
        id: row.id,
        dealId: row.dealId,
        lane: row.lane,
        taskType: row.taskType,
        title: row.title,
        description: row.description,
        priority: row.priority,
        status: row.status as any,
        dueAt: row.dueAt?.toISOString() ?? null,
        source: row.source as any,
      });
    }
    return created;
  }

  private fallbackAnswer(params: {
    recommendedAction: AgentDecision;
    confidence: "low" | "medium" | "high";
    hasCriticalMissing: boolean;
    hasOutlierSpread: boolean;
    splitPositive: boolean;
    closeProbability: number;
    marginPct: number;
  }) {
    const notes: string[] = [];
    if (params.hasCriticalMissing) notes.push("faltan datos críticos");
    if (params.hasOutlierSpread) notes.push("hay outlier de spread");
    if (!params.splitPositive) notes.push("split no positivo");
    return [
      `Recomendación: ${params.recommendedAction}.`,
      `Confianza: ${params.confidence}.`,
      `Margen neto estimado ${params.marginPct.toFixed(1)}% y probabilidad de cierre ${(params.closeProbability * 100).toFixed(1)}%.`,
      notes.length ? `Bloqueadores: ${notes.join(", ")}.` : "Sin bloqueadores críticos detectados.",
    ].join(" ");
  }

  async run(context: AgentExecutionContext): Promise<AgentRecommendationPayload | null> {
    if (!this.agentsEnabled()) return null;

    const startedAt = Date.now();
    const toolCalls: Array<{ name: any; args: Record<string, unknown> }> = [];
    let liveVerificationUsed = false;
    const guardrailsTriggered: string[] = [];

    let dealOverview: Record<string, unknown> | null = null;
    let dealKnowledgeGraph: Record<string, unknown> | null = null;
    let projection: Record<string, unknown> | null = null;
    let ownerProfile: Record<string, unknown> | null = null;
    let workflowSnapshot: unknown[] = [];
    let alertSnapshot: Record<string, unknown> | null = null;
    let chatHistory: unknown[] = [];
    let portfolioSnapshot: Record<string, unknown> | null = null;
    let pipelineReport: unknown[] = [];
    let distressSignals: unknown[] = [];
    let outreachHistory: unknown[] = [];
    let pipelineRows: Record<string, unknown> | null = null;
    let integrationSnapshot: unknown = null;
    let integrationStatus: unknown = null;
    let recentRuns: unknown = null;
    let sqlAdhocResult: Record<string, unknown> | null = null;
    let webVerification: unknown = null;

    if (context.dealId) {
      toolCalls.push({ name: "get_deal_knowledge_graph", args: { dealId: context.dealId } });
      dealKnowledgeGraph = (await this.toolRegistry.executeReadTool("get_deal_knowledge_graph", {
        dealId: context.dealId,
      })) as Record<string, unknown>;
      const graphOverview = asRecord(dealKnowledgeGraph.overview);
      if (Object.keys(graphOverview).length) {
        dealOverview = graphOverview;
      } else {
        toolCalls.push({ name: "get_deal_overview", args: { dealId: context.dealId } });
        dealOverview = (await this.toolRegistry.executeReadTool("get_deal_overview", {
          dealId: context.dealId,
        })) as Record<string, unknown>;
      }

      toolCalls.push({ name: "get_projection", args: { dealId: context.dealId, scenario: "base" } });
      projection = (await this.toolRegistry.executeReadTool("get_projection", {
        dealId: context.dealId,
        scenario: "base",
      })) as Record<string, unknown>;

      toolCalls.push({ name: "get_owner_profile", args: { dealId: context.dealId } });
      ownerProfile = (await this.toolRegistry.executeReadTool("get_owner_profile", {
        dealId: context.dealId,
      })) as Record<string, unknown>;

      toolCalls.push({ name: "get_workflow_tasks", args: { dealId: context.dealId, limit: 50 } });
      workflowSnapshot = (await this.toolRegistry.executeReadTool("get_workflow_tasks", {
        dealId: context.dealId,
        limit: 50,
      })) as unknown[];

      toolCalls.push({ name: "get_alerts_snapshot", args: { userId: context.userId, dealId: context.dealId, limit: 25 } });
      alertSnapshot = (await this.toolRegistry.executeReadTool("get_alerts_snapshot", {
        userId: context.userId,
        dealId: context.dealId,
        limit: 25,
      })) as Record<string, unknown>;

      toolCalls.push({ name: "get_distress_signals", args: { dealId: context.dealId } });
      distressSignals = (await this.toolRegistry.executeReadTool("get_distress_signals", { dealId: context.dealId })) as unknown[];

      toolCalls.push({ name: "get_outreach_history", args: { dealId: context.dealId } });
      outreachHistory = (await this.toolRegistry.executeReadTool("get_outreach_history", { dealId: context.dealId })) as unknown[];

      toolCalls.push({ name: "get_chat_history", args: { sessionId: context.sessionId, limit: 12 } });
      chatHistory = (await this.toolRegistry.executeReadTool("get_chat_history", {
        sessionId: context.sessionId,
        limit: 12,
      })) as unknown[];
    } else {
      toolCalls.push({ name: "list_pipeline_rows", args: { market: context.market, limit: 25 } });
      pipelineRows = (await this.toolRegistry.executeReadTool("list_pipeline_rows", { market: context.market, limit: 25 })) as Record<
        string,
        unknown
      >;
      toolCalls.push({ name: "get_portfolio_snapshot", args: { market: context.market, limit: 20 } });
      portfolioSnapshot = (await this.toolRegistry.executeReadTool("get_portfolio_snapshot", {
        market: context.market,
        limit: 20,
      })) as Record<string, unknown>;
      toolCalls.push({ name: "get_pipeline_report", args: {} });
      pipelineReport = (await this.toolRegistry.executeReadTool("get_pipeline_report", {})) as unknown[];
      toolCalls.push({ name: "get_integration_status", args: {} });
      integrationStatus = await this.toolRegistry.executeReadTool("get_integration_status", {});
      toolCalls.push({ name: "get_recent_runs", args: { limit: 20 } });
      recentRuns = await this.toolRegistry.executeReadTool("get_recent_runs", { limit: 20 });
      toolCalls.push({ name: "get_alerts_snapshot", args: { userId: context.userId, limit: 25 } });
      alertSnapshot = (await this.toolRegistry.executeReadTool("get_alerts_snapshot", {
        userId: context.userId,
        limit: 25,
      })) as Record<string, unknown>;
      toolCalls.push({ name: "get_chat_history", args: { sessionId: context.sessionId, limit: 12 } });
      chatHistory = (await this.toolRegistry.executeReadTool("get_chat_history", {
        sessionId: context.sessionId,
        limit: 12,
      })) as unknown[];
    }

    toolCalls.push({ name: "get_integration_snapshot", args: { limit: 20 } });
    integrationSnapshot = await this.toolRegistry.executeReadTool("get_integration_snapshot", { limit: 20 });

    if (!integrationStatus) {
      toolCalls.push({ name: "get_integration_status", args: {} });
      integrationStatus = await this.toolRegistry.executeReadTool("get_integration_status", {});
    }
    if (!recentRuns) {
      toolCalls.push({ name: "get_recent_runs", args: { limit: 20 } });
      recentRuns = await this.toolRegistry.executeReadTool("get_recent_runs", { limit: 20 });
    }

    const sqlAdhocQuery = this.extractSqlAdhocQuery(context.message);
    if (sqlAdhocQuery) {
      const sqlArgs = { sql: sqlAdhocQuery, maxRows: 100 };
      toolCalls.push({ name: "readonly_sql_query", args: sqlArgs });
      sqlAdhocResult = (await this.toolRegistry.executeReadTool("readonly_sql_query", sqlArgs)) as Record<string, unknown>;
    }

    const deal = asRecord(dealOverview?.deal);
    const facts = asRecord(dealOverview?.facts);
    const opportunitySummary = asRecord(dealOverview?.opportunitySummary);
    const completeness = readNumber(asRecord(dealOverview?.dataQuality), "completenessScore")
      ?? readNumber(asRecord(dealOverview?.completeness), "score")
      ?? readNumber(deal, "dataCompletenessScore")
      ?? 0;
    const spread = readNumber(opportunitySummary, "spreadToAskPct");
    const distressStage = readString(opportunitySummary, "distressStage")
      ?? readString(asRecord(dealOverview?.operationalDecision), "distressStage")
      ?? "UNKNOWN";
    const lane = readString(opportunitySummary, "lane")
      ?? readString(asRecord(dealOverview?.operationalDecision), "lane")
      ?? "RESEARCH_REQUIRED";
    const hasOfficialDistressEvidence = readString(opportunitySummary, "foreclosureStatus") === "confirmed_by_official_source";

    const hasCriticalMissing =
      !readString(deal, "parcelId") && !readString(deal, "address")
        ? true
        : readNumber(deal, "askingPrice") === null &&
            readNumber(facts, "askingPrice") === null &&
            readNumber(deal, "pricePerSqft") === null &&
            readNumber(facts, "buildingSizeSqft") === null;
    if (hasCriticalMissing) guardrailsTriggered.push("MISSING_CRITICAL_FACTS");

    const hasOutlierSpread = typeof spread === "number" && (spread > 150 || spread < -10);
    if (hasOutlierSpread) guardrailsTriggered.push("DATA_ANOMALY_OUTLIER");

    const nextEventDate = readString(asRecord(dealOverview?.operationalDecision), "nextEventDate");
    const updatedAtIso = readString(deal, "updatedAt");
    const shouldVerify = this.webVerifyEnabled()
      && this.needsLiveVerification({
        hasMissingCritical: hasCriticalMissing,
        nextEventDate: nextEventDate ? new Date(nextEventDate) : null,
        updatedAt: updatedAtIso ? new Date(updatedAtIso) : null,
        hasOfficialDistressEvidence,
      });

    if (shouldVerify) {
      toolCalls.push({
        name: "web_verify",
        args: { query: context.message, intent: context.taskType, allowlistTier: "A_B" },
      });
      webVerification = await this.toolRegistry.executeReadTool("web_verify", {
        query: context.message,
        intent: context.taskType,
        allowlistTier: "A_B",
      });
      liveVerificationUsed = true;
    }

    const projectionMetrics = asRecord(asRecord(projection).metrics);
    const profitNet = readNumber(projectionMetrics, "profit") ?? 0;
    const totalInvested = readNumber(projectionMetrics, "totalInvested") ?? 0;
    const marginPct = totalInvested > 0 ? Number(((profitNet / totalInvested) * 100).toFixed(2)) : 0;

    const closeProbability = computeCloseProbability({
      distressStage,
      contactabilityScore:
        readNumber(asRecord(dealOverview?.operationalDecision), "contactabilityScore") ?? readNumber(deal, "contactabilityScore"),
      completenessScore: completeness,
      hasCriticalBlocker: hasCriticalMissing || hasOutlierSpread,
    });

    const splitConfigDb = context.dealId
      ? await this.prisma.dealRevenueSplitConfig.findUnique({ where: { dealId: context.dealId } })
      : null;
    const splitConfig = normalizeSplitConfig(
      splitConfigDb
        ? { operatorPct: splitConfigDb.operatorPct, investorPct: splitConfigDb.investorPct }
        : { operatorPct: 0.5, investorPct: 0.5 },
    );
    const splitOutcome = applyRevenueSplit(profitNet, splitConfig);
    if (!splitOutcome.splitPositive) guardrailsTriggered.push("SPLIT_NOT_POSITIVE");

    const actionabilityScore = computeOpportunityActionabilityScore({
      marginPct,
      closeProbability,
      hasOfficialDistressEvidence,
      hasCriticalBlockers: hasCriticalMissing || hasOutlierSpread,
      splitPositive: splitOutcome.splitPositive,
    });

    let recommendedAction: AgentDecision = "MONITOR";
    if (lane === "NON_ACQUIRABLE_NOISE") recommendedAction = "ARCHIVE";
    else if (lane === "GOV_LAND_P3") recommendedAction = "GOV_PURSUE";
    else if (
      hasOfficialDistressEvidence &&
      marginPct >= (splitConfigDb?.minNetMarginPct ?? 10) &&
      closeProbability >= ((splitConfigDb?.minCloseProbPct ?? 50) / 100) &&
      splitOutcome.splitPositive
    ) {
      recommendedAction = "CONTACT_NOW";
    } else if (distressStage === "AUCTION_SCHEDULED") {
      recommendedAction = "AUCTION_PREP";
    } else if (hasCriticalMissing) {
      recommendedAction = "RESEARCH";
    }

    const confidence: "low" | "medium" | "high" =
      hasCriticalMissing || hasOutlierSpread
        ? "low"
        : actionabilityScore >= 80
          ? "high"
          : actionabilityScore >= 55
            ? "medium"
            : "low";

    const workflowTaskInputs = this.buildWorkflowTasks({
      lane,
      recommendedAction,
      hasOfficialDistressEvidence,
      hasCriticalMissing,
    });
    const persistedTasks = context.dealId ? await this.persistWorkflowTasks(context.dealId, workflowTaskInputs) : [];
    const workflowTasks: AgentWorkflowTaskSummary[] = persistedTasks.length
      ? persistedTasks
      : workflowTaskInputs.map((task) => ({
          taskType: task.taskType,
          title: task.title,
          description: task.description,
          priority: task.priority ?? 3,
          status: (task.status as any) ?? "TODO",
          source: (task.source as any) ?? "AGENT",
        }));

    const model = this.model();
    const prompt = promptForTask(context.taskType);
    const inputPayload = {
      message: context.message,
      taskType: context.taskType,
      context: {
        appState: context.appState ?? null,
        dealKnowledgeGraph,
        dealOverview,
        ownerProfile,
        workflowSnapshot,
        alertSnapshot,
        chatHistory,
        projection,
        distressSignals,
        outreachHistory,
        pipelineRows,
        portfolioSnapshot,
        pipelineReport,
        integrationSnapshot,
        integrationStatus,
        recentRuns,
        sqlAdhocResult,
      },
      computed: {
        recommendedAction,
        marginPct,
        closeProbability,
        splitOutcome,
        actionabilityScore,
        guardrailsTriggered,
      },
      webVerification,
    };

    let llmText = "";
    let tokenUsage: number | undefined;
    if (this.responsesEnabled()) {
      const llm = await this.openaiResponsesClient.generateJson({
        model,
        systemPrompt: prompt,
        userInput: inputPayload,
        schema: agentResponseSchema,
        timeoutMs: this.timeoutMs(),
      });
      if (llm.ok) {
        llmText = llm.text;
        tokenUsage = llm.tokenUsage;
      } else {
        guardrailsTriggered.push("RESPONSES_FALLBACK");
        if (llm.reason) {
          guardrailsTriggered.push(`RESPONSES_${String(llm.reason).slice(0, 64)}`);
        }
      }
    }

    const parsed = llmText ? (JSON.parse(llmText) as Record<string, unknown>) : null;
    const sqlRows = Array.isArray(sqlAdhocResult?.rows) ? (sqlAdhocResult?.rows as Array<Record<string, unknown>>) : [];
    const sqlError = typeof sqlAdhocResult?.error === "string" ? sqlAdhocResult.error : null;
    const sqlColumns = Array.isArray(sqlAdhocResult?.columns)
      ? (sqlAdhocResult.columns as unknown[]).map((column) => String(column))
      : [];
    const sqlSummary =
      sqlAdhocResult
        ? sqlError
          ? `Consulta SQL rechazada: ${sqlError}`
          : `Consulta SQL ejecutada: ${sqlRows.length} filas, columnas: ${sqlColumns.join(", ") || "n/a"}.`
        : null;
    const thesis = parsed && typeof parsed.thesis === "string" ? parsed.thesis : `Actionability score ${actionabilityScore.toFixed(1)}.`;
    const answer =
      parsed && typeof parsed.answer === "string"
        ? parsed.answer
        : sqlSummary
          ? sqlSummary
        : this.fallbackAnswer({
            recommendedAction,
            confidence,
            hasCriticalMissing,
            hasOutlierSpread,
            splitPositive: splitOutcome.splitPositive,
            closeProbability,
            marginPct,
          });
    const nextAction =
      parsed && typeof parsed.nextAction === "string"
        ? parsed.nextAction
        : workflowTasks[0]?.title || `${recommendedAction}`;

    const guardrails = Array.from(new Set(guardrailsTriggered));
    const inputHash = createHash("sha256").update(JSON.stringify(inputPayload)).digest("hex");

    const agentRun = await this.prisma.agentRun.create({
      data: {
        userId: context.userId,
        sessionId: context.sessionId,
        dealId: context.dealId ?? null,
        taskType: context.taskType,
        model,
        status: guardrails.includes("RESPONSES_FALLBACK") ? AgentRunStatus.FALLBACK : AgentRunStatus.SUCCESS,
        latencyMs: Date.now() - startedAt,
        tokenUsage,
        inputHash,
        outputJson: JSON.stringify({
          answer,
          thesis,
          nextAction,
          recommendedAction,
          confidence,
        }),
        guardrailsJson: JSON.stringify(guardrails),
        toolCallsJson: JSON.stringify(toolCalls),
      },
    });

    return {
      agentRunId: agentRun.id,
      answer,
      thesis,
      nextAction,
      lane,
      confidence,
      metrics: {
        marginPct,
        closeProbability: Number((closeProbability * 100).toFixed(1)),
        actionabilityScore,
        spreadToAskPct: spread,
      },
      decisionBlockers: guardrails,
      recommendation: recommendedAction,
      taskTypeResolved: context.taskType,
      guardrailsTriggered: guardrails,
      workflowTasks,
      economics: {
        profitNet: Number(profitNet.toFixed(2)),
        marginPct,
        closeProbability,
      },
      splitOutcome,
      liveVerificationUsed,
      model,
      toolCalls: toolCalls as any,
      tokenUsage,
    };
  }
}
