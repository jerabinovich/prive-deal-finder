"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { useChatContext } from "./ChatContextProvider";
import { useToast } from "./ToastProvider";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: string;
  thesis?: string;
  nextAction?: string;
  confidence?: "high" | "medium" | "low";
  lane?: string;
  metrics?: Record<string, string | number | null>;
  decisionBlockers?: string[];
  citations?: Array<{ sourceType: string; label: string; value?: string | null }>;
  actions?: UiAction[];
  quickReplies?: string[];
  guardrailsTriggered?: string[];
  dataRequests?: Array<{ key: string; why?: string }>;
  liveVerificationUsed?: boolean;
  workflowTasks?: Array<{
    id?: string;
    title: string;
    taskType: string;
    priority: number;
    status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELED";
  }>;
  economics?: {
    profitNet: number;
    marginPct: number;
    closeProbability: number;
  };
  splitOutcome?: {
    operatorPct: number;
    investorPct: number;
    operatorShare: number;
    investorShare: number;
    splitPositive: boolean;
  };
};

type UiAction = {
  action?: string;
  type?: string;
  label: string;
  params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  shouldAutoExecute?: boolean;
  why?: string;
};

type ChatQueryResponse = {
  sessionId: string;
  answer: string;
  assistantMessageEs?: string;
  taskTypeResolved?: "CHAT_COPILOT" | "PIPELINE_TRIAGE" | "DEAL_DEEP_DIVE" | "GOV_LAND_PROFILE";
  contextEcho?: {
    route?: string;
    selectedDealKey?: string | null;
    pipelineVisibleRange?: string | null;
    activeFiltersCount?: number | null;
    marketsInView?: string[];
  };
  dataRequests?: Array<{ key: string; params?: Record<string, unknown>; why?: string }>;
  uiActions?: UiAction[];
  quickReplies?: string[];
  memoryUpdate?: {
    userGoal?: string;
    buyBox?: string;
    riskTolerance?: string;
    preferredMarkets?: string[];
  };
  guardrailsTriggered?: string[];
  agentRunId?: string;
  workflowTasks?: Array<{
    id?: string;
    title: string;
    taskType: string;
    priority: number;
    status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELED";
  }>;
  economics?: {
    profitNet: number;
    marginPct: number;
    closeProbability: number;
  };
  splitOutcome?: {
    operatorPct: number;
    investorPct: number;
    operatorShare: number;
    investorShare: number;
    splitPositive: boolean;
  };
  liveVerificationUsed?: boolean;
  intent?: "why_deal" | "deal_vs_listing" | "new_deals" | "top_opportunities" | "general";
  thesis?: string;
  nextAction?: string;
  lane?: string;
  metrics?: Record<string, string | number | null>;
  decisionBlockers?: string[];
  confidence: "high" | "medium" | "low";
  citations: Array<{ sourceType: string; label: string; value?: string | null }>;
  suggestedActions: Array<{ type: string; label: string; payload?: Record<string, unknown> }>;
};

const CHAT_ENABLED = process.env.NEXT_PUBLIC_CHAT_ENABLE !== "false";
const UI_CAPABILITIES = [
  "OPEN_DEAL",
  "APPLY_FILTERS",
  "MARK_DD",
  "MOVE_STAGE",
  "RECOMPUTE_COMPS",
  "RECOMPUTE_INSIGHTS",
  "CREATE_ALERT",
  "SYNC_INTEGRATION",
  "ARCHIVE_DEAL",
];

function normalizeActionType(action: UiAction) {
  const direct = String(action.action || "").trim().toUpperCase();
  if (direct) return direct;
  const legacy = String(action.type || "").trim().toLowerCase();
  if (!legacy) return "";
  if (legacy === "open_deal") return "OPEN_DEAL";
  if (legacy === "apply_filters") return "APPLY_FILTERS";
  if (legacy === "go_integrations") return "GO_INTEGRATIONS";
  if (legacy === "recompute_comps") return "RECOMPUTE_COMPS";
  if (legacy === "recompute_insights") return "RECOMPUTE_INSIGHTS";
  if (legacy === "move_stage") return "MOVE_STAGE";
  if (legacy === "sync_integration") return "SYNC_INTEGRATION";
  if (legacy === "archive_deal") return "ARCHIVE_DEAL";
  if (legacy === "create_alert") return "CREATE_ALERT";
  return legacy.toUpperCase();
}

