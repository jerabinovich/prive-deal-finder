export type DealStatus = "NEW" | "DD" | "NEGOTIATION" | "CLOSED" | "LOST";
export type OutreachChannel = "EMAIL" | "SMS" | "NOTE";
export type IntegrationStatus = "OK" | "DEGRADED" | "ERROR" | "NEEDS_CONFIG";
export type ChatTaskType = "CHAT_COPILOT" | "PIPELINE_TRIAGE" | "DEAL_DEEP_DIVE" | "GOV_LAND_PROFILE";
export type DealClassification =
  | "PIPELINE_LISTING"
  | "WATCHLIST"
  | "TRUE_OPPORTUNITY"
  | "DISTRESS_CANDIDATE";
export type DealLane =
  | "DISTRESS_OWNER"
  | "AUCTION_MONITOR"
  | "GOV_LAND_P3"
  | "OFF_MARKET_STANDARD"
  | "NON_ACQUIRABLE_NOISE"
  | "RESEARCH_REQUIRED";
export type RecommendedAction =
  | "CONTACT_NOW"
  | "MONITOR"
  | "AUCTION_PREP"
  | "GOV_PURSUE"
  | "RESEARCH"
  | "ARCHIVE";
export type DistressStage =
  | "NONE"
  | "SIGNALS_ONLY"
  | "PRE_FORECLOSURE"
  | "AUCTION_SCHEDULED"
  | "AUCTION_POSTPONED_OR_CANCELLED"
  | "REO_BANK_OWNED"
  | "SHORT_SALE_ACTIVE"
  | "TAX_SALE_PROCESS"
  | "PROBATE_ESTATE"
  | "CODE_ENFORCEMENT"
  | "BANKRUPTCY"
  | "GOVERNMENT_LAND"
  | "UNKNOWN";
export type NoiseReason =
  | "COMMON_AREA"
  | "ROADWAY"
  | "RAILROAD"
  | "CENTRALLY_ASSESSED"
  | "UTILITY"
  | "UNKNOWN";

export interface Deal {
  id: string;
  name: string;
  parcelId?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  assetType?: string;
  market?: string;
  submarket?: string;
  score?: number;
  pipelineScore?: number;
  classification?: DealClassification;
  lane?: DealLane;
  recommendedAction?: RecommendedAction;
  distressStage?: DistressStage;
  nextEventDate?: string;
  contactabilityScore?: number;
  isNoise?: boolean;
  noiseReason?: NoiseReason;
  status: DealStatus;
  source?: string;
}

export interface Owner {
  id: string;
  name: string;
  entityType?: string;
  email?: string;
  phone?: string;
}

export interface IntegrationHealth {
  source: string;
  status: IntegrationStatus;
  lastSyncAt?: string;
  lastError?: string;
}

export type OpportunityVerdict = "STRONG_BUY" | "WATCHLIST" | "HIGH_RISK";
export type InsightConfidence = "high" | "medium" | "low";

export interface OpportunityGateStatus {
  label: string;
  passed: boolean;
  value: number | string | null;
  threshold: number | string;
}

export interface OpportunitySummary {
  score: number;
  verdict: OpportunityVerdict;
  confidence: InsightConfidence;
  classification: DealClassification;
  lane?: DealLane;
  recommendedAction?: RecommendedAction;
  distressStage?: DistressStage;
  nextEvent?: string | null;
  contactability?: number | null;
  isNoise?: boolean;
  noiseReason?: NoiseReason | null;
  classificationReason: string;
  gates: Record<string, OpportunityGateStatus>;
  nextBestAction: string;
  topDrivers: string[];
  riskFlags: string[];
  estimatedValue?: number | null;
  spreadToAskPct?: number | null;
  comparableCount?: number;
}

export interface InvestmentThesis {
  classification: DealClassification;
  lane?: DealLane;
  recommendedAction?: RecommendedAction;
  headline: string;
  reason: string;
  spreadToAskPct: number | null;
  comparableCount: number;
  completenessScore: number;
  confidence: InsightConfidence;
  foreclosureStatus: string;
  gates: Record<string, OpportunityGateStatus>;
  nextBestAction: string;
  drivers: string[];
  risks: string[];
}

export interface OperationalDecision {
  lane: DealLane;
  recommendedAction: RecommendedAction;
  distressStage: DistressStage;
  nextEventDate: string | null;
  contactabilityScore: number;
  isNoise: boolean;
  noiseReason: NoiseReason | null;
  why: string[];
  blockers: string[];
}

export interface TriageResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface ProjectionScenario {
  scenario: "conservative" | "base" | "aggressive";
  purchasePrice: number;
  rehabCost: number;
  monthlyRent: number;
  monthlyExpenses: number;
  annualNOI: number;
  exitCapRate: number;
  holdingMonths: number;
  estimatedExitValue: number;
  profit: number;
  cashOnCashPct: number;
}

export interface DealDataQuality {
  completenessScore: number;
  missingFields: string[];
  source: string;
  hasGeo: boolean;
  hasPricing: boolean;
  hasBuildingFacts: boolean;
  lastUpdatedAt?: string;
}

export interface ChatCitation {
  sourceType: "deal_overview" | "deal_list" | "integration_status" | "report_pipeline" | "system";
  sourceId?: string | null;
  label: string;
  value?: string | null;
}

export interface ChatPipelineRowSnapshot {
  dealId?: string;
  dealKey?: string;
  name?: string;
  market?: string;
  assetType?: string;
  useCategory?: string;
  pipelineScore?: number | null;
  classification?: string;
  status?: string;
}

export interface ChatIntegrationSnapshot {
  source: string;
  status?: string;
  freshness?: string;
  coveragePct?: number | null;
  message?: string | null;
  lastSyncAt?: string | null;
}

