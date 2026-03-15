"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import ColumnHeaderSort from "../components/ColumnHeaderSort";
import { useChatContext } from "../components/ChatContextProvider";
import DataTableShell from "../components/DataTableShell";
import TableEmptyState from "../components/TableEmptyState";
import { useRequireAuth } from "../../lib/use-require-auth";
import { useToast } from "../components/ToastProvider";

interface Deal {
  id: string;
  name: string;
  address?: string;
  market?: string;
  assetType?: string;
  propertyUseCode?: string;
  score?: number;
  pipelineScore?: number;
  classification?: "PIPELINE_LISTING" | "WATCHLIST" | "TRUE_OPPORTUNITY" | "DISTRESS_CANDIDATE";
  lane?:
    | "DISTRESS_OWNER"
    | "AUCTION_MONITOR"
    | "GOV_LAND_P3"
    | "OFF_MARKET_STANDARD"
    | "NON_ACQUIRABLE_NOISE"
    | "RESEARCH_REQUIRED";
  recommendedAction?: "CONTACT_NOW" | "MONITOR" | "AUCTION_PREP" | "GOV_PURSUE" | "RESEARCH" | "ARCHIVE";
  distressStage?:
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
  nextEventDate?: string | null;
  contactabilityScore?: number | null;
  isNoise?: boolean;
  noiseReason?: string | null;
  ownerType?: "PRIVATE" | "GOV" | "HOA" | "UTILITY" | "UNKNOWN";
  status: string;
}

interface DealsResponse {
  items: Deal[];
  total: number;
  limit: number;
  offset: number;
}

type DealSortBy =
  | "name"
  | "market"
  | "assetType"
  | "propertyUseCode"
  | "score"
  | "classification"
  | "lane"
  | "recommendedAction"
  | "distressStage"
  | "nextEventDate"
  | "contactabilityScore"
  | "status"
  | "updatedAt";
type SortDir = "asc" | "desc";

interface FacetOption {
  value: string;
  count: number;
}

interface DealsFacetsResponse {
  assetTypes: FacetOption[];
  propertyUseCodes: FacetOption[];
  markets: FacetOption[];
  statuses: FacetOption[];
}

const PAGE_SIZE = 25;
const SUPPRESSED_CATEGORY_PATTERNS = [/VACANT GOVERNMENTAL/i, /VACANT LAND - GOVERNMENTAL/i];

function isSuppressedCategory(value?: string) {
  if (!value) return false;
  return SUPPRESSED_CATEGORY_PATTERNS.some((pattern) => pattern.test(value));
}