export default function PriveChatPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const { appState, publishState } = useChatContext();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const dealId = useMemo(() => {
    const match = pathname.match(/^\/deals\/([^/]+)$/);
    return match?.[1];
  }, [pathname]);

  useEffect(() => {
    publishState({
      route: pathname,
      selectedDealId: dealId ?? appState.selectedDealId ?? null,
      selectedDealKey: dealId ?? appState.selectedDealKey ?? null,
    });
  }, [appState.selectedDealId, appState.selectedDealKey, dealId, pathname, publishState]);

  if (!CHAT_ENABLED) return null;

  async function sendMessage() {
    const message = input.trim();
    if (!message || loading) return;

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: message,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const market = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("market") || undefined : undefined;
      const inferredTaskType = dealId
        ? "DEAL_DEEP_DIVE"
        : pathname.startsWith("/deals")
          ? "PIPELINE_TRIAGE"
          : pathname.startsWith("/settings/integrations")
            ? "CHAT_COPILOT"
            : pathname.startsWith("/reports")
              ? "PIPELINE_TRIAGE"
              : "CHAT_COPILOT";
      const response = await apiFetch<ChatQueryResponse>("/chat/query", {
        method: "POST",
        body: JSON.stringify({
          message,
          dealId,
          market,
          sessionId,
          taskType: inferredTaskType,
          uiCapabilities: UI_CAPABILITIES,
          appState: {
            ...appState,
            route: pathname,
            selectedDealId: dealId ?? appState.selectedDealId ?? null,
            selectedDealKey: dealId ?? appState.selectedDealKey ?? null,
          },
        }),
      });
      setSessionId(response.sessionId);

      const uiActions = (response.uiActions ?? []).map((action) => ({
        action: action.action,
        label: action.label,
        params: action.params,
        shouldAutoExecute: action.shouldAutoExecute,
        why: action.why,
      }));
      const legacyActions = (response.suggestedActions ?? []).map((action) => ({
        type: action.type,
        label: action.label,
        payload: action.payload,
      }));
      const actions = [...uiActions, ...legacyActions].filter(
        (action, index, rows) =>
          rows.findIndex((item) => normalizeActionType(item) === normalizeActionType(action) && item.label === action.label) === index,
      );

      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: response.assistantMessageEs || response.answer,
        intent: response.intent,
        thesis: response.thesis,
        nextAction: response.nextAction,
        confidence: response.confidence,
        lane: response.lane,
        metrics: response.metrics,
        decisionBlockers: response.decisionBlockers,
        citations: response.citations,
        actions,
        quickReplies: response.quickReplies ?? [],
        guardrailsTriggered: response.guardrailsTriggered ?? [],
        dataRequests: (response.dataRequests ?? []).map((item) => ({ key: item.key, why: item.why })),
        workflowTasks: response.workflowTasks ?? [],
        economics: response.economics,
        splitOutcome: response.splitOutcome,
        liveVerificationUsed: response.liveVerificationUsed ?? false,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Chat request failed";
      notify(text, "error");
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: `Error: ${text}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(rawAction: UiAction) {
    const actionType = normalizeActionType(rawAction);
    const payload = rawAction.params ?? rawAction.payload ?? {};
    const confirmationLabel = rawAction.label || actionType || "this action";
    const approved = window.confirm(`Confirm action: ${confirmationLabel}?`);
    if (!approved) return;

    if (actionType === "GO_INTEGRATIONS") {
      router.push("/settings/integrations");
      return;
    }

    if (actionType === "OPEN_DEAL") {
      const targetDealId = String(payload.dealId || dealId || "");
      if (targetDealId) router.push(`/deals/${targetDealId}`);
      return;
    }

    if (actionType === "APPLY_FILTERS") {
      const params = new URLSearchParams();
      Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        params.set(key, String(value));
      });
      const query = params.toString();
      router.push(query ? `/deals?${query}` : "/deals");
      notify("Suggested filters applied", "success");
      return;
    }

    if (actionType === "RECOMPUTE_COMPS" || actionType === "RECOMPUTE_INSIGHTS") {
      const targetDealId = String(payload.dealId || dealId || "");
      if (!targetDealId) return;
      const endpoint =
        actionType === "RECOMPUTE_COMPS"
          ? `/deals/${targetDealId}/recompute-comps`
          : `/deals/${targetDealId}/recompute-insights`;

      setLoading(true);
      try {
        await apiFetch(endpoint, { method: "POST" });
        notify(`${actionType === "RECOMPUTE_COMPS" ? "Comparables" : "Insights"} recomputed`, "success");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Action failed", "error");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (actionType === "MOVE_STAGE" || actionType === "MARK_DD") {
      const targetDealId = String(payload.dealId || dealId || "");
      if (!targetDealId) return;
      const nextStatus = String(payload.status || payload.stage || (actionType === "MARK_DD" ? "DD" : "")).trim() || "DD";
      setLoading(true);
      try {
        await apiFetch(`/deals/${targetDealId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
        notify(`Deal moved to ${nextStatus}`, "success");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Action failed", "error");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (actionType === "SYNC_INTEGRATION") {
      const source = String(payload.source || "").trim();
      if (!source) {
        notify("Missing integration source", "error");
        return;
      }
      const confirmPaidDataUse = payload.confirmPaidDataUse === true;
      setLoading(true);
      try {
        await apiFetch(`/integrations/${source}/sync`, {
          method: "POST",
          body: JSON.stringify({
            confirmPaidDataUse: confirmPaidDataUse || undefined,
          }),
        });
        notify(`Sync started for ${source}`, "success");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Sync failed", "error");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (actionType === "ARCHIVE_DEAL") {
      const targetDealId = String(payload.dealId || dealId || "");
      if (!targetDealId) return;
      setLoading(true);
      try {
        await apiFetch(`/deals/${targetDealId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "LOST" }),
        });
        notify("Deal archived", "success");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Archive failed", "error");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (actionType === "CREATE_ALERT") {
      const trigger = String(payload.trigger || payload.triggerType || "STATUS_CHANGED");
      const market =
        typeof payload.market === "string"
          ? payload.market
          : typeof appState.activeFilters?.market === "string"
            ? String(appState.activeFilters.market)
            : undefined;
      setLoading(true);
      try {
        await apiFetch("/alerts/rules", {
          method: "POST",
          body: JSON.stringify({
            triggerType: trigger,
            market: market || undefined,
            active: true,
            delivery: "IN_APP",
            config: {
              dealId: payload.dealId || dealId || null,
              source: "chat_action",
            },
          }),
        });
        notify("Alert rule created", "success");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Alert creation failed", "error");
      } finally {
        setLoading(false);
      }
      return;
    }

    notify(`Unsupported action: ${actionType || "unknown"}`, "info");
  }

  return (
    <div className={`chat-shell ${open ? "open" : ""}`}>
      <button className="chat-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? "Close Chat" : "Prive AI Chat"}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-header">
            <strong>Prive AI Chat</strong>
            <span className="muted">ChatGPT-powered</span>
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                Ask about opportunities, comparables, projections, or integrations.
              </div>
            )}
            {messages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role}`}>
                {message.role === "assistant" && message.intent ? (
                  <div className="chat-citation-item" style={{ marginBottom: 6 }}>
                    Intent: {message.intent}
                    {message.confidence ? ` · Confidence ${message.confidence}` : ""}
                  </div>
                ) : null}
                {message.role === "assistant" && message.thesis ? (
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Thesis: {message.thesis}</div>
                ) : null}
                {message.role === "assistant" && message.lane ? (
                  <div className="chat-citation-item" style={{ marginBottom: 6 }}>
                    Lane: {message.lane}
                  </div>
                ) : null}
                <div>{message.content}</div>
                {message.metrics && Object.keys(message.metrics).length ? (
                  <div className="chat-citations">
                    {Object.entries(message.metrics).map(([key, value]) => (
                      <div key={`${message.id}-m-${key}`} className="chat-citation-item">
                        {key}: {value === null || value === undefined || value === "" ? "n/a" : String(value)}
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.decisionBlockers?.length ? (
                  <div className="chat-citations">
                    {message.decisionBlockers.map((blocker, idx) => (
                      <div key={`${message.id}-b-${idx}`} className="chat-citation-item">
                        Blocker: {blocker}
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.guardrailsTriggered?.length ? (
                  <div className="chat-citations">
                    {message.guardrailsTriggered.map((item, idx) => (
                      <div key={`${message.id}-g-${idx}`} className="chat-citation-item">
                        Guardrail: {item}
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.dataRequests?.length ? (
                  <div className="chat-citations">
                    {message.dataRequests.map((item, idx) => (
                      <div key={`${message.id}-r-${idx}`} className="chat-citation-item">
                        Need data: {item.key}
                        {item.why ? ` · ${item.why}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.liveVerificationUsed ? (
                  <div className="chat-citation-item" style={{ marginTop: 6 }}>
                    Live verification: used
                  </div>
                ) : null}
                {message.economics ? (
                  <div className="chat-citations">
                    <div className="chat-citation-item">
                      Economics: profit {message.economics.profitNet.toFixed(2)} · margin {message.economics.marginPct.toFixed(1)}%
                    </div>
                    <div className="chat-citation-item">
                      Close probability: {(message.economics.closeProbability * 100).toFixed(1)}%
                    </div>
                  </div>
                ) : null}
                {message.splitOutcome ? (
                  <div className="chat-citations">
                    <div className="chat-citation-item">
                      Split: operator {(message.splitOutcome.operatorPct * 100).toFixed(0)}% · investor {(message.splitOutcome.investorPct * 100).toFixed(0)}%
                    </div>
                    <div className="chat-citation-item">
                      Shares: {message.splitOutcome.operatorShare.toFixed(2)} / {message.splitOutcome.investorShare.toFixed(2)} · {message.splitOutcome.splitPositive ? "positive" : "not positive"}
                    </div>
                  </div>
                ) : null}
                {message.workflowTasks?.length ? (
                  <div className="chat-citations">
                    {message.workflowTasks.slice(0, 4).map((task, idx) => (
                      <div key={`${message.id}-t-${idx}`} className="chat-citation-item">
                        Task P{task.priority}: {task.title} ({task.status})
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" && message.nextAction ? (
                  <div className="chat-citation-item" style={{ marginTop: 8 }}>
                    Next Action: {message.nextAction}
                  </div>
                ) : null}
                {message.citations?.length ? (
                  <div className="chat-citations">
                    {message.citations.slice(0, 3).map((citation, idx) => (
                      <div key={`${message.id}-c-${idx}`} className="chat-citation-item">
                        {citation.label}
                        {citation.value ? ` · ${citation.value}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.actions?.length ? (
                  <div className="chat-actions">
                    {message.actions.map((action, idx) => (
                      <button key={`${message.id}-a-${idx}`} className="button-ghost" onClick={() => handleAction(action)}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.quickReplies?.length ? (
                  <div className="chat-actions">
                    {message.quickReplies.slice(0, 4).map((reply, idx) => (
                      <button
                        key={`${message.id}-q-${idx}`}
                        className="button-ghost"
                        onClick={() => setInput(reply)}
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="chat-input-row">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask something about this deal or market..."
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  sendMessage().catch(() => undefined);
                }
              }}
            />
            <button disabled={loading} onClick={() => sendMessage().catch(() => undefined)}>
              {loading ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
