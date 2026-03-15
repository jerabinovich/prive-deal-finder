"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiFetchBlob } from "../../lib/api";
import { useRequireAuth } from "../../lib/use-require-auth";
import { useChatContext } from "../components/ChatContextProvider";
import ColumnHeaderSort from "../components/ColumnHeaderSort";
import DataTableShell from "../components/DataTableShell";
import TableEmptyState from "../components/TableEmptyState";
import TableFilterRow from "../components/TableFilterRow";
import { useToast } from "../components/ToastProvider";

interface PipelineRow {
  status: string;
  count: number;
  avgScore: number;
}

type PipelineSortBy = "status" | "count" | "avgScore";
type SortDir = "asc" | "desc";

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReportsClient() {
  const authReady = useRequireAuth();
  const { publishState } = useChatContext();
  const { notify } = useToast();
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [minCount, setMinCount] = useState("");
  const [sortBy, setSortBy] = useState<PipelineSortBy>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const avgScore = rows.length
    ? rows.reduce((sum, row) => sum + row.avgScore, 0) / rows.length
    : 0;
  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.status))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter.trim()) params.set("status", statusFilter.trim());
    if (minCount.trim()) params.set("minCount", minCount.trim());
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    return params.toString();
  }, [statusFilter, minCount, sortBy, sortDir]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery();
      const data = await apiFetch<PipelineRow[]>(`/reports/pipeline${query ? `?${query}` : ""}`);
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    if (!authReady) return;
    load().catch(() => undefined);
  }, [authReady, load]);

  useEffect(() => {
    publishState({
      route: "/reports",
      selectedDealId: null,
      selectedDealKey: null,
      activeFiltersCount: [statusFilter, minCount].filter((value) => value.trim().length > 0).length,
      activeFilters: { statusFilter, minCount, sortBy, sortDir },
      pipelineVisibleRange: rows.length ? `1-${rows.length}` : "0-0",
      pipelineVisibleRows: rows.slice(0, 25).map((row) => ({
        dealKey: row.status,
        name: row.status,
        market: "portfolio",
        pipelineScore: row.avgScore,
        classification: "PIPELINE",
        status: row.status,
      })),
    });
  }, [minCount, publishState, rows, sortBy, sortDir, statusFilter]);

  async function downloadCsv() {
    try {
      const query = buildQuery();
      const blob = await apiFetchBlob(`/reports/pipeline.csv${query ? `?${query}` : ""}`);
      triggerDownload(blob, "pipeline-report.csv");
      notify("CSV report downloaded", "success");
    } catch (_error) {
      setError("Failed to download CSV report");
      notify("Failed to download CSV report", "error");
    }
  }

  async function downloadPdf() {
    try {
      const query = buildQuery();
      const blob = await apiFetchBlob(`/reports/pipeline.pdf${query ? `?${query}` : ""}`);
      triggerDownload(blob, "pipeline-report.pdf");
      notify("PDF report downloaded", "success");
    } catch (_error) {
      setError("Failed to download PDF report");
      notify("Failed to download PDF report", "error");
    }
  }

  function toggleSort(column: PipelineSortBy) {
    if (sortBy === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDir(column === "status" ? "asc" : "desc");
  }

  function resetFilters() {
    setStatusFilter("");
    setMinCount("");
    setSortBy("count");
    setSortDir("desc");
    setLoading(true);
    apiFetch<PipelineRow[]>("/reports/pipeline?sortBy=count&sortDir=desc")
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to reset report filters"))
      .finally(() => setLoading(false));
  }

  if (!authReady) {
    return <div className="card"><p>Checking session...</p></div>;
  }

  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pipeline Report</h1>
          <p className="page-subtitle">Review pipeline health and download exports for stakeholders.</p>
        </div>
        <div className="actions-row">
          <button className="button-secondary" onClick={() => load().catch(() => undefined)} disabled={loading}>Apply Filters</button>
          <button className="button-outline" onClick={resetFilters} disabled={loading}>Reset</button>
          <button className="button-outline" onClick={downloadCsv}>Download CSV</button>
          <button className="button-secondary" onClick={downloadPdf}>Download PDF</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total In Pipeline</div>
          <div className="stat-value">{totalCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Score</div>
          <div className="stat-value">{avgScore.toFixed(1)}</div>
        </div>
      </div>

      {error && <TableEmptyState message={error} actionLabel="Reload" onAction={() => load().catch(() => undefined)} />}

      <DataTableShell title="Pipeline Breakdown" summary={`Showing ${rows.length} rows`}>
        <table className="table">
          <thead>
            <tr>
              <th><ColumnHeaderSort label="Pipeline Stage" column="status" sortBy={sortBy} sortDir={sortDir} onToggle={() => toggleSort("status")} /></th>
              <th><ColumnHeaderSort label="Deal Count" column="count" sortBy={sortBy} sortDir={sortDir} onToggle={() => toggleSort("count")} /></th>
              <th><ColumnHeaderSort label="Average Pipeline Score" column="avgScore" sortBy={sortBy} sortDir={sortDir} onToggle={() => toggleSort("avgScore")} title="Average score per stage" /></th>
            </tr>
            <TableFilterRow>
              <th>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter pipeline stage">
                  <option value="">All stages</option>
                  {statusOptions.map((status) => (
                    <option key={`status-${status}`} value={status}>{status}</option>
                  ))}
                </select>
              </th>
              <th>
                <input value={minCount} onChange={(event) => setMinCount(event.target.value)} placeholder="Min count" aria-label="Minimum deal count" />
              </th>
              <th />
            </TableFilterRow>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.status}>
                <td>{row.status || "Unavailable"}</td>
                <td>{row.count}</td>
                <td>{row.avgScore.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableShell>

      {!error && !loading && rows.length === 0 ? (
        <TableEmptyState message="No pipeline rows match current filters." actionLabel="Reset filters" onAction={resetFilters} />
      ) : null}
    </div>
  );
}