export interface ChatRunSnapshot {
  id?: string;
  source?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string | null;
  runType?: string;
  severity?: string;
  metrics?: Record<string, unknown>;
}

export interface ChatAppStateInput {
  route?: string;
  selectedDealId?: string | null;
  selectedDealKey?: string | null;
  activeFiltersCount?: number;
  activeFilters?: Record<string, unknown>;
  pipelineVisibleRange?: string | null;
  pipelineVisibleRows?: ChatPipelineRowSnapshot[];
  integrationsSnapshot?: ChatIntegrationSnapshot[];
  recentRuns?: ChatRunSnapshot[];
}

export interface ChatSuggestedAction {
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
}

export interface CopilotDataRequest {
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
}

export interface CopilotUiAction {
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
}

export interface CopilotMemoryUpdate {
  userGoal?: string;
  buyBox?: string;
  riskTolerance?: string;
  preferredMarkets?: string[];
}

export interface WorkflowTask {
  id?: string;
  dealId?: string;
  lane?: DealLane | string | null;
  taskType: string;
  title: string;
  description?: string | null;
  priority: number;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELED";
  dueAt?: string | null;
  ownerUserId?: string | null;
  source: "AGENT" | "SYSTEM" | "USER";
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EconomicsSnapshot {
  profitNet: number;
  marginPct: number;
  closeProbability: number;
}

export interface RevenueSplitOutcome {
  operatorPct: number;
  investorPct: number;
  operatorShare: number;
  investorShare: number;
  splitPositive: boolean;
}

export interface AgentRunSummary {
  agentRunId: string;
  taskTypeResolved: ChatTaskType;
  guardrailsTriggered: string[];
  liveVerificationUsed: boolean;
}

export interface AlertRule {
  id: string;
  userId: string;
  triggerType: string;
  market?: string | null;
  lane?: DealLane | null;
  active: boolean;
  delivery: "IN_APP" | "DIGEST_DAILY";
  config?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertInboxItem {
  id: string;
  userId: string;
  readAt?: string | null;
  deliveredAt?: string | null;
  channel: "IN_APP" | "DIGEST_DAILY";
  createdAt: string;
  alertEvent: {
    id: string;
    dealId?: string | null;
    triggerType: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    eventAt: string;
    payload?: Record<string, unknown> | null;
  };
}

export interface ChatQueryRequest {
  message?: string;
  query?: string;
  question?: string;
  dealId?: string;
  market?: string;
  sessionId?: string;
  taskType?: ChatTaskType;
  appState?: ChatAppStateInput;
  uiCapabilities?: string[];
}

export interface ChatQueryResponse {
  sessionId: string;
  answer: string;
  intent?: "why_deal" | "deal_vs_listing" | "new_deals" | "top_opportunities" | "general";
  thesis?: string;
  nextAction?: string;
  lane?: DealLane;
  metrics?: Record<string, string | number | null>;
  decisionBlockers?: string[];
  confidence: InsightConfidence;
  citations: ChatCitation[];
  suggestedActions: ChatSuggestedAction[];
  appliedFilters?: Record<string, unknown>;
  assistantMessageEs?: string;
  taskTypeResolved?: ChatTaskType;
  contextEcho?: {
    route?: string;
    selectedDealKey?: string | null;
    pipelineVisibleRange?: string | null;
    activeFiltersCount?: number | null;
    marketsInView?: string[];
  };
  dataRequests?: CopilotDataRequest[];
  uiActions?: CopilotUiAction[];
  quickReplies?: string[];
  memoryUpdate?: CopilotMemoryUpdate;
  guardrailsTriggered?: string[];
  agentRunId?: string;
  workflowTasks?: WorkflowTask[];
  economics?: EconomicsSnapshot;
  splitOutcome?: RevenueSplitOutcome;
  liveVerificationUsed?: boolean;
}

export type SortDir = "asc" | "desc";

export interface SortSpec<T extends string = string> {
  sortBy: T;
  sortDir: SortDir;
}

export interface TableFilterState {
  query?: string;
  status?: string;
  market?: string;
  source?: string;
}

export interface IntegrationStatusQuery {
  source?: string;
  category?: string;
  configured?: boolean;
  status?: string;
  freshness?: string;
  blocked?: boolean;
}

export interface IntegrationRunsQuery {
  source?: string;
  status?: string;
  message?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  sortBy?: "startedAt" | "endedAt" | "status" | "source";
  sortDir?: SortDir;
  operatorView?: boolean;
}

export interface PipelineReportQuery {
  status?: string;
  minCount?: number;
  sortBy?: "status" | "count" | "avgScore";
  sortDir?: SortDir;
}

export interface IntegrationRunInsight {
  runType: "CONNECTIVITY_CHECK" | "SAMPLE_SYNC" | "FULL_SYNC" | "BULK_INGEST" | "UNKNOWN";
  severity: "LOW" | "MEDIUM" | "HIGH";
  tableMessage: string;
  businessImpact: {
    createdDeals: number;
    updatedDeals: number;
    createdOwners: number;
    linkedOwners: number;
    sampledRecords: number;
  };
  anomalies: Array<{
    type: "OWNER_LINK_GAP" | "NO_NEW_DEALS" | "LOW_VOLUME" | "AUTH_RISK" | "DATA_SCHEMA_CHANGE" | "OTHER";
    detail: string;
    recommendedFix: string;
  }>;
  nextActions: Array<{
    priority: number;
    action: string;
    who: "SYSTEM" | "OPS" | "USER";
    why: string;
  }>;
  shouldAlert: boolean;
  alertReason: string;
}
