import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatMessageRole } from "@prisma/client";
import { createHash } from "crypto";
import { AgentsService } from "../agents/agents.service";
import { DealsService } from "../deals/deals.service";
import { PrismaService } from "../shared/prisma.service";
import { ChatQueryDto } from "./dto/chat-query.dto";
import { ChatSuggestFiltersDto } from "./dto/chat-suggest-filters.dto";

type Citation = {
  sourceType: "deal_overview" | "deal_list" | "integration_status" | "report_pipeline" | "system";
  sourceId?: string | null;
  label: string;
  value?: string | null;
};

type SuggestedAction = {
  type:
    | "open_deal"
    | "apply_filters"
    | "go_integrations"
    | "recompute_comps"
    | "recompute_insights"
    | "move_stage"
    | "sync_integration"
    | "archive_deal"
    | "create_alert";
  label: string;
  payload?: Record<string, unknown>;
};

type Confidence = "high" | "medium" | "low";
type ChatIntent = "why_deal" | "deal_vs_listing" | "new_deals" | "top_opportunities" | "general";
type ChatTaskType = "CHAT_COPILOT" | "PIPELINE_TRIAGE" | "DEAL_DEEP_DIVE" | "GOV_LAND_PROFILE";

type PromptTemplateName = "deal_detail" | "market" | "integrations" | "reports";
type DeterministicIntent = {
  intent: ChatIntent;
  answer: string;
  thesis: string;
  nextAction: string;
  lane?: string;
  metrics?: Record<string, string | number | null>;
  decisionBlockers?: string[];
  confidence: Confidence;
  citations: Citation[];
  suggestedActions: SuggestedAction[];
  appliedFilters: Record<string, unknown>;
};

type CopilotDataRequest = {
  key:
    | "PIPELINE_ROWS"
    | "DEAL_DETAILS"
    | "OWNER"
    | "DISTRESS_EVIDENCE"
    | "COMPS"
    | "INTEGRATIONS_STATUS"
    | "RECENT_RUNS"
    | "ALERTS"
    | "CONTACT_LOG";
  params?: Record<string, unknown>;
  why?: string;
};

type CopilotUiAction = {
  action:
    | "OPEN_DEAL"
    | "APPLY_FILTERS"
    | "MARK_DD"
    | "MOVE_STAGE"
    | "RECOMPUTE_COMPS"
    | "RECOMPUTE_INSIGHTS"
    | "CREATE_ALERT"
    | "SYNC_INTEGRATION"
    | "ARCHIVE_DEAL"
    | "GO_INTEGRATIONS";
  label: string;
  params?: Record<string, unknown>;
  shouldAutoExecute?: boolean;
  why?: string;
};

type CopilotMemoryUpdate = {
  userGoal?: string;
  buyBox?: string;
  riskTolerance?: string;
  preferredMarkets?: string[];
};

type ContextEcho = {
  route?: string;
  selectedDealKey?: string | null;
  pipelineVisibleRange?: string | null;
  activeFiltersCount?: number | null;
  marketsInView?: string[];
};

