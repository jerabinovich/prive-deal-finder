export type AgentTaskType = "CHAT_COPILOT" | "PIPELINE_TRIAGE" | "DEAL_DEEP_DIVE" | "GOV_LAND_PROFILE";

export type AgentToolName =
  | "get_deal_overview"
  | "get_deal_knowledge_graph"
  | "readonly_sql_query"
  | "list_pipeline_rows"
  | "get_portfolio_snapshot"
  | "get_integration_status"
  | "get_integration_snapshot"
  | "get_recent_runs"
  | "get_pipeline_report"
  | "get_projection"
  | "get_owner_profile"
  | "get_workflow_tasks"
  | "get_alerts_snapshot"
  | "get_chat_history"
  | "get_outreach_history"
  | "get_distress_signals"
  | "web_verify"
  | "recompute_comps"
  | "recompute_insights"
  | "move_stage"
  | "sync_integration"
  | "archive_deal"
  | "create_alert_rule"
  | "create_workflow_task"
  | "log_outreach";

export type AgentDecision = "CONTACT_NOW" | "MONITOR" | "AUCTION_PREP" | "RESEARCH" | "ARCHIVE" | "GOV_PURSUE";

export type AgentWorkflowTaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELED";

export type AgentWorkflowTaskSource = "AGENT" | "SYSTEM" | "USER";

export interface AgentWorkflowTaskInput {
  lane?: string | null;
  taskType: string;
  title: string;
  description?: string;
  priority?: number;
  status?: AgentWorkflowTaskStatus;
  dueAt?: string | null;
  source?: AgentWorkflowTaskSource;
  metadata?: Record<string, unknown>;
}

export interface AgentWorkflowTaskSummary {
  id?: string;
  dealId?: string;
  lane?: string | null;
  taskType: string;
  title: string;
  description?: string | null;
  priority: number;
  status: AgentWorkflowTaskStatus;
  dueAt?: string | null;
  source: AgentWorkflowTaskSource;
}

export interface AgentEconomicsSnapshot {
  profitNet: number;
  marginPct: number;
  closeProbability: number;
}

export interface AgentSplitOutcome {
  operatorPct: number;
  investorPct: number;
  operatorShare: number;
  investorShare: number;
  splitPositive: boolean;
}

export interface AgentRecommendationPayload {
  agentRunId: string;
  answer: string;
  thesis: string;
  nextAction: string;
  recommendation: AgentDecision;
  lane?: string;
  confidence: "low" | "medium" | "high";
  metrics?: Record<string, string | number | null>;
  decisionBlockers?: string[];
  taskTypeResolved: AgentTaskType;
  guardrailsTriggered: string[];
  workflowTasks: AgentWorkflowTaskSummary[];
  economics?: AgentEconomicsSnapshot;
  splitOutcome?: AgentSplitOutcome;
  liveVerificationUsed: boolean;
  model: string;
  toolCalls: Array<{ name: AgentToolName; args: Record<string, unknown> }>;
  tokenUsage?: number;
}

export interface AgentExecutionContext {
  userId: string;
  sessionId: string;
  dealId?: string;
  message: string;
  taskType: AgentTaskType;
  market?: string;
  appState?: Record<string, unknown>;
}
