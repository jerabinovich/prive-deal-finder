"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { useRequireAuth } from "../../../lib/use-require-auth";
import ColumnHeaderSort from "../../components/ColumnHeaderSort";
import DataTableShell from "../../components/DataTableShell";
import TableEmptyState from "../../components/TableEmptyState";
import TableFilterRow from "../../components/TableFilterRow";
import { useChatContext } from "../../components/ChatContextProvider";
import { useToast } from "../../components/ToastProvider";

interface IntegrationEnvRequirement {
  key: string;
  configured: boolean;
}

interface IntegrationStatusRow {
  source: string;
  displayName: string;
  category: string;
  accessMethod: string;
  authType: string;
  cadence: string;
  requiredEnv: IntegrationEnvRequirement[];
  configured: boolean;
  requiresPaidDataConfirmation?: boolean;
  estimatedCreditCost?: number | null;
  confirmationMessage?: string | null;
  status: string;
  message: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  freshness?: string;
  coverage?: number;
  lastSuccessfulRun?: string | null;
  blockedReason?: string | null;
  operatorSummary?: {
    freshness?: string;
    coverage?: number;
    lastSuccessfulRun?: string | null;
    blockedReason?: string | null;
  };
  actionability?: {
    totalDeals: number;
    distressEvidencePct: number;
    nextEventPct: number;
    contactablePct: number;
  };
  lastRun?: {
    id: string;
    status: string;
    startedAt: string;
    endedAt?: string | null;
  } | null;
}

interface IntegrationRun {
  id: string;
  source: string;
  status: string;
  message?: string | null;
  metrics?: Record<string, unknown> | null;
  startedAt: string;
  endedAt?: string | null;
  runType?: "CONNECTIVITY_CHECK" | "SAMPLE_SYNC" | "FULL_SYNC" | "BULK_INGEST" | "UNKNOWN";
  severity?: "LOW" | "MEDIUM" | "HIGH";
  tableMessage?: string;
  businessImpact?: {
    createdDeals: number;
    updatedDeals: number;
    createdOwners: number;
    linkedOwners: number;
    sampledRecords: number;
  };
  anomalies?: Array<{
    type: "OWNER_LINK_GAP" | "NO_NEW_DEALS" | "LOW_VOLUME" | "AUTH_RISK" | "DATA_SCHEMA_CHANGE" | "OTHER";
    detail: string;
    recommendedFix: string;
  }>;
  nextActions?: Array<{
    priority: number;
    action: string;
    who: "SYSTEM" | "OPS" | "USER";
    why: string;
  }>;
  shouldAlert?: boolean;
  alertReason?: string;
}

interface SyncResult {
  status: string;
  message: string;
  runId: string;
  metrics?: Record<string, unknown>;
}

type SortDir = "asc" | "desc";
type RunsSortBy = "startedAt" | "endedAt" | "status" | "source";

function metricValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function IntegrationsClient() {
  const authReady = useRequireAuth();
  const { publishState } = useChatContext();
  const { notify } = useToast();
  const [items, setItems] = useState<IntegrationStatusRow[]>([]);
  const [runs, setRuns] = useState<IntegrationRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const [sourceFilter, setSourceFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [configuredFilter, setConfiguredFilter] = useState("");
  const [runtimeStatusFilter, setRuntimeStatusFilter] = useState("");
  const [freshnessFilter, setFreshnessFilter] = useState("");
  const [blockedFilter, setBlockedFilter] = useState("");

  const [runSourceFilter, setRunSourceFilter] = useState("");
  const [runStatusFilter, setRunStatusFilter] = useState("");
  const [runMessageFilter, setRunMessageFilter] = useState("");
  const [runDateFrom, setRunDateFrom] = useState("");
  const [runDateTo, setRunDateTo] = useState("");
  const [runsSortBy, setRunsSortBy] = useState<RunsSortBy>("startedAt");
  const [runsSortDir, setRunsSortDir] = useState<SortDir>("desc");

  const statusOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.status))).sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.category))).sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const sourceOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.source))).sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const runStatusOptions = useMemo(
    () => Array.from(new Set(runs.map((run) => run.status))).sort((a, b) => a.localeCompare(b)),
    [runs]
  );
  const runSourceOptions = useMemo(
    () => Array.from(new Set(runs.map((run) => run.source))).sort((a, b) => a.localeCompare(b)),
    [runs]
  );
  const actionability = items[0]?.actionability;

  const buildStatusQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (sourceFilter.trim()) params.set("source", sourceFilter.trim());
    if (categoryFilter.trim()) params.set("category", categoryFilter.trim());
    if (configuredFilter) params.set("configured", configuredFilter);
    if (runtimeStatusFilter.trim()) params.set("status", runtimeStatusFilter.trim());
    if (freshnessFilter.trim()) params.set("freshness", freshnessFilter.trim());
    if (blockedFilter) params.set("blocked", blockedFilter);
    return params.toString();
  }, [sourceFilter, categoryFilter, configuredFilter, runtimeStatusFilter, freshnessFilter, blockedFilter]);

  const buildRunsQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (runSourceFilter.trim()) params.set("source", runSourceFilter.trim());
    if (runStatusFilter.trim()) params.set("status", runStatusFilter.trim());
    if (runMessageFilter.trim()) params.set("message", runMessageFilter.trim());
    if (runDateFrom) params.set("dateFrom", runDateFrom);
    if (runDateTo) params.set("dateTo", runDateTo);
    params.set("limit", "50");
    params.set("sortBy", runsSortBy);
    params.set("sortDir", runsSortDir);
    params.set("operatorView", "true");
    return params.toString();
  }, [runSourceFilter, runStatusFilter, runMessageFilter, runDateFrom, runDateTo, runsSortBy, runsSortDir]);

  const load = useCallback(async () => {
    const [statusRows, runRows] = await Promise.all([
      apiFetch<IntegrationStatusRow[]>(`/integrations/status${buildStatusQuery() ? `?${buildStatusQuery()}` : ""}`),
      apiFetch<IntegrationRun[]>(`/integrations/runs${buildRunsQuery() ? `?${buildRunsQuery()}` : ""}`),
    ]);
    setItems(statusRows);
    setRuns(runRows);
    setError(null);
  }, [buildStatusQuery, buildRunsQuery]);

  async function runSync(item: IntegrationStatusRow) {
    const source = item.source;
    if (item.requiresPaidDataConfirmation) {
      const credits = item.estimatedCreditCost ?? 50;
      const promptMessage =
        item.confirmationMessage ||
        `This action may consume paid data credits (${credits} estimated). Continue?`;
      const approved = window.confirm(promptMessage);
      if (!approved) {
        setSyncResult(`${source}: canceled by user`);
        notify(`${source}: canceled by user`, "info");
        return;
      }
    }

    setLoading(true);
    setSyncResult(null);

    try {
      const data = await apiFetch<SyncResult>(`/integrations/${source}/sync`, {
        method: "POST",
        body: JSON.stringify({
          confirmPaidDataUse: item.requiresPaidDataConfirmation ? true : undefined,
        }),
      });
      const metricsNote = data.metrics ? ` | metrics: ${JSON.stringify(data.metrics)}` : "";
      setSyncResult(`${source}: ${data.status} - ${data.message} | runId: ${data.runId}${metricsNote}`);
      notify(`${source}: ${data.status}`, data.status === "OK" ? "success" : "info");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "sync failed";
      setSyncResult(`${source}: ${message}`);
      notify(`${source}: ${message}`, "error");
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load integrations"));
  }

  function resetFilters() {
    setSourceFilter("");
    setCategoryFilter("");
    setConfiguredFilter("");
    setRuntimeStatusFilter("");
    setFreshnessFilter("");
    setBlockedFilter("");
    setRunSourceFilter("");
    setRunStatusFilter("");
    setRunMessageFilter("");
    setRunDateFrom("");
    setRunDateTo("");
    setRunsSortBy("startedAt");
    setRunsSortDir("desc");

    setLoading(true);
    Promise.all([
      apiFetch<IntegrationStatusRow[]>("/integrations/status"),
      apiFetch<IntegrationRun[]>("/integrations/runs?limit=50&sortBy=startedAt&sortDir=desc"),
    ])
      .then(([statusRows, runRows]) => {
        setItems(statusRows);
        setRuns(runRows);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to reset integration filters"))
      .finally(() => setLoading(false));
  }

  function toggleRunsSort(column: RunsSortBy) {
    if (runsSortBy === column) {
      setRunsSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setRunsSortBy(column);
    setRunsSortDir(column === "status" || column === "source" ? "asc" : "desc");
  }

  async function createAlertFromRun(run: IntegrationRun) {
    setLoading(true);
    try {
      await apiFetch("/alerts/rules", {
        method: "POST",
        body: JSON.stringify({
          triggerType: "INTEGRATION_RUN_ALERT",
          active: true,
          delivery: "IN_APP",
          config: {
            source: run.source,
            runType: run.runType ?? "UNKNOWN",
            severity: run.severity ?? "LOW",
          },
        }),
      });
      notify(`Alert rule created for ${run.source}`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to create alert", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady) return;

    load().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    });
  }, [authReady, load]);

  useEffect(() => {
    publishState({
      route: "/settings/integrations",
      activeFiltersCount: [
        sourceFilter,
        categoryFilter,
        configuredFilter,
        runtimeStatusFilter,
        freshnessFilter,
        blockedFilter,
        runSourceFilter,
        runStatusFilter,
        runMessageFilter,
        runDateFrom,
        runDateTo,
      ].filter((value) => String(value || "").trim()).length,
      activeFilters: {
        sourceFilter,
        categoryFilter,
        configuredFilter,
        runtimeStatusFilter,
        freshnessFilter,
        blockedFilter,
        runSourceFilter,
        runStatusFilter,
        runMessageFilter,
        runDateFrom,
        runDateTo,
      },
      integrationsSnapshot: items.map((item) => ({
        source: item.source,
        status: item.status,
        freshness: item.freshness,
        coveragePct: item.coverage,
        message: item.message,
        lastSyncAt: item.lastSyncAt ?? null,
      })),
      recentRuns: runs.slice(0, 25).map((run) => ({
        id: run.id,
        source: run.source,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt ?? null,
        runType: run.runType,
        severity: run.severity,
        metrics: run.metrics ?? {},
      })),
    });
  }, [
    blockedFilter,
    categoryFilter,
    configuredFilter,
    freshnessFilter,
    items,
    publishState,
    runDateFrom,
    runDateTo,
    runMessageFilter,
    runSourceFilter,
    runStatusFilter,
    runs,
    runtimeStatusFilter,
    sourceFilter,
  ]);

  if (!authReady) {
    return <div className="card"><p>Checking session...</p></div>;
  }

  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-subtitle">Monitor ingestion health and trigger new syncs when data is fresh.</p>
        </div>
        <div className="actions-row">
          <button className="button-secondary" disabled={loading} onClick={applyFilters}>
            Apply Filters
          </button>
          <button className="button-outline" disabled={loading} onClick={resetFilters}>
            Reset
          </button>
          <button className="button-outline" disabled={loading} onClick={() => load().catch(() => setError("Failed to load integrations"))}>
            Refresh
          </button>
        </div>
      </div>

      {error && <TableEmptyState message={error} actionLabel="Reload" onAction={applyFilters} />}
      {syncResult && <div className="empty-state">{syncResult}</div>}
      {actionability ? (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Deals in Portfolio</div>
            <div className="stat-value">{actionability.totalDeals}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Distress Evidence</div>
            <div className="stat-value">{actionability.distressEvidencePct}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Next Event Date</div>
            <div className="stat-value">{actionability.nextEventPct}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Contactable (&gt;=50)</div>
            <div className="stat-value">{actionability.contactablePct}%</div>
          </div>
        </div>
      ) : null}

      <DataTableShell title="Integration Status" summary={`Showing ${items.length} integrations`}>
        <table className="table" style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Integration</th>
              <th>Domain</th>
              <th>Access/Auth</th>
              <th>Configuration</th>
              <th>Runtime Status</th>
              <th title="Freshness of last successful sync">Freshness</th>
              <th title="Percentage of required env configured">Coverage (%)</th>
              <th>Last Message</th>
              <th>Last Sync</th>
              <th>Actions</th>
            </tr>
            <TableFilterRow>
              <th>
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Filter by integration source">
                  <option value="">All sources</option>
                  {sourceOptions.map((source) => (
                    <option key={`source-${source}`} value={source}>{source}</option>
                  ))}
                </select>
              </th>
              <th>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by integration category">
                  <option value="">All domains</option>
                  {categoryOptions.map((category) => (
                    <option key={`cat-${category}`} value={category}>{category}</option>
                  ))}
                </select>
              </th>
              <th />
              <th>
                <select value={configuredFilter} onChange={(event) => setConfiguredFilter(event.target.value)} aria-label="Filter by configuration">
                  <option value="">All</option>
                  <option value="true">Configured</option>
                  <option value="false">Missing config</option>
                </select>
              </th>
              <th>
                <select value={runtimeStatusFilter} onChange={(event) => setRuntimeStatusFilter(event.target.value)} aria-label="Filter by runtime status">
                  <option value="">All statuses</option>
                  {statusOptions.map((status) => (
                    <option key={`status-${status}`} value={status}>{status}</option>
                  ))}
                </select>
              </th>
              <th>
                <select value={freshnessFilter} onChange={(event) => setFreshnessFilter(event.target.value)} aria-label="Filter by freshness">
                  <option value="">All</option>
                  <option value="fresh">Fresh</option>
                  <option value="stale">Stale</option>
                  <option value="unknown">Unknown</option>
                </select>
              </th>
              <th />
              <th>
                <select value={blockedFilter} onChange={(event) => setBlockedFilter(event.target.value)} aria-label="Filter by blocked status">
                  <option value="">All</option>
                  <option value="true">Blocked</option>
                  <option value="false">Not blocked</option>
                </select>
              </th>
              <th />
              <th />
            </TableFilterRow>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.source}>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.displayName}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{item.source}</div>
                </td>
                <td>{item.category || "Unavailable"}</td>
                <td>
                  <div>{item.accessMethod || "Unavailable"}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{item.authType || "Unavailable"}</div>
                </td>
                <td>
                  <div>{item.configured ? "Configured" : "Missing env"}</div>
                  {item.requiresPaidDataConfirmation && (
                    <div style={{ fontSize: 12, color: "#92400e" }}>
                      Confirm required ({item.estimatedCreditCost ?? 50} credits est.)
                    </div>
                  )}
                  {!item.configured && (
                    <div style={{ fontSize: 12, color: "#b45309" }}>
                      {item.requiredEnv
                        .filter((entry) => !entry.configured)
                        .map((entry) => entry.key)
                        .join(", ")}
                    </div>
                  )}
                </td>
                <td>{item.status || "Unavailable"}</td>
                <td>{item.operatorSummary?.freshness || item.freshness || "Unavailable"}</td>
                <td>{typeof (item.operatorSummary?.coverage ?? item.coverage) === "number" ? `${(item.operatorSummary?.coverage ?? item.coverage)?.toFixed(1)}%` : "Unavailable"}</td>
                <td>{item.lastError || item.message || "Unavailable"}</td>
                <td>{item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString() : "Unavailable"}</td>
                <td>
                  <button className="button-ghost" disabled={loading || !item.configured} onClick={() => runSync(item)}>
                    Sync
                  </button>
                  {item.operatorSummary?.blockedReason && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{item.operatorSummary.blockedReason}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableShell>

      <DataTableShell title="Recent Runs" summary={`Showing ${runs.length} runs`}>
        <table className="table">
          <thead>
            <tr>
              <th>Run ID</th>
              <th><ColumnHeaderSort label="Source" column="source" sortBy={runsSortBy} sortDir={runsSortDir} onToggle={() => toggleRunsSort("source")} /></th>
              <th><ColumnHeaderSort label="Status" column="status" sortBy={runsSortBy} sortDir={runsSortDir} onToggle={() => toggleRunsSort("status")} /></th>
              <th>Run Type</th>
              <th>Severity</th>
              <th><ColumnHeaderSort label="Started" column="startedAt" sortBy={runsSortBy} sortDir={runsSortDir} onToggle={() => toggleRunsSort("startedAt")} /></th>
              <th><ColumnHeaderSort label="Ended" column="endedAt" sortBy={runsSortBy} sortDir={runsSortDir} onToggle={() => toggleRunsSort("endedAt")} /></th>
              <th>Operational Message</th>
              <th>Business Impact</th>
              <th>Risk / Anomaly</th>
              <th>Next Action</th>
              <th>Metrics</th>
            </tr>
            <TableFilterRow>
              <th />
              <th>
                <select value={runSourceFilter} onChange={(event) => setRunSourceFilter(event.target.value)} aria-label="Filter run source">
                  <option value="">All sources</option>
                  {runSourceOptions.map((source) => (
                    <option key={`run-source-${source}`} value={source}>{source}</option>
                  ))}
                </select>
              </th>
              <th>
                <select value={runStatusFilter} onChange={(event) => setRunStatusFilter(event.target.value)} aria-label="Filter run status">
                  <option value="">All statuses</option>
                  {runStatusOptions.map((status) => (
                    <option key={`run-status-${status}`} value={status}>{status}</option>
                  ))}
                </select>
              </th>
              <th />
              <th />
              <th>
                <input type="date" value={runDateFrom} onChange={(event) => setRunDateFrom(event.target.value)} aria-label="Run date from" />
              </th>
              <th>
                <input type="date" value={runDateTo} onChange={(event) => setRunDateTo(event.target.value)} aria-label="Run date to" />
              </th>
              <th>
                <input value={runMessageFilter} onChange={(event) => setRunMessageFilter(event.target.value)} placeholder="Message contains" aria-label="Filter run message" />
              </th>
              <th />
              <th />
              <th />
              <th />
              <th />
            </TableFilterRow>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.id}</td>
                <td>{run.source}</td>
                <td>{run.status}</td>
                <td>{run.runType || "UNKNOWN"}</td>
                <td>{run.severity || "LOW"}</td>
                <td>{new Date(run.startedAt).toLocaleString()}</td>
                <td>{run.endedAt ? new Date(run.endedAt).toLocaleString() : "Unavailable"}</td>
                <td>{run.tableMessage || run.message || "Unavailable"}</td>
                <td>
                  {run.businessImpact ? (
                    <div style={{ display: "grid", gap: 2, fontSize: 12 }}>
                      <div>+{run.businessImpact.createdDeals} new</div>
                      <div>{run.businessImpact.updatedDeals} updated</div>
                      <div>owners {run.businessImpact.linkedOwners}/{run.businessImpact.updatedDeals}</div>
                    </div>
                  ) : (
                    "Unavailable"
                  )}
                </td>
                <td>
                  {run.anomalies?.length ? (
                    <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                      {run.anomalies.slice(0, 2).map((item) => (
                        <div key={`${run.id}-${item.type}`}>
                          <strong>{item.type}:</strong> {item.detail}
                        </div>
                      ))}
                      <button className="button-ghost" disabled={loading} onClick={() => createAlertFromRun(run)}>
                        Create alert from anomaly
                      </button>
                    </div>
                  ) : (
                    "None"
                  )}
                </td>
                <td>
                  {run.nextActions?.length ? (
                    <div style={{ display: "grid", gap: 2, fontSize: 12 }}>
                      {run.nextActions.slice(0, 2).map((item) => (
                        <div key={`${run.id}-action-${item.priority}`}>
                          {item.priority}. {item.action}
                        </div>
                      ))}
                    </div>
                  ) : (
                    "Monitor"
                  )}
                </td>
                <td>
                  {run.metrics ? (
                    <div style={{ display: "grid", gap: 2 }}>
                      {Object.entries(run.metrics).map(([key, value]) => (
                        <div key={`${run.id}-metric-${key}`} style={{ fontSize: 12 }}>
                          <strong>{key}:</strong> {metricValue(value)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    "Unavailable"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableShell>

      {!items.length ? <TableEmptyState message="No integrations match current filters." actionLabel="Reset" onAction={resetFilters} /> : null}
      {!runs.length ? <TableEmptyState message="No runs match current filters." actionLabel="Reset" onAction={resetFilters} /> : null}
    </div>
  );
}