const NUMERIC_TOKEN_PATTERN = /[$]?\d[\d,.]*(?:\.\d+)?%?/g;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly dealsService: DealsService,
    private readonly agentsService: AgentsService,
  ) {}

  private ensureEnabled() {
    const configured = this.config.get<string | boolean>("CHAT_ENABLE", "true");
    const enabled =
      typeof configured === "boolean"
        ? configured
        : String(configured).trim().toLowerCase() !== "false";
    if (!enabled) {
      throw new BadRequestException("Chat is disabled by configuration");
    }
  }

  private getModel() {
    return this.config.get<string>("OPENAI_MODEL", "gpt-4.1-mini");
  }

  private getTimeoutMs() {
    const configured = Number(this.config.get<string>("OPENAI_TIMEOUT_MS", "12000"));
    return Number.isFinite(configured) && configured > 0 ? configured : 12000;
  }

  private getMaxContextDeals() {
    const configured = Number(this.config.get<string>("CHAT_MAX_CONTEXT_DEALS", "20"));
    return Number.isFinite(configured) && configured > 0 ? configured : 20;
  }

  private isStructuredV2Enabled() {
    const configured = this.config.get<string | boolean>("CHAT_STRUCTURED_V2", true);
    if (typeof configured === "boolean") return configured;
    return String(configured).trim().toLowerCase() !== "false";
  }

  private async getOrCreateSession(userId: string, sessionId?: string) {
    if (sessionId) {
      const session = await this.prisma.chatSession.findFirst({ where: { id: sessionId, userId } });
      if (session) return session;
    }

    return this.prisma.chatSession.create({
      data: {
        userId,
        title: "Prive AI Chat",
      },
    });
  }

  private async buildContext(dealId?: string, market?: string) {
    const citations: Citation[] = [];

    if (dealId) {
      const overview = await this.dealsService.getOverview(dealId);
      if (!overview) {
        throw new NotFoundException("Deal not found for chat context");
      }

      const score = overview.deal.score ?? null;
      const askingPrice = overview.deal.askingPrice ?? null;
      const completeness = overview.dataQuality?.completenessScore ?? overview.completeness?.score ?? null;
      const opportunityScore = overview.opportunitySummary?.score ?? null;
      const opportunityClassification = overview.opportunitySummary?.classification ?? null;
      const opportunityLane = overview.opportunitySummary?.lane ?? null;
      const recommendedAction = overview.opportunitySummary?.recommendedAction ?? null;
      const comparableCount = overview.comparables?.length ?? 0;
      const latestSale = overview.sales?.[0] ?? null;
      const failedGates = Object.values(overview.opportunitySummary?.gates ?? {})
        .filter((gate) => !gate.passed)
        .map((gate) => gate.label);

      citations.push({
        sourceType: "deal_overview",
        sourceId: dealId,
        label: `Deal Overview: ${overview.deal.name}`,
        value: `Market ${overview.deal.market ?? "n/a"} | Pipeline Score ${score ?? "n/a"} | Asking ${askingPrice ?? "n/a"}`,
      });
      if (opportunityScore !== null) {
        citations.push({
          sourceType: "deal_overview",
          sourceId: dealId,
          label: "Opportunity score",
          value: `${opportunityScore}`,
        });
      }
      if (opportunityClassification) {
        citations.push({
          sourceType: "deal_overview",
          sourceId: dealId,
          label: "Opportunity classification",
          value: opportunityClassification,
        });
      }
      if (opportunityLane) {
        citations.push({
          sourceType: "deal_overview",
          sourceId: dealId,
          label: "Operational lane",
          value: opportunityLane,
        });
      }
      if (recommendedAction) {
        citations.push({
          sourceType: "deal_overview",
          sourceId: dealId,
          label: "Recommended action",
          value: recommendedAction,
        });
      }
      if (completeness !== null) {
        citations.push({
          sourceType: "deal_overview",
          sourceId: dealId,
          label: "Data completeness",
          value: `${completeness}%`,
        });
      }
      citations.push({
        sourceType: "deal_overview",
        sourceId: dealId,
        label: "Comparable coverage",
        value: `${comparableCount}`,
      });
      citations.push({
        sourceType: "deal_overview",
        sourceId: dealId,
        label: "Sales & assessments coverage",
        value: `sales ${(overview.sales ?? []).length} | assessments ${(overview.assessments ?? []).length}`,
      });
      citations.push({
        sourceType: "deal_overview",
        sourceId: dealId,
        label: "Fact coverage",
        value: `lot ${overview.facts?.lotSizeSqft ?? "n/a"} | bldg ${overview.facts?.buildingSizeSqft ?? "n/a"} | year ${overview.facts?.yearBuilt ?? "n/a"} | ask ${overview.facts?.askingPrice ?? "n/a"}`,
      });
      if (failedGates.length) {
        citations.push({
          sourceType: "deal_overview",
          sourceId: dealId,
          label: "Failed gates",
          value: failedGates.join(", "),
        });
      }
      if (latestSale?.salePrice || latestSale?.saleDate) {
        citations.push({
          sourceType: "deal_overview",
          sourceId: dealId,
          label: "Latest recorded sale",
          value: `${latestSale.saleDate ?? "n/a"} | ${latestSale.salePrice ?? "n/a"}`,
        });
      }

      return {
        template: "deal_detail" as PromptTemplateName,
        context: {
          focus: "deal",
          deal: {
            id: overview.deal.id,
            name: overview.deal.name,
            parcelId: overview.deal.parcelId,
            address: overview.deal.address,
            city: overview.deal.city,
            market: overview.deal.market,
            assetType: overview.deal.assetType,
            askingPrice: overview.deal.askingPrice,
            score: overview.deal.score,
          },
          opportunitySummary: overview.opportunitySummary ?? null,
          operationalDecision: overview.operationalDecision ?? null,
          dataQuality: overview.dataQuality ?? overview.completeness ?? null,
          investmentThesis: overview.investmentThesis ?? null,
          investmentThesisV2: overview.investmentThesisV2 ?? null,
          ownership: overview.ownership ?? null,
          facts: overview.facts ?? null,
          mediaCount: (overview.media ?? []).length,
          documentsCount: (overview.documents ?? []).length,
          comparables: (overview.comparables ?? []).slice(0, 10).map((row) => ({
            address: row.address,
            distanceMiles: row.distanceMiles,
            salePrice: row.salePrice,
            pricePerSqft: row.pricePerSqft,
            quality: row.quality,
          })),
          insights: overview.insights ?? null,
          sales: (overview.sales ?? []).slice(0, 5),
          assessments: (overview.assessments ?? []).slice(0, 5),
        },
        citations,
      };
    }

    const where = market ? { market } : undefined;
    const [topDeals, pipeline, trueOpportunitySnapshot, watchlistSnapshot] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
        take: this.getMaxContextDeals(),
        select: {
          id: true,
          name: true,
          address: true,
          market: true,
          assetType: true,
          score: true,
          askingPrice: true,
          dataCompletenessScore: true,
        },
      }),
      this.prisma.deal.groupBy({
        by: ["status"],
        _count: { _all: true },
        where,
      }),
      this.dealsService.list({
        classification: "TRUE_OPPORTUNITY",
        market,
        limit: 5,
        offset: 0,
      }),
      this.dealsService.list({
        classification: "WATCHLIST",
        market,
        limit: 5,
        offset: 0,
      }),
    ]);
    const trueOpportunityCount = trueOpportunitySnapshot.total;
    const watchlistCount = watchlistSnapshot.total;

    citations.push({
      sourceType: "deal_list",
      sourceId: market ?? null,
      label: market ? `Deals in ${market}` : "Top deals",
      value: `${topDeals.length} rows used for chat context`,
    });

    topDeals.slice(0, 3).forEach((deal, index) => {
      citations.push({
        sourceType: "deal_list",
        sourceId: deal.id,
        label: `Top deal #${index + 1}`,
        value: `${deal.name} | score ${deal.score ?? "n/a"} | asking ${deal.askingPrice ?? "n/a"}`,
      });
    });

    citations.push({
      sourceType: "report_pipeline",
      sourceId: market ?? null,
      label: market ? `Pipeline snapshot (${market})` : "Pipeline snapshot",
      value: pipeline.map((entry) => `${entry.status}:${entry._count._all}`).join(", ") || "no-data",
    });
    citations.push({
      sourceType: "deal_list",
      sourceId: market ?? null,
      label: market ? `Opportunity snapshot (${market})` : "Opportunity snapshot",
      value: `TRUE_OPPORTUNITY ${trueOpportunityCount} | WATCHLIST ${watchlistCount}`,
    });

    return {
      template: "market" as PromptTemplateName,
      context: {
        focus: "portfolio",
        market: market ?? null,
        topDeals,
        pipeline,
        topTrueOpportunities: trueOpportunitySnapshot.items.slice(0, 5).map((deal) => ({
          id: deal.id,
          name: deal.name,
          market: deal.market,
          score: deal.score,
          classification: deal.classification,
          askingPrice: deal.askingPrice,
        })),
        classificationCounts: {
          trueOpportunity: trueOpportunityCount,
          watchlist: watchlistCount,
        },
      },
      citations,
    };
  }

  private asRecords(value: unknown) {
    if (!Array.isArray(value)) return [] as Record<string, unknown>[];
    return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  }

  private resolveTaskType(payload: ChatQueryDto, context: Record<string, unknown>): ChatTaskType {
    if (payload.taskType) return payload.taskType;

    const appState = this.asRecord(payload.appState);
    const route = (this.readString(appState, "route") ?? "").toLowerCase();
    if (payload.dealId || route.startsWith("/deals/")) return "DEAL_DEEP_DIVE";
    if (route.startsWith("/settings/integrations")) return "CHAT_COPILOT";
    if (route.startsWith("/deals") || route.startsWith("/reports")) return "PIPELINE_TRIAGE";
    if (context.focus === "deal") return "DEAL_DEEP_DIVE";
    return "CHAT_COPILOT";
  }

  private buildContextEcho(payload: ChatQueryDto, context: Record<string, unknown>): ContextEcho {
    const appState = this.asRecord(payload.appState);
    const route = this.readString(appState, "route");
    const selectedDealKey =
      this.readString(appState, "selectedDealKey") ??
      this.readString(appState, "selectedDealId") ??
      payload.dealId ??
      this.readString(this.asRecord(context.deal), "id") ??
      null;
    const pipelineVisibleRange = this.readString(appState, "pipelineVisibleRange");
    const activeFiltersCount = this.readNumber(appState, "activeFiltersCount");
    const pipelineRows = this.asRecords(appState.pipelineVisibleRows);
    const marketsInView = Array.from(
      new Set(
        pipelineRows
          .map((row) => this.readString(row, "market") ?? this.readString(row, "marketCounty"))
          .filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, 6);

    if (!marketsInView.length) {
      const market = this.readString(context, "market");
      if (market) marketsInView.push(market);
    }

    return {
      route: route ?? undefined,
      selectedDealKey,
      pipelineVisibleRange: pipelineVisibleRange ?? undefined,
      activeFiltersCount,
      marketsInView,
    };
  }

  private mapSuggestedActionsToUiActions(actions: SuggestedAction[]): CopilotUiAction[] {
    const mapped = actions.map((action) => {
      const payload = action.payload ?? {};
      if (action.type === "open_deal") {
        return {
          action: "OPEN_DEAL" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Open selected deal detail.",
        };
      }
      if (action.type === "apply_filters") {
        return {
          action: "APPLY_FILTERS" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Focus pipeline on suggested subset.",
        };
      }
      if (action.type === "recompute_comps") {
        return {
          action: "RECOMPUTE_COMPS" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Refresh comparable valuation inputs.",
        };
      }
      if (action.type === "recompute_insights") {
        return {
          action: "RECOMPUTE_INSIGHTS" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Refresh insight cards with latest data.",
        };
      }
      if (action.type === "sync_integration") {
        return {
          action: "SYNC_INTEGRATION" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Run connector sync to refresh source data.",
        };
      }
      if (action.type === "move_stage") {
        return {
          action: "MOVE_STAGE" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Advance deal to the recommended operating stage.",
        };
      }
      if (action.type === "archive_deal") {
        return {
          action: "ARCHIVE_DEAL" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Archive non-actionable noise rows.",
        };
      }
      if (action.type === "create_alert") {
        return {
          action: "CREATE_ALERT" as const,
          label: action.label,
          params: payload,
          shouldAutoExecute: false,
          why: "Create monitoring alert for milestone changes.",
        };
      }

      return {
        action: "GO_INTEGRATIONS" as const,
        label: action.label,
        params: payload,
        shouldAutoExecute: false,
        why: "Review connectors, freshness, and run health.",
      };
    });

    return mapped.slice(0, 6);
  }

  private buildQuickReplies(taskType: ChatTaskType) {
    if (taskType === "DEAL_DEEP_DIVE") {
      return ["Why is this a deal?", "Show top blockers", "Recompute comps", "Recompute insights"];
    }
    if (taskType === "PIPELINE_TRIAGE") {
      return ["Show true opportunities", "Show noise rows", "What should we call today?", "Top watchlist risks"];
    }
    if (taskType === "GOV_LAND_PROFILE") {
      return ["Show deadlines", "What is required to bid?", "Create monitoring alerts"];
    }
    return ["What should I do next?", "Show key risks", "Open integrations", "Show top opportunities"];
  }

  private buildDataRequests(
    taskType: ChatTaskType,
    payload: ChatQueryDto,
    context: Record<string, unknown>,
  ): CopilotDataRequest[] {
    const requests: CopilotDataRequest[] = [];
    const appState = this.asRecord(payload.appState);
    const route = (this.readString(appState, "route") ?? "").toLowerCase();
    const pipelineRows = this.asRecords(appState.pipelineVisibleRows);
    const recentRuns = this.asRecords(appState.recentRuns);
    const selectedDealId =
      payload.dealId ??
      this.readString(appState, "selectedDealId") ??
      this.readString(appState, "selectedDealKey");

    if (taskType === "DEAL_DEEP_DIVE" && !selectedDealId) {
      requests.push({
        key: "DEAL_DETAILS",
        why: "Need selected deal context to generate deep dive.",
      });
    }

    if (taskType === "PIPELINE_TRIAGE" && !pipelineRows.length && context.focus !== "portfolio") {
      requests.push({
        key: "PIPELINE_ROWS",
        why: "Need visible pipeline rows to run triage with real context.",
      });
    }

    if (route.startsWith("/settings/integrations") && !recentRuns.length) {
      requests.push({
        key: "RECENT_RUNS",
        why: "Need recent run telemetry to classify run type and anomalies.",
      });
    }

    if (taskType !== "GOV_LAND_PROFILE" && !this.readString(this.asRecord(context.deal), "parcelId")) {
      requests.push({
        key: "OWNER",
        why: "Owner and parcel linkage improves contactability and distress confidence.",
      });
    }

    return requests;
  }

  private buildMemoryUpdate(message: string, payload: ChatQueryDto): CopilotMemoryUpdate {
    const normalized = message.toLowerCase();
    const appState = this.asRecord(payload.appState);
    const pipelineRows = this.asRecords(appState.pipelineVisibleRows);
    const preferredMarkets = Array.from(
      new Set(
        pipelineRows
          .map((row) => this.readString(row, "market") ?? this.readString(row, "marketCounty"))
          .filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, 5);
    const userGoal =
      /(return|roi|retorno|cash)/.test(normalized)
        ? "Prioritize financially actionable opportunities."
        : /(auction|subasta|foreclosure|distress)/.test(normalized)
          ? "Prioritize distress timeline and auction readiness."
          : "Operate pipeline with clear next actions.";

    return {
      userGoal,
      buyBox: this.readString(this.asRecord(appState.activeFilters), "assetType") ?? undefined,
      riskTolerance: /(conservative|conservador)/.test(normalized)
        ? "conservative"
        : /(aggressive|agresiv)/.test(normalized)
          ? "aggressive"
          : "balanced",
      preferredMarkets,
    };
  }

  private normalizeUiCapabilities(input: string[] | undefined) {
    if (!Array.isArray(input)) return [] as string[];
    return Array.from(
      new Set(
        input
          .map((item) => String(item || "").trim().toUpperCase())
          .filter((item) => item.length > 0),
      ),
    );
  }

  private filterUiActionsByCapabilities(actions: CopilotUiAction[], uiCapabilities: string[]) {
    if (!uiCapabilities.length) return actions;
    return actions.filter((action) => {
      if (action.action === "GO_INTEGRATIONS") return true;
      return uiCapabilities.includes(action.action);
    });
  }

  private applyDealGuardrails(params: {
    taskType: ChatTaskType;
    context: Record<string, unknown>;
    answer: string;
    confidence: Confidence;
    lane?: string;
    decisionBlockers: string[];
    metrics?: Record<string, string | number | null>;
    guardrailsTriggered: string[];
  }) {
    const next = {
      answer: params.answer,
      confidence: params.confidence,
      lane: params.lane,
      decisionBlockers: [...params.decisionBlockers],
      metrics: params.metrics ?? {},
    };

    const isDealContext = params.taskType === "DEAL_DEEP_DIVE" || params.context.focus === "deal";
    if (!isDealContext) return next;

    const deal = this.asRecord(params.context.deal);
    const facts = this.asRecord(params.context.facts);
    const opportunity = this.asRecord(params.context.opportunitySummary);
    const operationalDecision = this.asRecord(params.context.operationalDecision);
    const foreclosureStatus = this.readString(opportunity, "foreclosureStatus") ?? "";
    const spread = this.readNumber(opportunity, "spreadToAskPct");
    const assetTypeBlob = `${this.readString(deal, "assetType") ?? ""} ${this.readString(deal, "propertyUseCode") ?? ""}`.toUpperCase();

    const missingCritical: string[] = [];
    if (!this.readString(deal, "parcelId") && !this.readString(deal, "address")) missingCritical.push("parcel/address");
    if (this.readNumber(deal, "askingPrice") === null && this.readNumber(facts, "askingPrice") === null) missingCritical.push("askingPrice");
    if (this.readString(deal, "assetType") === null) missingCritical.push("assetType");
    if (this.readNumber(facts, "buildingSizeSqft") === null) missingCritical.push("buildingSizeSqft");

    if (missingCritical.length) {
      if (next.confidence === "high") next.confidence = "medium";
      params.guardrailsTriggered.push("MISSING_CRITICAL_FACTS");
      const blocker = `Missing critical facts: ${missingCritical.join(", ")}`;
      if (!next.decisionBlockers.some((item) => item.toLowerCase().includes("missing critical"))) {
        next.decisionBlockers.unshift(blocker);
      }
    }

    const hasOutlierSpread = typeof spread === "number" && (spread > 150 || spread < -10);
    if (hasOutlierSpread) {
      next.confidence = "low";
      params.guardrailsTriggered.push("DATA_ANOMALY_OUTLIER");
      const outlierBlocker = `DATA_ANOMALY: spread outlier (${spread.toFixed(1)}%)`;
      if (!next.decisionBlockers.some((item) => item.toLowerCase().includes("outlier") || item.toLowerCase().includes("data_anomaly"))) {
        next.decisionBlockers.unshift(outlierBlocker);
      }
      if (!next.answer.toLowerCase().includes("outlier")) {
        next.answer = `${next.answer} Outlier detectado en spread; validar precio y supuestos de valuación.`;
      }
    }

    if (foreclosureStatus !== "confirmed_by_official_source" && /foreclosure|distress/i.test(next.answer) && /confirmad/i.test(next.answer)) {
      next.answer = next.answer.replace(/confirmad[oa]s?/gi, "no confirmado");
      params.guardrailsTriggered.push("DISTRESS_UNCONFIRMED");
    }

    const looksNoise =
      assetTypeBlob.includes("COMMON AREA") ||
      assetTypeBlob.includes("ROADWAY") ||
      assetTypeBlob.includes("RAILROAD") ||
      assetTypeBlob.includes("CENTRALLY ASSESSED");
    if (looksNoise) {
      next.lane = "NON_ACQUIRABLE_NOISE";
      params.guardrailsTriggered.push("NON_ACQUIRABLE_NOISE");
      if (!next.decisionBlockers.some((item) => item.toLowerCase().includes("non_acquirable"))) {
        next.decisionBlockers.unshift("NON_ACQUIRABLE_NOISE: asset type suggests non-actionable parcel.");
      }
    }

    if (!next.lane) {
      next.lane = this.readString(opportunity, "lane") ?? this.readString(operationalDecision, "lane") ?? undefined;
    }
    return next;
  }

  private async resolveCopilotFromAppState(payload: ChatQueryDto): Promise<DeterministicIntent | null> {
    const appState = this.asRecord(payload.appState);
    const route = (this.readString(appState, "route") ?? "").toLowerCase();
    if (!route) return null;

    if (route.startsWith("/settings/integrations")) {
      const integrations = this.asRecords(appState.integrationsSnapshot);
      const recentRuns = this.asRecords(appState.recentRuns);
      const mdpa = integrations.find((row) => (this.readString(row, "source") ?? "").toLowerCase() === "mdpa");
      const mdpaNeedsConfirm = (this.readString(mdpa ?? {}, "message") ?? "").toLowerCase().includes("confirm");

      const ownerGapRun = recentRuns.find((row) => {
        const metrics = this.asRecord(row.metrics);
        const linked = this.readNumber(metrics, "linkedOwners");
        const updated = this.readNumber(metrics, "updatedDeals");
        return typeof linked === "number" && typeof updated === "number" && linked < updated;
      });
      const ownerGapMetrics = ownerGapRun ? this.asRecord(ownerGapRun.metrics) : {};
      const linked = this.readNumber(ownerGapMetrics, "linkedOwners");
      const updated = this.readNumber(ownerGapMetrics, "updatedDeals");

      const blockers: string[] = [];
      if (mdpaNeedsConfirm) blockers.push("MDPA paid-data confirmation pending.");
      if (typeof linked === "number" && typeof updated === "number" && linked < updated) {
        blockers.push(`Owner linkage gap detected (${linked}/${updated}).`);
      }

      const answer = [
        "Contexto Integrations cargado.",
        mdpaNeedsConfirm
          ? "MDPA requiere confirmación antes de sync de datos pagos."
          : "MDPA está operativo sin bloqueo de confirmación.",
        blockers.length
          ? `Bloqueadores actuales: ${blockers.join(" ")}`
          : "No hay bloqueadores críticos en los runs visibles.",
        "Siguiente paso: priorizar sync con fuentes bloqueadas y corregir gaps de owner linking.",
      ].join(" ");

      const suggestedActions: SuggestedAction[] = [];
      if (mdpaNeedsConfirm) {
        suggestedActions.push({
          type: "sync_integration",
          label: "Sync MDPA (confirm required)",
          payload: { source: "mdpa", confirmPaidDataUse: true },
        });
      }
      suggestedActions.push({ type: "go_integrations", label: "Open integrations controls" });

      if (ownerGapRun) {
        suggestedActions.push({
          type: "sync_integration",
          label: `Resync ${this.readString(ownerGapRun, "source") ?? "connector"}`,
          payload: { source: this.readString(ownerGapRun, "source") ?? "" },
        });
      }

      return {
        intent: "general",
        answer,
        thesis: "Integrations health should drive next operational actions.",
        nextAction: mdpaNeedsConfirm ? "Confirm MDPA and run sync." : "Review owner-linking anomalies in recent runs.",
        lane: "RESEARCH_REQUIRED",
        metrics: {
          integrationsVisible: integrations.length,
          runsVisible: recentRuns.length,
          ownerLinked: linked,
          ownerUpdated: updated,
        },
        decisionBlockers: blockers,
        confidence: blockers.length ? "medium" : "high",
        citations: [
          {
            sourceType: "integration_status",
            sourceId: "integrations",
            label: "Integration snapshot",
            value: `${integrations.length} sources in app state`,
          },
          ...(ownerGapRun
            ? [
                {
                  sourceType: "integration_status" as const,
                  sourceId: this.readString(ownerGapRun, "id"),
                  label: "Recent run owner linkage gap",
                  value: `${this.readString(ownerGapRun, "source") ?? "n/a"} | linked ${linked ?? "n/a"} / updated ${updated ?? "n/a"}`,
                },
              ]
            : []),
        ],
        suggestedActions,
        appliedFilters: {},
      };
    }

    if (route.startsWith("/deals")) {
      const rows = this.asRecords(appState.pipelineVisibleRows);
      if (!rows.length) return null;

      const nonAcquirable = rows.filter((row) => {
        const blob = `${this.readString(row, "assetType") ?? ""} ${this.readString(row, "useCategory") ?? ""}`.toUpperCase();
        return (
          blob.includes("COMMON AREA") ||
          blob.includes("ROADWAY") ||
          blob.includes("RAILROAD") ||
          blob.includes("CENTRALLY ASSESSED")
        );
      }).length;
      const govLand = rows.filter((row) => {
        const blob = `${this.readString(row, "assetType") ?? ""} ${this.readString(row, "useCategory") ?? ""}`.toUpperCase();
        return blob.includes("GOVERNMENTAL") || blob.includes("COUNTY");
      }).length;

      const answer = [
        `Veo ${rows.length} deals visibles en ${route}.`,
        nonAcquirable > 0
          ? `${nonAcquirable} parecen NON_ACQUIRABLE_NOISE (common area/roadway/railroad).`
          : "No hay ruido operativo claro en las filas visibles.",
        govLand > 0
          ? `${govLand} entran en carril GOV_LAND_P3 y requieren evidencia oficial de disposición.`
          : "No se detectaron filas GOV_LAND en esta muestra.",
        "Siguiente paso: filtrar por TRUE_OPPORTUNITY y mover ruido a archive.",
      ].join(" ");

      return {
        intent: "top_opportunities",
        answer,
        thesis: "Triage del pipeline debe separar ruido, gov land y oportunidad real.",
        nextAction: "Apply pipeline triage filters.",
        lane: "OFF_MARKET_STANDARD",
        metrics: {
          visibleRows: rows.length,
          nonAcquirableRows: nonAcquirable,
          govLandRows: govLand,
        },
        decisionBlockers: nonAcquirable > 0 ? ["Noise rows dilute actionable opportunities."] : [],
        confidence: "high",
        citations: [
          {
            sourceType: "deal_list",
            sourceId: null,
            label: "Visible pipeline rows",
            value: `${rows.length} rows from app state`,
          },
        ],
        suggestedActions: [
          {
            type: "apply_filters",
            label: "Show true opportunities",
            payload: { classification: "TRUE_OPPORTUNITY", isNoise: false },
          },
          {
            type: "apply_filters",
            label: "Show noise only",
            payload: { isNoise: true },
          },
        ],
        appliedFilters: {},
      };
    }

    return null;
  }

  private resolveTemplate(message: string, hint: PromptTemplateName, context: Record<string, unknown>) {
    const text = message.toLowerCase();
    if (text.includes("integration") || text.includes("sync") || text.includes("connector")) {
      return "integrations" as PromptTemplateName;
    }
    if (text.includes("report") || text.includes("pipeline")) {
      return "reports" as PromptTemplateName;
    }
    if (context.focus === "deal") {
      return "deal_detail" as PromptTemplateName;
    }
    return hint;
  }

  private templatePrompt(template: PromptTemplateName) {
    if (template === "deal_detail") {
      return "Mode DEAL_DEEP_DIVE. Use only context data. Return strict JSON keys: answer, confidence, thesis, nextAction, lane, metrics, decisionBlockers. Enforce guardrails: no distress confirmation without official evidence; confidence cannot be high with missing critical facts or outliers. If data missing, explicitly say 'dato no disponible en fuentes actuales'.";
    }
    if (template === "integrations") {
      return "Mode CHAT_COPILOT with integrations focus. Use only context data. Return strict JSON keys: answer, confidence, thesis, nextAction, lane, metrics, decisionBlockers. Prioritize run impact, anomalies, and next operational action.";
    }
    if (template === "reports") {
      return "Mode PIPELINE_TRIAGE for report/pipeline context. Use only context data. Return strict JSON keys: answer, confidence, thesis, nextAction, lane, metrics, decisionBlockers. Separate non-acquirable noise, gov land, and actionable opportunities.";
    }
    return "Mode CHAT_COPILOT. Use only context data. Return strict JSON keys: answer, confidence, thesis, nextAction, lane, metrics, decisionBlockers. If data is missing, state 'dato no disponible en fuentes actuales'.";
  }

  private parseOpenAIAnswer(rawContent: string) {
    let content = rawContent.trim();
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    }

    try {
      const parsed = JSON.parse(content) as {
        answer?: string;
        confidence?: Confidence;
        thesis?: string;
        nextAction?: string;
        lane?: string;
        metrics?: Record<string, string | number | null>;
        decisionBlockers?: string[];
      };
      const answer = parsed.answer?.trim();
      const confidence: Confidence =
        parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
          ? parsed.confidence
          : "medium";
      if (answer) {
        return {
          answer,
          confidence,
          thesis: parsed.thesis?.trim(),
          nextAction: parsed.nextAction?.trim(),
          lane: parsed.lane?.trim(),
          metrics: parsed.metrics ?? undefined,
          decisionBlockers: Array.isArray(parsed.decisionBlockers)
            ? parsed.decisionBlockers.map((item) => String(item))
            : undefined,
        };
      }
    } catch (_error) {
      // fall back to plain content
    }

    return {
      answer: rawContent.trim(),
      confidence: "medium" as Confidence,
      thesis: undefined,
      nextAction: undefined,
      lane: undefined,
      metrics: undefined,
      decisionBlockers: undefined,
    };
  }

  private normalizeNumericToken(token: string) {
    const cleaned = token.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return parsed.toFixed(2);
  }

  private stripDayCounts(text: string) {
    return text
      .replace(/\b\d+\s*(?:day|days|d[ií]a|d[ií]as)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s([,.;:])/g, "$1")
      .trim();
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  private readNumber(record: Record<string, unknown>, key: string) {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private readString(record: Record<string, unknown>, key: string) {
    const value = record[key];
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text.length ? text : null;
  }

  private readStringArray(record: Record<string, unknown>, key: string) {
    const value = record[key];
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  private extractNumericTokens(text: string) {
    const matches = text.match(NUMERIC_TOKEN_PATTERN) ?? [];
    return matches
      .map((token) => token.trim())
      .filter((token) => {
        const pureDigits = token.replace(/[^\d]/g, "");
        return token.includes("%") || token.includes("$") || pureDigits.length >= 3;
      })
      .map((token) => this.normalizeNumericToken(token))
      .filter((token): token is string => Boolean(token));
  }

  private hasUncitedNumericClaims(answer: string, citations: Citation[]) {
    const answerTokens = this.extractNumericTokens(answer);
    if (!answerTokens.length) return false;

    const citationTokens = new Set<string>();
    citations.forEach((citation) => {
      const text = `${citation.label} ${citation.value ?? ""}`;
      this.extractNumericTokens(text).forEach((token) => citationTokens.add(token));
    });

    return answerTokens.some((token) => !citationTokens.has(token));
  }

  private applyCitationGuardrails(answer: string, citations: Citation[]) {
    if (!this.hasUncitedNumericClaims(answer, citations)) {
      return { answer, triggered: false };
    }
    return {
      answer:
        "No puedo confirmar algunas cifras con las fuentes actuales. Te recomiendo abrir el deal o el reporte para validar los valores antes de decidir.",
      triggered: true,
    };
  }

  private heuristicAnswer(message: string, context: Record<string, unknown>) {
    const text = message.toLowerCase();
    if (context.focus === "deal") {
      const quality = (context.dataQuality as Record<string, unknown>) ?? {};
      const opp = (context.opportunitySummary as Record<string, unknown>) ?? {};
      return `Tesis: ${opp.classification ?? "PIPELINE_LISTING"}. Spread ${opp.spreadToAskPct ?? "n/d"} · Comps ${opp.comparableCount ?? "n/d"} · Completeness ${quality.completenessScore ?? "n/d"}. Acción: abrir deal y recomputar comps/insights.`;
    }

    if (text.includes("integration") || text.includes("sync")) {
      return "Para validar salud de datos, ve a Integrations. Desde ahi podras ver freshness, errores y ejecutar sync por fuente con confirmacion para MDPA.";
    }

    return "Puedo ayudarte a priorizar oportunidades por mercado, score y calidad de datos. Indica mercado, tipo de activo o un deal especifico para darte recomendacion accionable.";
  }

  private resolveDealThesisIntent(message: string, context: Record<string, unknown>): DeterministicIntent | null {
    if (context.focus !== "deal") return null;

    const normalized = message.toLowerCase();
    const asksThesis =
      /(why|por que|porque|por qué|donde|dónde|where|explain|explica)/.test(normalized) &&
      /(deal|oportunidad|opportunity|listing|listado)/.test(normalized);
    const asksDealVsListing =
      /(is|es)\s+(this\s+)?(a\s+)?(deal|opportunity|oportunidad|listing|listado)/.test(normalized) ||
      /deal\s+or\s+listing|deal\s+vs\s+listing|oportunidad\s+o\s+listado/.test(normalized);

    if (!asksThesis && !asksDealVsListing) return null;

    const deal = this.asRecord(context.deal);
    const opportunity = this.asRecord(context.opportunitySummary);
    const dataQuality = this.asRecord(context.dataQuality);

    const dealName = this.readString(deal, "name") ?? "This property";
    const score = this.readNumber(opportunity, "score");
    const classification = this.readString(opportunity, "classification") ?? "PIPELINE_LISTING";
    const lane = this.readString(opportunity, "lane") ?? this.readString(this.asRecord(context.operationalDecision), "lane") ?? "RESEARCH_REQUIRED";
    const recommendedAction =
      this.readString(opportunity, "recommendedAction") ??
      this.readString(this.asRecord(context.operationalDecision), "recommendedAction") ??
      "MONITOR";
    const spreadToAskPct = this.readNumber(opportunity, "spreadToAskPct");
    const comparableCount = this.readNumber(opportunity, "comparableCount");
    const completeness = this.readNumber(dataQuality, "completenessScore");
    let confidence = (this.readString(opportunity, "confidence") as Confidence | null) ?? "medium";
    const topDrivers = this.readStringArray(opportunity, "topDrivers").slice(0, 2);
    const riskFlags = this.readStringArray(opportunity, "riskFlags").slice(0, 2);
    const blockers = this.readStringArray(opportunity, "blockers").slice(0, 4);
    const foreclosureStatus = this.readString(opportunity, "foreclosureStatus") ?? "not_confirmed_by_official_source";
    const nextBestAction = this.readString(opportunity, "nextBestAction");
    const gates = this.asRecord(opportunity.gates);
    const failedGates = Object.values(gates)
      .map((gate) => this.asRecord(gate))
      .filter((gate) => gate.passed === false)
      .map((gate) => this.readString(gate, "label") ?? "Unknown")
      .slice(0, 4);
    const passedGates = Object.values(gates)
      .map((gate) => this.asRecord(gate))
      .filter((gate) => gate.passed === true).length;

    const hasPricingEdge = typeof spreadToAskPct === "number" && spreadToAskPct >= 10;
    const thesis =
      classification === "TRUE_OPPORTUNITY" && hasPricingEdge
        ? "Sí hay oportunidad real según la regla estricta."
        : classification === "DISTRESS_CANDIDATE"
          ? "Es un candidato distress confirmado por fuente oficial."
          : classification === "WATCHLIST"
            ? "Es watchlist: hay señal parcial, pero no cumple regla estricta."
            : "Hoy es pipeline listing, no deal claro.";

    const summaryLine = [
      `Spread ${typeof spreadToAskPct === "number" ? `${spreadToAskPct.toFixed(1)}%` : "n/d"}`,
      `Comps ${typeof comparableCount === "number" ? comparableCount : "n/d"}`,
      `Completeness ${typeof completeness === "number" ? `${completeness.toFixed(1)}%` : "n/d"}`,
    ].join(" · ");
    const classificationLine = `Clasificación: ${classification} · Opportunity score: ${score ?? "n/d"} · Confidence: ${confidence}.`;
    const foreclosureLine =
      foreclosureStatus === "confirmed_by_official_source"
        ? "Foreclosure/distress: confirmado por fuente oficial."
        : "Foreclosure/distress: no confirmado por fuente oficial actual.";
    const gatesLine = failedGates.length
      ? `Gates fallidos: ${failedGates.join(", ")} (passed ${passedGates}/4).`
      : `Gates: 4/4 en pass.`;
    const driversLine = topDrivers.length ? `Drivers: ${topDrivers.join(" | ")}` : "";
    const risksLine = riskFlags.length ? `Riesgos: ${riskFlags.join(" | ")}` : "";
    const actionLine = nextBestAction ? `Acción recomendada: ${recommendedAction} · ${nextBestAction}` : `Acción recomendada: ${recommendedAction}`;

    const hasOutlierSpread = typeof spreadToAskPct === "number" && (spreadToAskPct > 150 || spreadToAskPct < -10);
    const hasCriticalMissing = [...riskFlags, ...blockers].some((item) => item.toLowerCase().includes("missing critical"));
    if (hasOutlierSpread) confidence = "low";
    else if (hasCriticalMissing && confidence === "high") confidence = "medium";

    const answer = [`${dealName}: ${thesis}`, summaryLine, classificationLine, foreclosureLine, gatesLine, driversLine, risksLine, actionLine]
      .filter(Boolean)
      .join(" ");

    const citations: Citation[] = [
      {
        sourceType: "deal_overview",
        sourceId: this.readString(deal, "id"),
        label: "Opportunity summary",
        value: `classification ${classification} | lane ${lane} | action ${recommendedAction} | score ${score ?? "n/a"} | spread ${spreadToAskPct ?? "n/a"} | comps ${comparableCount ?? "n/a"}`,
      },
      {
        sourceType: "deal_overview",
        sourceId: this.readString(deal, "id"),
        label: "Data quality",
        value: `completeness ${completeness ?? "n/a"}%`,
      },
      {
        sourceType: "deal_overview",
        sourceId: this.readString(deal, "id"),
        label: "Foreclosure status",
        value: foreclosureStatus,
      },
      {
        sourceType: "deal_overview",
        sourceId: this.readString(deal, "id"),
        label: "Gate summary",
        value: failedGates.length ? `failed ${failedGates.join(", ")}` : "all passed",
      },
    ];

    const dealId = this.readString(deal, "id");
    const suggestedActions: SuggestedAction[] = [];
    if (dealId) {
      suggestedActions.push({ type: "open_deal", label: "Open this deal", payload: { dealId } });
      suggestedActions.push({ type: "recompute_comps", label: "Recompute comps", payload: { dealId } });
      suggestedActions.push({ type: "recompute_insights", label: "Recompute insights", payload: { dealId } });
    }
    suggestedActions.push({
      type: "apply_filters",
      label: "Show true opportunities",
      payload: { classification: "TRUE_OPPORTUNITY" },
    });

    return {
      intent: asksDealVsListing ? "deal_vs_listing" : "why_deal",
      answer,
      thesis,
      nextAction: `${recommendedAction}${nextBestAction ? ` · ${nextBestAction}` : ""}`,
      lane,
      metrics: {
        spreadToAskPct,
        comparableCount,
        completenessScore: completeness,
        opportunityScore: score,
      },
      decisionBlockers: blockers.length ? blockers : failedGates,
      confidence,
      citations,
      suggestedActions,
      appliedFilters: {},
    };
  }

  private async resolveDealInvestmentIntent(
    message: string,
    context: Record<string, unknown>,
  ): Promise<DeterministicIntent | null> {
    if (context.focus !== "deal") return null;

    const normalized = message.toLowerCase();
    const asksReturn = /(retorno|roi|return|cash[- ]?on[- ]?cash|projection|proyecci[oó]n|inversi[oó]n)/.test(normalized);
    const asksComps = /(comp|comparables?|comparables? tiene|comps?)/.test(normalized);
    const asksStrengths = /(good|bueno|fortaleza|ventaja|why|por que|porque|drivers?)/.test(normalized);
    if (!asksReturn && !asksComps && !asksStrengths) return null;

    const deal = this.asRecord(context.deal);
    const opportunity = this.asRecord(context.opportunitySummary);
    const comparables = Array.isArray(context.comparables) ? context.comparables.map((item) => this.asRecord(item)) : [];

    const dealId = this.readString(deal, "id");
    const dealName = this.readString(deal, "name") ?? "This deal";
    const classification = this.readString(opportunity, "classification") ?? "PIPELINE_LISTING";
    const lane = this.readString(opportunity, "lane") ?? this.readString(this.asRecord(context.operationalDecision), "lane") ?? "RESEARCH_REQUIRED";
    const recommendedAction =
      this.readString(opportunity, "recommendedAction") ??
      this.readString(this.asRecord(context.operationalDecision), "recommendedAction") ??
      "MONITOR";
    const spread = this.readNumber(opportunity, "spreadToAskPct");
    const comparableCount = this.readNumber(opportunity, "comparableCount");
    const completeness = this.readNumber(this.asRecord(context.dataQuality), "completenessScore");
    const topDrivers = this.readStringArray(opportunity, "topDrivers").slice(0, 3);
    const riskFlags = this.readStringArray(opportunity, "riskFlags").slice(0, 2);
    const nextBestAction = this.readString(opportunity, "nextBestAction");
    const hasMissingCritical =
      this.readNumber(this.asRecord(context.facts), "buildingSizeSqft") === null ||
      this.readNumber(this.asRecord(context.facts), "askingPrice") === null ||
      this.readNumber(this.asRecord(context.facts), "yearBuilt") === null;
    const hasOutlierSpread = typeof spread === "number" && (spread > 150 || spread < -10);

    const comparablesWithAddress = comparables
      .map((row) => ({
        address: this.readString(row, "address") ?? "n/a",
        distance: this.readNumber(row, "distanceMiles"),
        pricePerSqft: this.readNumber(row, "pricePerSqft"),
      }))
      .slice(0, 3);

    const projection = dealId
      ? await this.dealsService
          .buildProjection(dealId, { scenario: "base" })
          .catch(() => null)
      : null;
    const projectionSummary = projection
      ? `Base return: NOI ${projection.metrics.annualNOI.toFixed(0)}, Exit ${projection.metrics.estimatedExitValue.toFixed(0)}, Cash-on-cash ${projection.metrics.cashOnCashPct.toFixed(2)}%.`
      : "Return projection: dato no disponible en fuentes actuales.";
    const comparableSummary = comparablesWithAddress.length
      ? `Top comparables: ${comparablesWithAddress
          .map(
            (row) =>
              `${row.address} (${row.distance !== null ? `${row.distance.toFixed(2)}mi` : "n/d"}${
                row.pricePerSqft !== null ? `, ${row.pricePerSqft.toFixed(0)} ppsf` : ""
              })`,
          )
          .join("; ")}.`
      : "Comparables: dato no disponible en fuentes actuales.";

    const thesis =
      classification === "TRUE_OPPORTUNITY"
        ? "Sí, hoy califica como oportunidad estricta."
        : classification === "WATCHLIST"
          ? "Es watchlist: tiene señal parcial, no oportunidad estricta."
          : "Es pipeline listing: hoy no tiene edge validado.";
    const answer = [
      `${dealName}: ${thesis}`,
      `Drivers: ${topDrivers.join(" | ") || "dato no disponible en fuentes actuales"}.`,
      `Spread ${typeof spread === "number" ? `${spread.toFixed(1)}%` : "n/d"} · Comps ${
        typeof comparableCount === "number" ? comparableCount : "n/d"
      } · Completeness ${typeof completeness === "number" ? `${completeness.toFixed(1)}%` : "n/d"}.`,
      asksReturn ? projectionSummary : null,
      asksComps ? comparableSummary : null,
      riskFlags.length ? `Riesgos: ${riskFlags.join(" | ")}.` : null,
      nextBestAction ? `Siguiente paso: ${nextBestAction}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const citations: Citation[] = [
      {
        sourceType: "deal_overview",
        sourceId: dealId,
        label: "Opportunity summary",
        value: `classification ${classification} | lane ${lane} | action ${recommendedAction} | spread ${spread ?? "n/a"} | comps ${comparableCount ?? "n/a"}`,
      },
      {
        sourceType: "deal_overview",
        sourceId: dealId,
        label: "Drivers & risks",
        value: `drivers ${topDrivers.length} | risks ${riskFlags.length}`,
      },
      {
        sourceType: "deal_overview",
        sourceId: dealId,
        label: "Comparables snapshot",
        value: `${comparablesWithAddress.length} rows`,
      },
    ];
    if (projection) {
      citations.push({
        sourceType: "deal_overview",
        sourceId: dealId,
        label: "Projection base scenario",
        value: `cashOnCash ${projection.metrics.cashOnCashPct.toFixed(2)}% | exit ${projection.metrics.estimatedExitValue.toFixed(
          0,
        )}`,
      });
    }

    const suggestedActions: SuggestedAction[] = [];
    if (dealId) {
      suggestedActions.push({ type: "open_deal", label: "Open this deal", payload: { dealId } });
      suggestedActions.push({ type: "recompute_comps", label: "Recompute comps", payload: { dealId } });
      suggestedActions.push({ type: "recompute_insights", label: "Recompute insights", payload: { dealId } });
    }

    return {
      intent: "why_deal",
      answer,
      thesis,
      nextAction: `${recommendedAction}${nextBestAction ? ` · ${nextBestAction}` : ""}`,
      lane,
      metrics: {
        spreadToAskPct: spread,
        comparableCount,
        completenessScore: completeness,
        cashOnCashPct: projection?.metrics.cashOnCashPct ?? null,
      },
      decisionBlockers: riskFlags,
      confidence: hasOutlierSpread ? "low" : hasMissingCritical ? "medium" : "high",
      citations,
      suggestedActions,
      appliedFilters: {},
    };
  }

  private async callOpenAI(message: string, context: Record<string, unknown>, template: PromptTemplateName) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY", "").trim();
    if (!apiKey) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getTimeoutMs());

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.getModel(),
          temperature: 0.2,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "copilot_response",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  answer: { type: "string" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  thesis: { type: "string" },
                  nextAction: { type: "string" },
                  lane: { type: "string" },
                  metrics: {
                    type: "object",
                    additionalProperties: {
                      anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
                    },
                  },
                  decisionBlockers: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["answer", "confidence"],
              },
            },
          },
          messages: [
            {
              role: "system",
              content: this.templatePrompt(template),
            },
            {
              role: "user",
              content: `Question: ${message}\n\nContext JSON:\n${JSON.stringify(context)}`,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };
      const rawAnswer = data.choices?.[0]?.message?.content?.trim();
      if (!rawAnswer) return null;

      const parsed = this.parseOpenAIAnswer(rawAnswer);
      return {
        answer: parsed.answer,
        confidence: parsed.confidence,
        thesis: parsed.thesis,
        nextAction: parsed.nextAction,
        lane: parsed.lane,
        metrics: parsed.metrics,
        decisionBlockers: parsed.decisionBlockers,
        tokenUsage: data.usage?.total_tokens,
      };
    } catch (_error) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildSuggestedActions(
    message: string,
    dealId?: string,
    filters?: Record<string, unknown>,
    taskType?: ChatTaskType,
    appState?: Record<string, unknown>,
  ): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    if (dealId) {
      actions.push({ type: "open_deal", label: "Open this deal", payload: { dealId } });
      actions.push({ type: "recompute_comps", label: "Recompute comps", payload: { dealId } });
      actions.push({ type: "recompute_insights", label: "Recompute insights", payload: { dealId } });
      actions.push({ type: "move_stage", label: "Move to DD", payload: { dealId, status: "DD" } });
    }

    const text = message.toLowerCase();
    if (text.includes("integration") || text.includes("sync") || text.includes("source")) {
      actions.push({ type: "go_integrations", label: "Go to integrations" });
    }
    if (text.includes("top") && (text.includes("opportun") || text.includes("oportun"))) {
      actions.push({
        type: "apply_filters",
        label: "Show true opportunities",
        payload: { classification: "TRUE_OPPORTUNITY", ...(filters?.market ? { market: filters.market } : {}) },
      });
    }
    if (text.includes("deal") || text.includes("market") || text.includes("opportunity") || Object.keys(filters ?? {}).length) {
      actions.push({
        type: "apply_filters",
        label: "Apply suggested filters",
        payload: filters && Object.keys(filters).length ? filters : undefined,
      });
    }

    if (text.includes("archive") || text.includes("noise")) {
      actions.push({
        type: "apply_filters",
        label: "Show noise only",
        payload: { isNoise: true },
      });
      if (dealId) {
        actions.push({
          type: "archive_deal",
          label: "Archive this deal",
          payload: { dealId },
        });
      }
    }

    if (text.includes("alert")) {
      actions.push({
        type: "create_alert",
        label: "Create alert",
        payload: { dealId: dealId ?? undefined, scope: taskType ?? "CHAT_COPILOT" },
      });
    }

    const route = this.readString(this.asRecord(appState), "route") ?? "";
    if ((taskType === "CHAT_COPILOT" || route.includes("integrations")) && text.includes("sync")) {
      const integrations = this.asRecords(this.asRecord(appState).integrationsSnapshot);
      const firstSource = this.readString(integrations[0] ?? {}, "source");
      actions.push({
        type: "sync_integration",
        label: firstSource ? `Sync ${firstSource}` : "Sync integration",
        payload: firstSource ? { source: firstSource } : {},
      });
    }

    if (!actions.length) {
      actions.push({ type: "apply_filters", label: "Show top opportunities" });
    }

    return actions;
  }

  private resolveMessage(payload: { message?: string; query?: string; question?: string }) {
    return (payload.message ?? payload.query ?? payload.question ?? "").trim();
  }

  private async inferFiltersFromMessage(messageLower: string) {
    const filters: Record<string, unknown> = {};

    const markets = await this.prisma.deal.findMany({
      distinct: ["market"],
      select: { market: true },
      where: { market: { not: null } },
      take: 20,
    });

    for (const row of markets) {
      const market = row.market?.toLowerCase();
      if (market && messageLower.includes(market)) {
        filters.market = row.market;
        break;
      }
    }

    if (messageLower.includes("dd") || messageLower.includes("due diligence")) {
      filters.status = "DD";
    } else if (messageLower.includes("negotiation")) {
      filters.status = "NEGOTIATION";
    }

    if (messageLower.includes("industrial")) filters.assetType = "Industrial";
    else if (messageLower.includes("office")) filters.assetType = "Office";
    else if (messageLower.includes("retail")) filters.assetType = "Retail";
    else if (messageLower.includes("land")) filters.assetType = "Land";
    else if (messageLower.includes("residential")) filters.assetType = "Residential";

    if (messageLower.includes("true opportunity") || messageLower.includes("oportunidad real")) {
      filters.classification = "TRUE_OPPORTUNITY";
    } else if (messageLower.includes("watchlist")) {
      filters.classification = "WATCHLIST";
    } else if (messageLower.includes("pipeline listing")) {
      filters.classification = "PIPELINE_LISTING";
    }

    const scoreMatch = messageLower.match(/(?:score|scoring|puntaje)\s*(?:above|over|>=|>|de)?\s*(\d{1,3})/);
    if (scoreMatch?.[1]) {
      const score = Number(scoreMatch[1]);
      if (Number.isFinite(score)) {
        filters.minScore = Math.max(0, Math.min(100, score));
      }
    }

    return filters;
  }

  private async inferMarketFromMessage(messageLower: string) {
    const markets = await this.prisma.deal.findMany({
      distinct: ["market"],
      select: { market: true },
      where: { market: { not: null } },
      take: 50,
    });

    for (const row of markets) {
      const market = row.market?.trim();
      if (!market) continue;
      if (messageLower.includes(market.toLowerCase())) {
        return market;
      }
    }

    return undefined;
  }

  private async resolveNewDealsIntent(message: string, market?: string) {
    const normalized = message.toLowerCase();
    const asksNewDeals = /(new|latest|recent|fresh|nuev|recientes|ultim|hoy|today)/.test(normalized);
    const asksForInventory =
      /(deal|deals|oportunidad(?:es)?|opportunit(?:y|ies)?|listing(?:s)?|propiedad(?:es)?|property|properties)/.test(
        normalized,
      );

    if (!asksNewDeals || !asksForInventory) return null;

    const resolvedMarket = market ?? (await this.inferMarketFromMessage(normalized));

    const where = {
      status: "NEW" as const,
      ...(resolvedMarket ? { market: resolvedMarket } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        take: 5,
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          market: true,
          score: true,
          updatedAt: true,
        },
      }),
      this.prisma.deal.count({ where }),
    ]);

    const marketLabel = resolvedMarket ? ` en ${resolvedMarket}` : "";
    const [trueOppCount, watchlistCount] = await Promise.all([
      this.dealsService
        .list({ classification: "TRUE_OPPORTUNITY", ...(resolvedMarket ? { market: resolvedMarket } : {}), limit: 1, offset: 0 })
        .then((result) => result.total),
      this.dealsService
        .list({ classification: "WATCHLIST", ...(resolvedMarket ? { market: resolvedMarket } : {}), limit: 1, offset: 0 })
        .then((result) => result.total),
    ]);
    if (!rows.length) {
      const nextActionLabel = "Open NEW deals";
      return {
        intent: "new_deals" as const,
        answer: `No encontré deals nuevos${marketLabel} en este momento.`,
        thesis: `No hay inventario NEW${marketLabel} en este momento.`,
        nextAction: nextActionLabel,
        lane: "RESEARCH_REQUIRED",
        metrics: {
          newDeals: 0,
          trueOpportunityCount: trueOppCount,
          watchlistCount,
        },
        decisionBlockers: ["No NEW inventory currently available."],
        confidence: "medium" as Confidence,
        citations: [
          {
            sourceType: "deal_list" as const,
            sourceId: resolvedMarket ?? null,
            label: "NEW deals snapshot",
            value: `0 deals with status NEW${marketLabel}`,
          },
          {
            sourceType: "deal_list" as const,
            sourceId: resolvedMarket ?? null,
            label: "Opportunity classification snapshot",
            value: `TRUE_OPPORTUNITY ${trueOppCount} | WATCHLIST ${watchlistCount}`,
          },
        ],
        suggestedActions: [
          {
            type: "apply_filters" as const,
            label: nextActionLabel,
            payload: { status: "NEW", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
          },
        ],
        appliedFilters: { status: "NEW", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
      };
    }

    const bullets = rows
      .map((row, index) => {
        const location = [row.address, row.city].filter(Boolean).join(", ") || "address not available";
        const score = typeof row.score === "number" ? row.score : "n/a";
        return `${index + 1}) ${row.name} - ${location} - score ${score}`;
      })
      .join("; ");

    const nextActionLabel = "Open NEW deals";
    return {
      intent: "new_deals" as const,
      answer: `Encontré ${total} deals NEW${marketLabel}. NEW indica etapa de pipeline (no oportunidad confirmada). Clasificación actual: TRUE_OPPORTUNITY ${trueOppCount} | WATCHLIST ${watchlistCount}. Top recientes: ${bullets}`,
      thesis: `Hay inventario NEW${marketLabel}, pero solo TRUE_OPPORTUNITY representa oportunidad estricta.`,
      nextAction: nextActionLabel,
      lane: "OFF_MARKET_STANDARD",
      metrics: {
        newDeals: total,
        trueOpportunityCount: trueOppCount,
        watchlistCount,
      },
      decisionBlockers: [],
      confidence: "high" as Confidence,
      citations: [
        {
          sourceType: "deal_list" as const,
          sourceId: resolvedMarket ?? null,
          label: "NEW deals snapshot",
          value: `${total} deals with status NEW${marketLabel}`,
        },
        {
          sourceType: "deal_list" as const,
          sourceId: resolvedMarket ?? null,
          label: "Opportunity classification snapshot",
          value: `TRUE_OPPORTUNITY ${trueOppCount} | WATCHLIST ${watchlistCount}`,
        },
        ...rows.map(
          (row, index) =>
            ({
              sourceType: "deal_list" as const,
              sourceId: row.id,
              label: `Recent NEW deal #${index + 1}`,
              value: `${row.name} | ${row.address ?? "n/a"} | score ${row.score ?? "n/a"}`,
            }) satisfies Citation,
        ),
      ],
      suggestedActions: [
        {
          type: "apply_filters" as const,
          label: nextActionLabel,
          payload: { status: "NEW", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
        },
        {
          type: "open_deal" as const,
          label: "Open latest NEW deal",
          payload: { dealId: rows[0].id },
        },
      ],
      appliedFilters: { status: "NEW", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
    };
  }

  private async resolveMarketRiskIntent(message: string, market?: string): Promise<DeterministicIntent | null> {
    const normalized = message.toLowerCase();
    const asksSummary = /(market|mercado|miami-dade|palm beach|broward)/.test(normalized);
    const asksAnalysis = /(risk|riesgo|summary|resumen|analysis|analisis|análisis|action|accion|acción)/.test(normalized);
    if (!asksSummary || !asksAnalysis) return null;

    const marketRows = await this.prisma.deal.findMany({
      distinct: ["market"],
      select: { market: true },
      where: { market: { not: null } },
      take: 10,
    });
    const availableMarkets = marketRows.map((row) => row.market?.trim()).filter((value): value is string => Boolean(value));
    const selectedMarkets = availableMarkets.filter((name) => normalized.includes(name.toLowerCase()));
    if (market && !selectedMarkets.includes(market)) selectedMarkets.push(market);
    if (!selectedMarkets.length) selectedMarkets.push(...availableMarkets.slice(0, 2));

    const snapshots = await Promise.all(
      selectedMarkets.slice(0, 3).map(async (marketName) => {
        const [total, priced, avgCompleteness, trueOppCount, watchlistCount] = await Promise.all([
          this.prisma.deal.count({ where: { market: marketName } }),
          this.prisma.deal.count({ where: { market: marketName, askingPrice: { gt: 0 } } }),
          this.prisma.deal.aggregate({
            where: { market: marketName },
            _avg: { dataCompletenessScore: true },
          }),
          this.dealsService
            .list({ classification: "TRUE_OPPORTUNITY", market: marketName, limit: 1, offset: 0 })
            .then((result) => result.total),
          this.dealsService
            .list({ classification: "WATCHLIST", market: marketName, limit: 1, offset: 0 })
            .then((result) => result.total),
        ]);

        return {
          market: marketName,
          total,
          priced,
          avgCompleteness: avgCompleteness._avg.dataCompletenessScore ?? 0,
          trueOppCount,
          watchlistCount,
        };
      }),
    );

    if (!snapshots.length) return null;

    const lines = snapshots.map((row) => {
      const completeness = Number(row.avgCompleteness.toFixed(1));
      return `${row.market}: TRUE_OPPORTUNITY ${row.trueOppCount}/${row.total}, WATCHLIST ${row.watchlistCount}, priced ${row.priced}, completeness ${completeness}%`;
    });

    const weakestCompleteness = snapshots.reduce((acc, row) => (row.avgCompleteness < acc.avgCompleteness ? row : acc), snapshots[0]);
    const focusMarket = snapshots.reduce((acc, row) => (row.trueOppCount > acc.trueOppCount ? row : acc), snapshots[0]);
    const thesis =
      focusMarket.trueOppCount > 0
        ? `Prioriza ${focusMarket.market}: tiene más oportunidades estrictas ahora.`
        : "No hay oportunidad estricta suficiente; prioriza calidad de datos antes de underwriting.";
    const answer = `Resumen de riesgo por mercado: ${lines.join(" | ")}. Acción 1: filtrar TRUE_OPPORTUNITY en ${focusMarket.market}. Acción 2: subir completitud en ${weakestCompleteness.market} con Refresh Facts + Recompute.`;
    const appliedFilters =
      focusMarket.trueOppCount > 0
        ? { classification: "TRUE_OPPORTUNITY", market: focusMarket.market }
        : { classification: "WATCHLIST", market: weakestCompleteness.market };

    const citations: Citation[] = snapshots.map((row) => ({
      sourceType: "deal_list",
      sourceId: row.market,
      label: `Market snapshot: ${row.market}`,
      value: `total ${row.total} | trueOpp ${row.trueOppCount} | watchlist ${row.watchlistCount} | priced ${row.priced} | completeness ${row.avgCompleteness.toFixed(1)}%`,
    }));

    const suggestedActions: SuggestedAction[] = [
      {
        type: "apply_filters",
        label: `Open ${appliedFilters.classification} in ${appliedFilters.market}`,
        payload: appliedFilters,
      },
      {
        type: "go_integrations",
        label: "Go to integrations",
      },
    ];

    return {
      intent: "general",
      answer,
      thesis,
      nextAction: suggestedActions[0].label,
      confidence: "high",
      citations,
      suggestedActions,
      appliedFilters,
    };
  }

  private async resolveOpportunityFinderIntent(message: string, market?: string): Promise<DeterministicIntent | null> {
    const normalized = message.toLowerCase();
    const asksOpportunity = /(opportunit|oportunidad|deal|deals)/.test(normalized);
    const asksDetails = /(good|bueno|retorno|roi|return|comparables?|comps?|por que|porque|why|nueva|new|latest|reciente)/.test(
      normalized,
    );
    if (!asksOpportunity || !asksDetails) return null;

    const resolvedMarket = market ?? (await this.inferMarketFromMessage(normalized));
    const strict = await this.dealsService.list({
      classification: "TRUE_OPPORTUNITY",
      market: resolvedMarket,
      limit: 3,
      offset: 0,
    });
    const fallback = strict.total
      ? strict
      : await this.dealsService.list({
          classification: "WATCHLIST",
          market: resolvedMarket,
          limit: 3,
          offset: 0,
        });
    if (!fallback.items.length) return null;

    const selected = fallback.items[0];
    const [summary, projection, overview] = await Promise.all([
      this.dealsService.getOpportunitySummary(selected.id),
      this.dealsService.buildProjection(selected.id, { scenario: "base" }).catch(() => null),
      this.dealsService.getOverview(selected.id).catch(() => null),
    ]);
    const completenessScore =
      typeof overview?.dataQuality?.completenessScore === "number"
        ? overview.dataQuality.completenessScore
        : typeof selected.dataCompletenessScore === "number"
          ? selected.dataCompletenessScore
          : 0;
    const comps = (overview?.comparables ?? []).slice(0, 3);
    const marketLabel = resolvedMarket ? ` en ${resolvedMarket}` : "";
    const classification = summary.classification;
    const isStrict = classification === "TRUE_OPPORTUNITY";
    const thesis = isStrict
      ? `La oportunidad prioritaria${marketLabel} es ${selected.name}.`
      : `No hay oportunidad estricta${marketLabel}; mejor candidato actual: ${selected.name} (${classification}).`;
    const returnLine = projection
      ? `Retorno base estimado: NOI ${projection.metrics.annualNOI.toFixed(0)}, Exit ${projection.metrics.estimatedExitValue.toFixed(
          0,
        )}, Cash-on-cash ${projection.metrics.cashOnCashPct.toFixed(2)}%.`
      : "Retorno base estimado: dato no disponible en fuentes actuales.";
    const compLine = comps.length
      ? `Comparables: ${comps
          .map((row) => `${row.address} (${row.distanceMiles !== null ? `${row.distanceMiles.toFixed(2)}mi` : "n/d"})`)
          .join("; ")}.`
      : "Comparables: dato no disponible en fuentes actuales.";

    const answer = [
      thesis,
      `Clasificación ${classification} · Spread ${
        typeof summary.spreadToAskPct === "number" ? `${summary.spreadToAskPct.toFixed(1)}%` : "n/d"
      } · Comps ${summary.comparableCount ?? "n/d"} · Completeness ${completenessScore.toFixed(1)}%.`,
      `Por qué: ${summary.classificationReason}`,
      returnLine,
      compLine,
      `Siguiente paso: ${summary.nextBestAction}`,
    ]
      .filter(Boolean)
      .join(" ");

    const appliedFilters =
      classification === "TRUE_OPPORTUNITY"
        ? { classification: "TRUE_OPPORTUNITY", ...(resolvedMarket ? { market: resolvedMarket } : {}) }
        : { classification: "WATCHLIST", ...(resolvedMarket ? { market: resolvedMarket } : {}) };

    const citations: Citation[] = [
      {
        sourceType: "deal_list",
        sourceId: resolvedMarket ?? null,
        label: "Opportunity selection set",
        value: `${fallback.total} ${classification === "TRUE_OPPORTUNITY" ? "strict" : "watchlist"} candidates${marketLabel}`,
      },
      {
        sourceType: "deal_overview",
        sourceId: selected.id,
        label: "Selected opportunity",
        value: `${selected.name} | ${classification} | score ${selected.score ?? "n/a"}`,
      },
      {
        sourceType: "deal_overview",
        sourceId: selected.id,
        label: "Opportunity summary",
        value: `spread ${summary.spreadToAskPct ?? "n/a"} | comps ${summary.comparableCount ?? "n/a"} | completeness ${completenessScore.toFixed(
          1,
        )}%`,
      },
      {
        sourceType: "deal_overview",
        sourceId: selected.id,
        label: "Projection base scenario",
        value: projection
          ? `cashOnCash ${projection.metrics.cashOnCashPct.toFixed(2)}% | exit ${projection.metrics.estimatedExitValue.toFixed(0)}`
          : "not available",
      },
    ];

    return {
      intent: "top_opportunities",
      answer,
      thesis,
      nextAction: `Open ${selected.name}`,
      confidence: "high",
      citations,
      suggestedActions: [
        { type: "open_deal", label: "Open top opportunity", payload: { dealId: selected.id } },
        { type: "apply_filters", label: "Apply opportunity filters", payload: appliedFilters },
      ],
      appliedFilters,
    };
  }

  private async resolveTopOpportunitiesIntent(message: string, market?: string): Promise<DeterministicIntent | null> {
    const normalized = message.toLowerCase();
    const asksTop =
      /(top|best|mejor(?:es)?|prioritize|prioriza|rank)/.test(normalized) &&
      /(opportunit|oportunidad(?:es)?|deal|deals)/.test(normalized);
    if (!asksTop) return null;

    const resolvedMarket = market ?? (await this.inferMarketFromMessage(normalized));
    const listing = await this.dealsService.list({
      classification: "TRUE_OPPORTUNITY",
      market: resolvedMarket,
      limit: 5,
      offset: 0,
    });
    const marketLabel = resolvedMarket ? ` en ${resolvedMarket}` : "";
    const nextActionLabel = "Open true opportunities";

    if (!listing.items.length) {
      return {
        intent: "top_opportunities",
        answer: `No hay TRUE_OPPORTUNITY${marketLabel} con la regla estricta en este momento.`,
        thesis: `No hay oportunidades estrictas${marketLabel}.`,
        nextAction: nextActionLabel,
        lane: "RESEARCH_REQUIRED",
        metrics: { totalMatches: 0 },
        decisionBlockers: ["No strict opportunities currently match all gates."],
        confidence: "medium",
        citations: [
          {
            sourceType: "deal_list",
            sourceId: resolvedMarket ?? null,
            label: "TRUE_OPPORTUNITY snapshot",
            value: `0 deals${marketLabel}`,
          },
        ],
        suggestedActions: [
          {
            type: "apply_filters",
            label: nextActionLabel,
            payload: { classification: "TRUE_OPPORTUNITY", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
          },
        ],
        appliedFilters: { classification: "TRUE_OPPORTUNITY", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
      };
    }

    const bullets = listing.items
      .map((deal, index) => `${index + 1}) ${deal.name} - ${deal.market ?? "n/a"} - score ${deal.score ?? "n/a"}`)
      .join("; ");

    return {
      intent: "top_opportunities",
      answer: `Top TRUE_OPPORTUNITY${marketLabel}: ${bullets}`,
      thesis: `Estas propiedades cumplen la regla estricta de oportunidad${marketLabel}.`,
      nextAction: nextActionLabel,
      lane: String(listing.items[0].lane ?? "OFF_MARKET_STANDARD"),
      metrics: {
        totalMatches: listing.total,
        topPipelineScore: listing.items[0].pipelineScore ?? listing.items[0].score ?? null,
      },
      decisionBlockers: [],
      confidence: "high",
      citations: [
        {
          sourceType: "deal_list",
          sourceId: resolvedMarket ?? null,
          label: "TRUE_OPPORTUNITY snapshot",
          value: `${listing.total} deals${marketLabel}`,
        },
        ...listing.items.map(
          (deal, index) =>
            ({
              sourceType: "deal_list" as const,
              sourceId: deal.id,
              label: `Top opportunity #${index + 1}`,
              value: `${deal.name} | classification ${deal.classification ?? "n/a"} | score ${deal.score ?? "n/a"}`,
            }) satisfies Citation,
        ),
      ],
      suggestedActions: [
        {
          type: "apply_filters",
          label: nextActionLabel,
          payload: { classification: "TRUE_OPPORTUNITY", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
        },
        {
          type: "open_deal",
          label: "Open first true opportunity",
          payload: { dealId: listing.items[0].id },
        },
      ],
      appliedFilters: { classification: "TRUE_OPPORTUNITY", ...(resolvedMarket ? { market: resolvedMarket } : {}) },
    };
  }

  async query(userId: string, payload: ChatQueryDto) {
    this.ensureEnabled();
    if (!userId) throw new BadRequestException("Missing authenticated user");
    const message = this.resolveMessage(payload);
    if (!message) throw new BadRequestException("message is required");

    const session = await this.getOrCreateSession(userId, payload.sessionId);
    const { template, context, citations } = await this.buildContext(payload.dealId, payload.market);
    const contextRecord = context as Record<string, unknown>;
    const taskTypeResolved = this.resolveTaskType(payload, contextRecord);
    const contextEcho = this.buildContextEcho(payload, contextRecord);
    const quickReplies = this.buildQuickReplies(taskTypeResolved);
    const memoryUpdate = this.buildMemoryUpdate(message, payload);
    const resolvedTemplate = this.resolveTemplate(message, template, contextRecord);
    const appStateRecord = this.asRecord(payload.appState);
    const structuredV2Enabled = this.isStructuredV2Enabled();
    const uiCapabilities = this.normalizeUiCapabilities(payload.uiCapabilities);
    const promptHash = createHash("sha256")
      .update(`${resolvedTemplate}:${this.templatePrompt(resolvedTemplate)}`)
      .digest("hex")
      .slice(0, 24);

    let tokenUsage: number | undefined;
    let answer = "";
    let intent: ChatIntent = "general";
    let thesis = "";
    let nextAction = "";
    let lane: string | undefined;
    let metrics: Record<string, string | number | null> | undefined;
    let decisionBlockers: string[] = [];
    let confidence: Confidence = "low";
    let appliedFilters: Record<string, unknown> = {};
    let suggestedActions: SuggestedAction[] = [];
    let agentRunId: string | undefined;
    let workflowTasks: Array<Record<string, unknown>> = [];
    let economics:
      | {
          profitNet: number;
          marginPct: number;
          closeProbability: number;
        }
      | undefined;
    let splitOutcome:
      | {
          operatorPct: number;
          investorPct: number;
          operatorShare: number;
          investorShare: number;
          splitPositive: boolean;
        }
      | undefined;
    let liveVerificationUsed: boolean | undefined;
    const responseCitations: Citation[] = [...citations];
    const guardrailsTriggered: string[] = [];
    let dataRequests = this.buildDataRequests(taskTypeResolved, payload, contextRecord);

    const agenticResponse =
      structuredV2Enabled
        ? await this.agentsService.run({
            userId,
            sessionId: session.id,
            dealId: payload.dealId,
            message,
            taskType: taskTypeResolved,
            market: payload.market,
            appState: appStateRecord,
          })
        : null;

    const deterministicCopilot = agenticResponse ? null : await this.resolveCopilotFromAppState(payload);
    const deterministicDealThesis = this.resolveDealThesisIntent(message, contextRecord);
    const deterministicDealInvestment =
      deterministicDealThesis === null ? await this.resolveDealInvestmentIntent(message, contextRecord) : null;
    const deterministicOpportunityFinder =
      deterministicDealThesis === null && deterministicDealInvestment === null
        ? await this.resolveOpportunityFinderIntent(message, payload.market)
        : null;
    const deterministicNewDeals =
      deterministicDealThesis === null && deterministicDealInvestment === null && deterministicOpportunityFinder === null
        ? await this.resolveNewDealsIntent(message, payload.market)
        : null;
    const deterministicMarketRisk =
      deterministicDealThesis === null &&
      deterministicDealInvestment === null &&
      deterministicOpportunityFinder === null &&
      deterministicNewDeals === null
        ? await this.resolveMarketRiskIntent(message, payload.market)
        : null;
    const deterministicTopOpportunities =
      deterministicDealThesis === null &&
      deterministicDealInvestment === null &&
      deterministicOpportunityFinder === null &&
      deterministicNewDeals === null &&
      deterministicMarketRisk === null
        ? await this.resolveTopOpportunitiesIntent(message, payload.market)
        : null;

    if (agenticResponse) {
      intent = "general";
      answer = agenticResponse.answer;
      thesis = agenticResponse.thesis;
      nextAction = agenticResponse.nextAction;
      confidence = agenticResponse.confidence;
      lane = agenticResponse.lane;
      metrics = agenticResponse.metrics;
      decisionBlockers = agenticResponse.decisionBlockers ?? [];
      guardrailsTriggered.push(...(agenticResponse.guardrailsTriggered ?? []));
      suggestedActions = this.buildSuggestedActions(
        `${message} ${agenticResponse.recommendation}`,
        payload.dealId,
        appliedFilters,
        taskTypeResolved,
        appStateRecord,
      );
      if (payload.dealId) {
        suggestedActions.push({
          type: "create_alert",
          label: "Create alert for this deal",
          payload: { dealId: payload.dealId, trigger: "STATUS_CHANGED" },
        });
      }
      workflowTasks = (agenticResponse.workflowTasks ?? []) as unknown as Array<Record<string, unknown>>;
      economics = agenticResponse.economics;
      splitOutcome = agenticResponse.splitOutcome;
      liveVerificationUsed = agenticResponse.liveVerificationUsed;
      agentRunId = agenticResponse.agentRunId;
      tokenUsage = agenticResponse.tokenUsage;
    } else if (taskTypeResolved === "CHAT_COPILOT" && deterministicCopilot) {
      intent = deterministicCopilot.intent;
      answer = deterministicCopilot.answer;
      thesis = deterministicCopilot.thesis;
      nextAction = deterministicCopilot.nextAction;
      confidence = deterministicCopilot.confidence;
      lane = deterministicCopilot.lane;
      metrics = deterministicCopilot.metrics;
      decisionBlockers = deterministicCopilot.decisionBlockers ?? [];
      responseCitations.push(...deterministicCopilot.citations);
      appliedFilters = deterministicCopilot.appliedFilters;
      suggestedActions = deterministicCopilot.suggestedActions;
    } else if (deterministicDealThesis) {
      intent = deterministicDealThesis.intent;
      answer = deterministicDealThesis.answer;
      thesis = deterministicDealThesis.thesis;
      nextAction = deterministicDealThesis.nextAction;
      confidence = deterministicDealThesis.confidence;
      lane = deterministicDealThesis.lane;
      metrics = deterministicDealThesis.metrics;
      decisionBlockers = deterministicDealThesis.decisionBlockers ?? [];
      responseCitations.push(...deterministicDealThesis.citations);
      appliedFilters = deterministicDealThesis.appliedFilters;
      suggestedActions = deterministicDealThesis.suggestedActions;
    } else if (deterministicDealInvestment) {
      intent = deterministicDealInvestment.intent;
      answer = deterministicDealInvestment.answer;
      thesis = deterministicDealInvestment.thesis;
      nextAction = deterministicDealInvestment.nextAction;
      confidence = deterministicDealInvestment.confidence;
      lane = deterministicDealInvestment.lane;
      metrics = deterministicDealInvestment.metrics;
      decisionBlockers = deterministicDealInvestment.decisionBlockers ?? [];
      responseCitations.push(...deterministicDealInvestment.citations);
      appliedFilters = deterministicDealInvestment.appliedFilters;
      suggestedActions = deterministicDealInvestment.suggestedActions;
    } else if (deterministicOpportunityFinder) {
      intent = deterministicOpportunityFinder.intent;
      answer = deterministicOpportunityFinder.answer;
      thesis = deterministicOpportunityFinder.thesis;
      nextAction = deterministicOpportunityFinder.nextAction;
      confidence = deterministicOpportunityFinder.confidence;
      lane = deterministicOpportunityFinder.lane;
      metrics = deterministicOpportunityFinder.metrics;
      decisionBlockers = deterministicOpportunityFinder.decisionBlockers ?? [];
      responseCitations.push(...deterministicOpportunityFinder.citations);
      appliedFilters = deterministicOpportunityFinder.appliedFilters;
      suggestedActions = deterministicOpportunityFinder.suggestedActions;
    } else if (deterministicNewDeals) {
      intent = deterministicNewDeals.intent;
      answer = deterministicNewDeals.answer;
      thesis = deterministicNewDeals.thesis;
      nextAction = deterministicNewDeals.nextAction;
      confidence = deterministicNewDeals.confidence;
      lane = deterministicNewDeals.lane;
      metrics = deterministicNewDeals.metrics;
      decisionBlockers = deterministicNewDeals.decisionBlockers ?? [];
      responseCitations.push(...deterministicNewDeals.citations);
      appliedFilters = deterministicNewDeals.appliedFilters;
      suggestedActions = deterministicNewDeals.suggestedActions;
    } else if (deterministicMarketRisk) {
      intent = deterministicMarketRisk.intent;
      answer = deterministicMarketRisk.answer;
      thesis = deterministicMarketRisk.thesis;
      nextAction = deterministicMarketRisk.nextAction;
      confidence = deterministicMarketRisk.confidence;
      lane = deterministicMarketRisk.lane;
      metrics = deterministicMarketRisk.metrics;
      decisionBlockers = deterministicMarketRisk.decisionBlockers ?? [];
      responseCitations.push(...deterministicMarketRisk.citations);
      appliedFilters = deterministicMarketRisk.appliedFilters;
      suggestedActions = deterministicMarketRisk.suggestedActions;
    } else if (deterministicTopOpportunities) {
      intent = deterministicTopOpportunities.intent;
      answer = deterministicTopOpportunities.answer;
      thesis = deterministicTopOpportunities.thesis;
      nextAction = deterministicTopOpportunities.nextAction;
      confidence = deterministicTopOpportunities.confidence;
      lane = deterministicTopOpportunities.lane;
      metrics = deterministicTopOpportunities.metrics;
      decisionBlockers = deterministicTopOpportunities.decisionBlockers ?? [];
      responseCitations.push(...deterministicTopOpportunities.citations);
      appliedFilters = deterministicTopOpportunities.appliedFilters;
      suggestedActions = deterministicTopOpportunities.suggestedActions;
    } else {
      const openAI = await this.callOpenAI(message, context, resolvedTemplate);
      const draftAnswer = openAI?.answer ?? this.heuristicAnswer(message, context as Record<string, unknown>);
      const guarded = this.applyCitationGuardrails(draftAnswer, responseCitations);
      if (guarded.triggered) {
        guardrailsTriggered.push("UNCITED_NUMERIC_CLAIMS_BLOCKED");
        responseCitations.push({
          sourceType: "system",
          label: "Guardrail",
          value: "Uncited numeric claims were blocked.",
        });
      }

      answer = guarded.answer;
      tokenUsage = openAI?.tokenUsage;
      appliedFilters = await this.inferFiltersFromMessage(message.toLowerCase());
      suggestedActions = this.buildSuggestedActions(
        message,
        payload.dealId,
        appliedFilters,
        taskTypeResolved,
        appStateRecord,
      );
      thesis = openAI?.thesis?.trim() || guarded.answer.split(".")[0]?.trim() || guarded.answer;
      nextAction = openAI?.nextAction?.trim() || suggestedActions[0]?.label || "Open deals";
      confidence = guarded.triggered ? "low" : openAI?.confidence ?? (openAI?.answer ? "medium" : "low");
      const dealOpportunity = this.asRecord((context as Record<string, unknown>).opportunitySummary);
      lane = openAI?.lane?.trim() || this.readString(dealOpportunity, "lane") || lane;
      metrics = openAI?.metrics ?? {
        spreadToAskPct: this.readNumber(dealOpportunity, "spreadToAskPct"),
        comparableCount: this.readNumber(dealOpportunity, "comparableCount"),
        completenessScore: this.readNumber(this.asRecord((context as Record<string, unknown>).dataQuality), "completenessScore"),
      };
      decisionBlockers = openAI?.decisionBlockers?.length
        ? openAI.decisionBlockers.slice(0, 4)
        : this.readStringArray(dealOpportunity, "blockers").slice(0, 4);
    }

    answer = this.stripDayCounts(answer);
    thesis = this.stripDayCounts(thesis);
    const guardrailed = this.applyDealGuardrails({
      taskType: taskTypeResolved,
      context: contextRecord,
      answer,
      confidence,
      lane,
      decisionBlockers,
      metrics,
      guardrailsTriggered,
    });
    answer = guardrailed.answer;
    confidence = guardrailed.confidence;
    lane = guardrailed.lane;
    decisionBlockers = guardrailed.decisionBlockers.slice(0, 8);
    metrics = Object.keys(guardrailed.metrics).length ? guardrailed.metrics : metrics;

    if (guardrailsTriggered.length) {
      const unique = Array.from(new Set(guardrailsTriggered));
      guardrailsTriggered.splice(0, guardrailsTriggered.length, ...unique);
    }
    dataRequests = dataRequests.filter((item, index, rows) => rows.findIndex((next) => next.key === item.key) === index);
    const uiActions = this.filterUiActionsByCapabilities(this.mapSuggestedActionsToUiActions(suggestedActions), uiCapabilities);

    await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.USER,
        content: message,
      },
    });

    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: ChatMessageRole.ASSISTANT,
        content: answer,
        model: this.getModel(),
        tokenUsage,
        metadata: JSON.stringify({
          market: payload.market ?? null,
          dealId: payload.dealId ?? null,
          template: resolvedTemplate,
          intent,
          lane: lane ?? null,
          taskTypeResolved,
          promptHash,
          guardrailsTriggered,
          contextEcho,
          dataRequests,
          quickReplies,
          memoryUpdate,
          uiCapabilities,
          structuredV2Enabled,
          responseJson: {
            answer,
            confidence,
            thesis,
            nextAction,
            lane: lane ?? null,
            metrics: metrics ?? {},
            decisionBlockers,
            uiActions,
            agentRunId: agentRunId ?? null,
            workflowTasks,
            economics: economics ?? null,
            splitOutcome: splitOutcome ?? null,
            liveVerificationUsed: liveVerificationUsed ?? false,
          },
          deterministicIntent: Boolean(
            deterministicCopilot ||
            deterministicDealThesis ||
              deterministicDealInvestment ||
              deterministicOpportunityFinder ||
              deterministicNewDeals ||
              deterministicMarketRisk ||
              deterministicTopOpportunities,
          ),
        }),
      },
    });

    if (responseCitations.length) {
      await this.prisma.chatCitationLog.createMany({
        data: responseCitations.map((citation) => ({
          messageId: assistantMessage.id,
          sourceType: citation.sourceType,
          sourceId: citation.sourceId ?? null,
          label: citation.label,
          value: citation.value ?? null,
        })),
      });
    }

    return {
      sessionId: session.id,
      answer,
      intent,
      thesis,
      nextAction,
      lane,
      metrics,
      decisionBlockers,
      confidence,
      citations: responseCitations,
      suggestedActions,
      appliedFilters,
      ...(structuredV2Enabled
        ? {
            assistantMessageEs: answer,
            taskTypeResolved,
            contextEcho,
            dataRequests,
            uiActions,
            quickReplies,
            memoryUpdate,
            guardrailsTriggered,
            agentRunId,
            workflowTasks,
            economics,
            splitOutcome,
            liveVerificationUsed: liveVerificationUsed ?? false,
          }
        : {}),
    };
  }

  async getContext(userId: string, dealId: string) {
    this.ensureEnabled();
    if (!userId) throw new BadRequestException("Missing authenticated user");
    const { context, citations } = await this.buildContext(dealId);
    return {
      userId,
      dealId,
      context,
      citations,
    };
  }

  async suggestFilters(userId: string, payload: ChatSuggestFiltersDto) {
    this.ensureEnabled();
    if (!userId) throw new BadRequestException("Missing authenticated user");
    const rawMessage = this.resolveMessage(payload);
    if (!rawMessage) throw new BadRequestException("message is required");

    const filters = await this.inferFiltersFromMessage(rawMessage.toLowerCase());

    const suggestedActions: SuggestedAction[] = [
      {
        type: "apply_filters",
        label: "Apply filters in Deals",
        payload: filters,
      },
    ];

    return {
      userId,
      filters,
      suggestedActions,
      reasoning:
        "Filters were inferred from message keywords (market, status, asset type, and score threshold). Review before applying.",
    };
  }
}