export default function DealsClient() {
  const authReady = useRequireAuth();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { publishState } = useChatContext();
  const { notify } = useToast();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [market, setMarket] = useState("");
  const [classification, setClassification] = useState("");
  const [lane, setLane] = useState("");
  const [recommendedAction, setRecommendedAction] = useState("");
  const [distressStage, setDistressStage] = useState("");
  const [assetType, setAssetType] = useState("");
  const [propertyUseCode, setPropertyUseCode] = useState("");
  const [ownerType, setOwnerType] = useState("");
  const [noiseMode, setNoiseMode] = useState<"hide" | "all" | "only">("hide");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [sortBy, setSortBy] = useState<DealSortBy>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [facets, setFacets] = useState<DealsFacetsResponse>({
    assetTypes: [],
    propertyUseCodes: [],
    markets: [],
    statuses: [],
  });

  const page = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset]);
  const activeFilters = useMemo(
    () =>
      [
        q,
        status,
        market,
        classification,
        lane,
        recommendedAction,
        distressStage,
        assetType,
        propertyUseCode,
        ownerType,
        minScore,
        maxScore,
      ].filter((value) => value.trim()).length + (noiseMode !== "all" ? 1 : 0),
    [q, status, market, classification, lane, recommendedAction, distressStage, assetType, propertyUseCode, ownerType, minScore, maxScore, noiseMode],
  );

  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(total, offset + PAGE_SIZE);
  const selectedCount = selectedDealIds.length;
  const visibleCounts = useMemo(() => {
    const result = {
      contactNow: 0,
      auctionPrep: 0,
      monitor: 0,
      govPursue: 0,
      archive: 0,
    };
    for (const deal of deals) {
      if (deal.recommendedAction === "CONTACT_NOW") result.contactNow += 1;
      if (deal.recommendedAction === "AUCTION_PREP") result.auctionPrep += 1;
      if (deal.recommendedAction === "MONITOR") result.monitor += 1;
      if (deal.recommendedAction === "GOV_PURSUE") result.govPursue += 1;
      if (deal.recommendedAction === "ARCHIVE") result.archive += 1;
    }
    return result;
  }, [deals]);
  const stageOptions = useMemo(() => {
    const defaults = ["NEW", "DD", "NEGOTIATION", "MONITOR", "ARCHIVE"];
    const statusValues = facets.statuses.map((row) => row.value);
    const dealValues = deals.map((deal) => deal.status);
    return Array.from(new Set([...defaults, ...statusValues, ...dealValues])).filter(Boolean);
  }, [deals, facets.statuses]);
  const allVisibleSelected = deals.length > 0 && selectedDealIds.length === deals.length;

  const buildQueryParams = useCallback(
    (nextOffset: number) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status.trim()) params.set("status", status.trim());
      if (market.trim()) params.set("market", market.trim());
      if (classification.trim()) params.set("classification", classification.trim());
      if (lane.trim()) params.set("lane", lane.trim());
      if (recommendedAction.trim()) params.set("recommendedAction", recommendedAction.trim());
      if (distressStage.trim()) params.set("distressStage", distressStage.trim());
      if (assetType.trim()) params.set("assetType", assetType.trim());
      if (propertyUseCode.trim()) params.set("propertyUseCode", propertyUseCode.trim());
      if (ownerType.trim()) params.set("ownerType", ownerType.trim());
      if (noiseMode === "hide") params.set("isNoise", "false");
      if (noiseMode === "only") params.set("isNoise", "true");
      params.set("noiseMode", noiseMode);
      if (minScore.trim()) params.set("minScore", minScore.trim());
      if (maxScore.trim()) params.set("maxScore", maxScore.trim());
      if (sortBy) params.set("sortBy", sortBy);
      if (sortDir) params.set("sortDir", sortDir);
      if (nextOffset > 0) params.set("offset", String(nextOffset));
      return params;
    },
    [q, status, market, classification, lane, recommendedAction, distressStage, assetType, propertyUseCode, ownerType, noiseMode, minScore, maxScore, sortBy, sortDir]
  );

  useEffect(() => {
    const nextQ = searchParams.get("q") ?? "";
    const nextStatus = searchParams.get("status") ?? "";
    const nextMarket = searchParams.get("market") ?? "";
    const nextClassification = searchParams.get("classification") ?? "";
    const nextLane = searchParams.get("lane") ?? "";
    const nextRecommendedAction = searchParams.get("recommendedAction") ?? "";
    const nextDistressStage = searchParams.get("distressStage") ?? "";
    const nextAssetTypeRaw = searchParams.get("assetType") ?? "";
    const nextPropertyUseCodeRaw = searchParams.get("propertyUseCode") ?? "";
    const nextAssetType = isSuppressedCategory(nextAssetTypeRaw) ? "" : nextAssetTypeRaw;
    const nextPropertyUseCode = isSuppressedCategory(nextPropertyUseCodeRaw) ? "" : nextPropertyUseCodeRaw;
    const nextOwnerType = searchParams.get("ownerType") ?? "";
    const nextIsNoise = searchParams.get("isNoise");
    const nextNoiseMode = searchParams.get("noiseMode");
    const nextMinScore = searchParams.get("minScore") ?? "";
    const nextMaxScore = searchParams.get("maxScore") ?? "";
    const nextSortBy = (searchParams.get("sortBy") as DealSortBy | null) ?? "updatedAt";
    const nextSortDir = (searchParams.get("sortDir") as SortDir | null) ?? "desc";
    const nextOffset = Number(searchParams.get("offset") ?? "0");

    setQ(nextQ);
    setStatus(nextStatus);
    setMarket(nextMarket);
    setClassification(nextClassification);
    setLane(nextLane);
    setRecommendedAction(nextRecommendedAction);
    setDistressStage(nextDistressStage);
    setAssetType(nextAssetType);
    setPropertyUseCode(nextPropertyUseCode);
    setOwnerType(nextOwnerType);
    setNoiseMode(
      nextNoiseMode === "only" || nextNoiseMode === "all" || nextNoiseMode === "hide"
        ? nextNoiseMode
        : nextIsNoise === "true"
          ? "only"
          : "hide"
    );
    setMinScore(nextMinScore);
    setMaxScore(nextMaxScore);
    setSortBy(nextSortBy);
    setSortDir(nextSortDir === "asc" ? "asc" : "desc");
    setOffset(Number.isFinite(nextOffset) && nextOffset >= 0 ? nextOffset : 0);
  }, [searchParams]);

  const loadFacets = useCallback(async () => {
    if (!authReady) return;
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status.trim()) params.set("status", status.trim());
      if (market.trim()) params.set("market", market.trim());
      if (classification.trim()) params.set("classification", classification.trim());
      if (lane.trim()) params.set("lane", lane.trim());
      if (recommendedAction.trim()) params.set("recommendedAction", recommendedAction.trim());
      if (distressStage.trim()) params.set("distressStage", distressStage.trim());
      if (assetType.trim()) params.set("assetType", assetType.trim());
      if (propertyUseCode.trim()) params.set("propertyUseCode", propertyUseCode.trim());
      if (ownerType.trim()) params.set("ownerType", ownerType.trim());
      if (noiseMode === "hide") params.set("isNoise", "false");
      if (noiseMode === "only") params.set("isNoise", "true");
      if (minScore.trim()) params.set("minScore", minScore.trim());
      if (maxScore.trim()) params.set("maxScore", maxScore.trim());
      if (sortBy) params.set("sortBy", sortBy);
      if (sortDir) params.set("sortDir", sortDir);
      const query = params.toString() ? `?${params.toString()}` : "";
      const data = await apiFetch<DealsFacetsResponse>(`/deals/facets${query}`);
      setFacets({
        ...data,
        assetTypes: data.assetTypes.filter((item) => !isSuppressedCategory(item.value)),
        propertyUseCodes: data.propertyUseCodes.filter((item) => !isSuppressedCategory(item.value)),
      });
    } catch (_err) {
      // Keep UX resilient; facets are optional for filtering.
    }
  }, [authReady, q, status, market, classification, lane, recommendedAction, distressStage, assetType, propertyUseCode, ownerType, noiseMode, minScore, maxScore, sortBy, sortDir]);

  useEffect(() => {
    loadFacets().catch(() => undefined);
  }, [loadFacets]);

  function classificationBadge(value?: string) {
    if (value === "TRUE_OPPORTUNITY") return "badge badge-success";
    if (value === "WATCHLIST") return "badge badge-warning";
    if (value === "DISTRESS_CANDIDATE") return "badge badge-danger";
    return "badge badge-muted";
  }

  function classificationLabel(value?: string) {
    if (!value) return "PIPELINE LISTING";
    return value.replaceAll("_", " ");
  }

  function laneLabel(value?: string) {
    if (!value) return "RESEARCH REQUIRED";
    return value.replaceAll("_", " ");
  }

  function actionLabel(value?: string) {
    if (!value) return "MONITOR";
    return value.replaceAll("_", " ");
  }

  function scoreBand(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) return "muted";
    if (value >= 80) return "success";
    if (value >= 60) return "warning";
    return "danger";
  }

  function scoreWidth(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  function applyLanePreset(nextLane: string, nextAction = "", nextClassification = "") {
    setLane(nextLane);
    setRecommendedAction(nextAction);
    setClassification(nextClassification);
    setOffset(0);
    const params = new URLSearchParams();
    if (nextLane) params.set("lane", nextLane);
    if (nextAction) params.set("recommendedAction", nextAction);
    if (nextClassification) params.set("classification", nextClassification);
    params.set("isNoise", "false");
    router.replace(`/deals?${params.toString()}`);
  }

  function toggleSelectDeal(dealId: string, checked: boolean) {
    setSelectedDealIds((prev) => {
      if (checked) return prev.includes(dealId) ? prev : [...prev, dealId];
      return prev.filter((id) => id !== dealId);
    });
  }

  function toggleSelectAllVisible(checked: boolean) {
    if (!checked) {
      setSelectedDealIds([]);
      return;
    }
    setSelectedDealIds(deals.map((deal) => deal.id));
  }

  const loadDeals = useCallback(async () => {
    if (!authReady) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      if (q.trim()) params.set("q", q.trim());
      if (status.trim()) params.set("status", status.trim());
      if (market.trim()) params.set("market", market.trim());
      if (classification.trim()) params.set("classification", classification.trim());
      if (lane.trim()) params.set("lane", lane.trim());
      if (recommendedAction.trim()) params.set("recommendedAction", recommendedAction.trim());
      if (distressStage.trim()) params.set("distressStage", distressStage.trim());
      if (assetType.trim()) params.set("assetType", assetType.trim());
      if (propertyUseCode.trim()) params.set("propertyUseCode", propertyUseCode.trim());
      if (ownerType.trim()) params.set("ownerType", ownerType.trim());
      if (noiseMode === "hide") params.set("isNoise", "false");
      if (noiseMode === "only") params.set("isNoise", "true");
      if (minScore.trim()) params.set("minScore", minScore.trim());
      if (maxScore.trim()) params.set("maxScore", maxScore.trim());
      if (sortBy) params.set("sortBy", sortBy);
      if (sortDir) params.set("sortDir", sortDir);

      const data = await apiFetch<DealsResponse>(`/deals?${params.toString()}`);
      setDeals(data.items);
      setTotal(data.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load deals";
      setError(message);
      setDeals([]);
      setTotal(0);
      notify(message, "error");
    } finally {
      setLoading(false);
    }
  }, [authReady, offset, q, status, market, classification, lane, recommendedAction, distressStage, assetType, propertyUseCode, ownerType, noiseMode, minScore, maxScore, sortBy, sortDir, notify]);

  useEffect(() => {
    loadDeals().catch(() => undefined);
  }, [loadDeals]);

  useEffect(() => {
    setSelectedDealIds((prev) => prev.filter((id) => deals.some((deal) => deal.id === id)));
  }, [deals]);

  useEffect(() => {
    publishState({
      route: pathname || "/deals",
      selectedDealId: null,
      selectedDealKey: null,
      activeFiltersCount: activeFilters,
      activeFilters: {
        q,
        status,
        market,
        classification,
        lane,
        recommendedAction,
        distressStage,
        assetType,
        propertyUseCode,
        ownerType,
        minScore,
        maxScore,
        noiseMode,
        sortBy,
        sortDir,
      },
      pipelineVisibleRange: total === 0 ? "0-0" : `${showingFrom}-${showingTo}`,
      pipelineVisibleRows: deals.map((deal) => ({
        dealId: deal.id,
        dealKey: deal.id,
        name: deal.name,
        market: deal.market ?? undefined,
        assetType: deal.assetType ?? undefined,
        useCategory: deal.propertyUseCode ?? undefined,
        pipelineScore: deal.pipelineScore ?? deal.score ?? null,
        classification: deal.classification ?? undefined,
        status: deal.status,
      })),
    });
  }, [
    activeFilters,
    assetType,
    classification,
    deals,
    distressStage,
    lane,
    market,
    maxScore,
    minScore,
    noiseMode,
    ownerType,
    pathname,
    propertyUseCode,
    publishState,
    q,
    recommendedAction,
    showingFrom,
    showingTo,
    sortBy,
    sortDir,
    status,
    total,
  ]);

  async function patchStatus(dealId: string, nextStatus: string) {
    try {
      setError(null);
      await apiFetch(`/deals/${dealId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadDeals();
      notify(`Status updated to ${nextStatus}`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update deal status";
      setError(message);
      notify(message, "error");
    }
  }

  async function patchStatusBulk(nextStatus: string) {
    if (selectedDealIds.length === 0) return;
    const count = selectedDealIds.length;
    try {
      setError(null);
      await Promise.all(
        selectedDealIds.map((dealId) =>
          apiFetch(`/deals/${dealId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: nextStatus }),
          })
        )
      );
      setSelectedDealIds([]);
      await loadDeals();
      notify(`Updated ${count} deals to ${nextStatus}`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update selected deals";
      setError(message);
      notify(message, "error");
    }
  }

  function resetFilters() {
    setQ("");
    setStatus("");
    setMarket("");
    setClassification("");
    setLane("");
    setRecommendedAction("");
    setDistressStage("");
    setAssetType("");
    setPropertyUseCode("");
    setOwnerType("");
    setNoiseMode("hide");
    setMinScore("");
    setMaxScore("");
    setSortBy("updatedAt");
    setSortDir("desc");
    setOffset(0);
    router.replace("/deals");
  }

  function applyFilters() {
    const params = buildQueryParams(0);
    const query = params.toString();
    router.replace(query ? `/deals?${query}` : "/deals");
    setOffset(0);
    notify("Filters applied", "info");
  }

  function toggleSort(column: DealSortBy) {
    if (column === sortBy) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir(column === "score" || column === "contactabilityScore" || column === "nextEventDate" ? "desc" : "asc");
    }
  }

  if (!authReady) {
    return <div className="card"><p>Checking session...</p></div>;
  }

  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h1 className="page-title">Deals</h1>
          <p className="page-subtitle">Monitor pipeline performance, review assets, and update deal stages.</p>
        </div>
        <div className="actions-row">
          <button className="button-outline" onClick={() => loadDeals().catch(() => undefined)} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Deals</div>
          <div className="stat-value">{total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Showing</div>
          <div className="stat-value">{showingFrom}-{showingTo}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Filters</div>
          <div className="stat-value">{activeFilters}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Contact Now</div>
          <div className="stat-value">{visibleCounts.contactNow}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Monitor</div>
          <div className="stat-value">{visibleCounts.monitor}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Archive Queue</div>
          <div className="stat-value">{visibleCounts.archive}</div>
        </div>
      </div>

      <div className="deals-smart-views" role="group" aria-label="Smart views">
        <button
          className={`deals-view-pill ${lane === "DISTRESS_OWNER" ? "active" : ""}`}
          onClick={() => applyLanePreset("DISTRESS_OWNER", "CONTACT_NOW")}
        >
          Distress
        </button>
        <button
          className={`deals-view-pill ${lane === "AUCTION_MONITOR" ? "active" : ""}`}
          onClick={() => applyLanePreset("AUCTION_MONITOR", "AUCTION_PREP")}
        >
          Auctions
        </button>
        <button
          className={`deals-view-pill ${lane === "OFF_MARKET_STANDARD" ? "active" : ""}`}
          onClick={() => applyLanePreset("OFF_MARKET_STANDARD", "MONITOR")}
        >
          Off-market
        </button>
        <button
          className={`deals-view-pill ${lane === "GOV_LAND_P3" ? "active" : ""}`}
          onClick={() => applyLanePreset("GOV_LAND_P3", "GOV_PURSUE")}
        >
          Gov / P3
        </button>
        <button
          className={`deals-view-pill ${lane === "RESEARCH_REQUIRED" ? "active" : ""}`}
          onClick={() => applyLanePreset("RESEARCH_REQUIRED", "RESEARCH")}
        >
          Needs Research
        </button>
        <button
          className={`deals-view-pill ${noiseMode === "hide" ? "active" : ""}`}
          onClick={() => {
            setNoiseMode("hide");
            const params = buildQueryParams(0);
            params.set("isNoise", "false");
            params.set("noiseMode", "hide");
            const query = params.toString();
            router.replace(query ? `/deals?${query}` : "/deals");
          }}
        >
          Noise Hidden
        </button>
      </div>

      <section className="deals-filters-card">
        <div className="deals-filters-core">
          <label className="deals-filter-field">
            <span className="deals-filter-label">Name or address</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or address" aria-label="Filter by property name or address" />
          </label>
          <label className="deals-filter-field">
            <span className="deals-filter-label">Market</span>
            <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Filter by market">
              <option value="">All markets</option>
              {facets.markets.map((row) => (
                <option key={`market-${row.value}`} value={row.value}>
                  {row.value} ({row.count})
                </option>
              ))}
            </select>
          </label>
          <label className="deals-filter-field">
            <span className="deals-filter-label">Lane</span>
            <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="Filter by lane">
              <option value="">All lanes</option>
              <option value="DISTRESS_OWNER">DISTRESS OWNER</option>
              <option value="AUCTION_MONITOR">AUCTION MONITOR</option>
              <option value="GOV_LAND_P3">GOV LAND / P3</option>
              <option value="OFF_MARKET_STANDARD">OFF MARKET STANDARD</option>
              <option value="RESEARCH_REQUIRED">RESEARCH REQUIRED</option>
              <option value="NON_ACQUIRABLE_NOISE">NON ACQUIRABLE NOISE</option>
            </select>
          </label>
          <label className="deals-filter-field">
            <span className="deals-filter-label">Recommended Action</span>
            <select value={recommendedAction} onChange={(e) => setRecommendedAction(e.target.value)} aria-label="Filter by recommended action">
              <option value="">All actions</option>
              <option value="CONTACT_NOW">CONTACT NOW</option>
              <option value="MONITOR">MONITOR</option>
              <option value="AUCTION_PREP">AUCTION PREP</option>
              <option value="GOV_PURSUE">GOV PURSUE</option>
              <option value="RESEARCH">RESEARCH</option>
              <option value="ARCHIVE">ARCHIVE</option>
            </select>
          </label>
          <label className="deals-filter-field">
            <span className="deals-filter-label">Min score</span>
            <input value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="0" aria-label="Minimum pipeline score" />
          </label>
          <label className="deals-filter-field">
            <span className="deals-filter-label">Max score</span>
            <input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} placeholder="100" aria-label="Maximum pipeline score" />
          </label>
        </div>

        <div className="deals-filter-actions">
          <button className="button-secondary" onClick={applyFilters} disabled={loading}>
            Apply Filters
          </button>
          <button className="button-outline" onClick={resetFilters} disabled={loading}>
            Reset
          </button>
          <button className="button-ghost" onClick={() => setShowAdvancedFilters((prev) => !prev)} aria-expanded={showAdvancedFilters}>
            {showAdvancedFilters ? "Hide Advanced" : "Advanced Filters"}
          </button>
        </div>

        {showAdvancedFilters ? (
          <div className="deals-filters-advanced">
            <label className="deals-filter-field">
              <span className="deals-filter-label">Classification</span>
              <select value={classification} onChange={(e) => setClassification(e.target.value)} aria-label="Filter by opportunity class">
                <option value="">All classes</option>
                <option value="TRUE_OPPORTUNITY">TRUE OPPORTUNITY</option>
                <option value="WATCHLIST">WATCHLIST</option>
                <option value="PIPELINE_LISTING">PIPELINE LISTING</option>
                <option value="DISTRESS_CANDIDATE">DISTRESS CANDIDATE</option>
              </select>
            </label>
            <label className="deals-filter-field">
              <span className="deals-filter-label">Distress Stage</span>
              <select value={distressStage} onChange={(e) => setDistressStage(e.target.value)} aria-label="Filter by distress stage">
                <option value="">All distress stages</option>
                <option value="NONE">NONE</option>
                <option value="SIGNALS_ONLY">SIGNALS ONLY</option>
                <option value="PRE_FORECLOSURE">PRE FORECLOSURE</option>
                <option value="AUCTION_SCHEDULED">AUCTION SCHEDULED</option>
                <option value="AUCTION_POSTPONED_OR_CANCELLED">AUCTION POSTPONED/CANCELLED</option>
                <option value="TAX_SALE_PROCESS">TAX SALE PROCESS</option>
                <option value="GOVERNMENT_LAND">GOVERNMENT LAND</option>
                <option value="UNKNOWN">UNKNOWN</option>
              </select>
            </label>
            <label className="deals-filter-field">
              <span className="deals-filter-label">Asset Type</span>
              <select value={assetType} onChange={(e) => setAssetType(e.target.value)} aria-label="Filter by asset type">
                <option value="">All assets</option>
                {facets.assetTypes.map((row) => (
                  <option key={`asset-${row.value}`} value={row.value}>
                    {row.value} ({row.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="deals-filter-field">
              <span className="deals-filter-label">Use Category</span>
              <select value={propertyUseCode} onChange={(e) => setPropertyUseCode(e.target.value)} aria-label="Filter by use category">
                <option value="">All use categories</option>
                {facets.propertyUseCodes.map((row) => (
                  <option key={`use-${row.value}`} value={row.value}>
                    {row.value} ({row.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="deals-filter-field">
              <span className="deals-filter-label">Owner Type</span>
              <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} aria-label="Filter by owner type">
                <option value="">All owner types</option>
                <option value="PRIVATE">PRIVATE</option>
                <option value="GOV">GOV</option>
                <option value="HOA">HOA</option>
                <option value="UTILITY">UTILITY</option>
                <option value="UNKNOWN">UNKNOWN</option>
              </select>
            </label>
            <label className="deals-filter-field">
              <span className="deals-filter-label">Pipeline Stage</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by stage">
                <option value="">All statuses</option>
                {facets.statuses.map((row) => (
                  <option key={`status-${row.value}`} value={row.value}>
                    {row.value} ({row.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="deals-filter-field">
              <span className="deals-filter-label">Noise Mode</span>
              <select value={noiseMode} onChange={(e) => setNoiseMode(e.target.value as "hide" | "all" | "only")} aria-label="Filter noise mode">
                <option value="hide">Hide noise</option>
                <option value="all">All</option>
                <option value="only">Only noise</option>
              </select>
            </label>
          </div>
        ) : null}
      </section>

      {error && <TableEmptyState message={error} actionLabel="Reload" onAction={() => loadDeals().catch(() => undefined)} />}
      {!error && !loading && deals.length === 0 && <TableEmptyState message="No deals found for current filters." actionLabel="Reset filters" onAction={resetFilters} />}

      <DataTableShell
        title="Pipeline Table"
        summary={`Showing ${showingFrom}-${showingTo} of ${total} deals`}
      >
        {selectedCount > 0 ? (
          <div className="deals-bulk-toolbar" role="status" aria-live="polite">
            <span className="muted">{selectedCount} selected</span>
            <button className="button-ghost" onClick={() => patchStatusBulk("DD")} disabled={loading}>
              Mark DD
            </button>
            <button className="button-outline" onClick={() => patchStatusBulk("NEGOTIATION")} disabled={loading}>
              Move Negotiation
            </button>
            <button className="button-outline" onClick={() => patchStatusBulk("MONITOR")} disabled={loading}>
              Move Monitor
            </button>
            <button className="button-outline" onClick={() => patchStatusBulk("ARCHIVE")} disabled={loading}>
              Archive
            </button>
            <button className="button-ghost" onClick={() => setSelectedDealIds([])} disabled={loading}>
              Clear
            </button>
          </div>
        ) : null}
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                  aria-label="Select all visible deals"
                />
              </th>
              <th><ColumnHeaderSort label="Property Name" column="name" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Market" column="market" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Asset Type" column="assetType" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Use Category" column="propertyUseCode" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Pipeline Score" column="score" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} title="Higher means stronger pipeline signal" /></th>
              <th><ColumnHeaderSort label="Opportunity Class" column="classification" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} title="Computed classification gates" /></th>
              <th><ColumnHeaderSort label="Lane" column="lane" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Recommended Action" column="recommendedAction" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Distress Stage" column="distressStage" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Next Event" column="nextEventDate" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th><ColumnHeaderSort label="Contactability" column="contactabilityScore" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} title="Owner contactability score" /></th>
              <th>Noise</th>
              <th><ColumnHeaderSort label="Stage" column="status" sortBy={sortBy} sortDir={sortDir} onToggle={(column) => toggleSort(column as DealSortBy)} /></th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedDealIds.includes(deal.id)}
                    onChange={(e) => toggleSelectDeal(deal.id, e.target.checked)}
                    aria-label={`Select ${deal.name}`}
                  />
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    <a href={`/deals/${deal.id}`}>{deal.name}</a>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{deal.address ?? "Unavailable"}</div>
                </td>
                <td>{deal.market ?? "Unavailable"}</td>
                <td>{deal.assetType ?? "Unavailable"}</td>
                <td>{deal.propertyUseCode ?? "Unavailable"}</td>
                <td>
                  {typeof (deal.pipelineScore ?? deal.score) === "number" ? (
                    <div className="deals-score-cell">
                      <span className={`deals-score-pill ${scoreBand(deal.pipelineScore ?? deal.score)}`}>{Math.round((deal.pipelineScore ?? deal.score) as number)}</span>
                      <div className="deals-score-track">
                        <div className={`deals-score-fill ${scoreBand(deal.pipelineScore ?? deal.score)}`} style={{ width: `${scoreWidth(deal.pipelineScore ?? deal.score)}%` }} />
                      </div>
                    </div>
                  ) : (
                    "Unavailable"
                  )}
                </td>
                <td>
                  <span className={classificationBadge(deal.classification)}>{classificationLabel(deal.classification)}</span>
                </td>
                <td>{laneLabel(deal.lane)}</td>
                <td>{actionLabel(deal.recommendedAction)}</td>
                <td>{laneLabel(deal.distressStage)}</td>
                <td>{deal.nextEventDate ? new Date(deal.nextEventDate).toLocaleDateString() : "Unavailable"}</td>
                <td>{typeof deal.contactabilityScore === "number" ? `${deal.contactabilityScore.toFixed(0)}%` : "Unavailable"}</td>
                <td>{deal.isNoise ? `YES${deal.noiseReason ? ` (${deal.noiseReason})` : ""}` : "NO"}</td>
                <td>
                  <select value={deal.status} onChange={(e) => patchStatus(deal.id, e.target.value)} aria-label={`Update stage for ${deal.name}`}>
                    {stageOptions.map((value) => (
                      <option key={`${deal.id}-${value}`} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="deals-row-actions">
                    <a href={`/deals/${deal.id}`} className="button-ghost" style={{ textDecoration: "none" }}>
                      Open
                    </a>
                    <details className="deals-row-menu">
                      <summary aria-label={`More actions for ${deal.name}`}>More</summary>
                      <div className="deals-row-menu-list">
                        <button className="button-ghost" onClick={() => patchStatus(deal.id, "DD")}>
                          Mark DD
                        </button>
                        <button className="button-outline" onClick={() => patchStatus(deal.id, "NEGOTIATION")}>
                          Negotiation
                        </button>
                        <button className="button-outline" onClick={() => patchStatus(deal.id, "MONITOR")}>
                          Monitor
                        </button>
                        <button className="button-outline" onClick={() => patchStatus(deal.id, "ARCHIVE")}>
                          Archive
                        </button>
                      </div>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableShell>

      <div className="actions-row" style={{ marginTop: 16 }}>
        <button
          onClick={() => {
            const nextOffset = Math.max(0, offset - PAGE_SIZE);
            setOffset(nextOffset);
            const query = buildQueryParams(nextOffset).toString();
            router.replace(query ? `/deals?${query}` : "/deals");
          }}
          disabled={offset === 0 || loading}
        >
          Prev
        </button>
        <span className="muted">Page {page}</span>
        <button
          onClick={() => {
            const nextOffset = offset + PAGE_SIZE;
            setOffset(nextOffset);
            const query = buildQueryParams(nextOffset).toString();
            router.replace(query ? `/deals?${query}` : "/deals");
          }}
          disabled={loading || offset + PAGE_SIZE >= total}
        >
          Next
        </button>
        <span className="muted" style={{ marginLeft: "auto" }}>Total: {total}</span>
      </div>
    </div>
  );
}
