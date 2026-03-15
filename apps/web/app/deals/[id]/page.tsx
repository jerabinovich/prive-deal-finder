"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { useRequireAuth } from "../../../lib/use-require-auth";
import { useChatContext } from "../../components/ChatContextProvider";
import ColumnHeaderSort from "../../components/ColumnHeaderSort";
import TableEmptyState from "../../components/TableEmptyState";
import TableFilterRow from "../../components/TableFilterRow";
import { useToast } from "../../components/ToastProvider";

interface Deal {
  id: string;
  name: string;
  parcelId?: string | null;
  address?: string | null;
  mailingAddress?: string | null;
  city?: string | null;
  municipality?: string | null;
  state?: string | null;
  zip?: string | null;
  assetType?: string | null;
  propertyUseCode?: string | null;
  market?: string | null;
  score?: number | null;
  pipelineScore?: number | null;
  classification?: "PIPELINE_LISTING" | "WATCHLIST" | "TRUE_OPPORTUNITY" | "DISTRESS_CANDIDATE" | null;
  lane?:
    | "DISTRESS_OWNER"
    | "AUCTION_MONITOR"
    | "GOV_LAND_P3"
    | "OFF_MARKET_STANDARD"
    | "NON_ACQUIRABLE_NOISE"
    | "RESEARCH_REQUIRED"
    | null;
  recommendedAction?: "CONTACT_NOW" | "MONITOR" | "AUCTION_PREP" | "GOV_PURSUE" | "RESEARCH" | "ARCHIVE" | null;
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
    | "UNKNOWN"
    | null;
  nextEventDate?: string | null;
  contactabilityScore?: number | null;
  isNoise?: boolean;
  noiseReason?: string | null;
  dataCompletenessScore?: number | null;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
  lotSizeSqft?: number | null;
  buildingSizeSqft?: number | null;
  yearBuilt?: number | null;
  zoning?: string | null;
  askingPrice?: number | null;
  pricePerSqft?: number | null;
  owners?: Array<{ owner: { id: string; name: string } }>;
  painPoints?: Array<{ type: string; description?: string | null }>;
}

interface DealMedia {
  id: string;
  kind: "PHOTO" | "VIDEO";
  url: string;
  caption?: string | null;
  sortOrder: number;
}

interface DealDocument {
  id: string;
  kind: "OM" | "FLYER" | "BROCHURE" | "RENT_ROLL" | "OTHER";
  title: string;
  url: string;
}

interface DealComparable {
  id: string;
  address: string;
  comparableDealId?: string | null;
  resolvedAddressConfidence?: number | null;
  quality?: "high" | "medium" | "low";
  distanceMiles?: number | null;
  salePrice?: number | null;
  pricePerSqft?: number | null;
  capRate?: number | null;
  source: string;
}

interface MdpaSale {
  id: string;
  saleDate?: string | null;
  salePrice?: number | null;
  saleType?: string | null;
}

interface MdpaAssessment {
  id: string;
  taxYear: number;
  rollStage?: "PR" | "FC" | "FN" | null;
  justValue?: number | null;
  assessedValue?: number | null;
  taxableValue?: number | null;
}

interface DealInsightsPayload {
  demographic?: Record<string, unknown> | null;
  climateRisk?: Record<string, unknown> | null;
  valuation?: Record<string, unknown> | null;
  updatedAt?: string;
}

interface DealOverview {
  deal: Deal;
  ownership?: {
    owners: Array<{ id: string; name: string; mailingAddress?: string | null }>;
  };
  facts?: {
    lotSizeSqft?: number | null;
    buildingSizeSqft?: number | null;
    yearBuilt?: number | null;
    zoning?: string | null;
    askingPrice?: number | null;
    pricePerSqft?: number | null;
    propertyUseCode?: string | null;
    municipality?: string | null;
  };
  sales?: MdpaSale[];
  assessments?: MdpaAssessment[];
  media: DealMedia[];
  documents: DealDocument[];
  comparables: DealComparable[];
  insights: DealInsightsPayload | null;
  completeness?: {
    score: number;
    missingFields: string[];
  };
  opportunitySummary?: {
    score: number;
    pipelineScore?: number;
    verdict: "STRONG_BUY" | "WATCHLIST" | "HIGH_RISK";
    confidence: "high" | "medium" | "low";
    classification: "PIPELINE_LISTING" | "WATCHLIST" | "TRUE_OPPORTUNITY" | "DISTRESS_CANDIDATE";
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
    nextEvent?: string | null;
    contactability?: number | null;
    isNoise?: boolean;
    noiseReason?: string | null;
    ownerType?: "PRIVATE" | "GOV" | "HOA" | "UTILITY" | "UNKNOWN";
    classificationReason: string;
    gates: Record<string, { label: string; passed: boolean; value: number | string | null; threshold: number | string }>;
    nextBestAction: string;
    foreclosureStatus: string;
    topDrivers: string[];
    riskFlags: string[];
    estimatedValue?: number | null;
    spreadToAskPct?: number | null;
    comparableCount?: number;
    blockers?: string[];
    why?: string[];
  };
  investmentThesis?: {
    classification: "PIPELINE_LISTING" | "WATCHLIST" | "TRUE_OPPORTUNITY" | "DISTRESS_CANDIDATE";
    headline: string;
    reason: string;
    spreadToAskPct: number | null;
    comparableCount: number;
    completenessScore: number;
    confidence: "high" | "medium" | "low";
    foreclosureStatus: string;
    gates: Record<string, { label: string; passed: boolean; value: number | string | null; threshold: number | string }>;
    nextBestAction: string;
    drivers: string[];
    risks: string[];
  };
  dataQuality?: {
    completenessScore: number;
    missingFields: string[];
    source: string;
    hasGeo: boolean;
    hasPricing: boolean;
    hasBuildingFacts: boolean;
    lastUpdatedAt?: string;
  };
  operationalDecision?: {
    lane?: string | null;
    recommendedAction?: string | null;
    distressStage?: string | null;
    nextEventDate?: string | null;
    contactabilityScore?: number | null;
    isNoise?: boolean;
    noiseReason?: string | null;
    ownerType?: string | null;
    why?: string[];
    blockers?: string[];
  };
  investmentThesisV2?: {
    verdict?: string;
    lane?: string;
    action?: string;
    reasons?: string[];
    risks?: string[];
    nextAction?: string;
  };
}

interface DealProjection {
  scenario: "conservative" | "base" | "aggressive";
  assumptions: {
    purchasePrice: number;
    rehabCost: number;
    monthlyRent: number;
    monthlyExpenses: number;
    exitCapRate: number;
    holdingMonths: number;
  };
  metrics: {
    annualNOI: number;
    estimatedExitValue: number;
    totalInvested: number;
    profit: number;
    cashOnCashPct: number;
  };
}

const MEDIA_KIND_OPTIONS = ["PHOTO", "VIDEO"] as const;
const DOCUMENT_KIND_OPTIONS = ["OM", "FLYER", "BROCHURE", "RENT_ROLL", "OTHER"] as const;
type SortDir = "asc" | "desc";

function prettyCurrency(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function prettyNumber(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickText(data: Record<string, unknown>, key: string) {
  const value = data[key];
  if (value === null || value === undefined) return "Unavailable";
  const text = String(value).trim();
  return text || "Unavailable";
}

function pickTextFromKeys(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "Unavailable";
}

function pickNumber(data: Record<string, unknown>, key: string) {
  const value = data[key];
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return value;
}

function pickNestedNumber(data: Record<string, unknown>, parent: string, child: string) {
  const nested = asRecord(data[parent]);
  const value = nested[child];
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return value;
}

function comparableSource(source: string) {
  if (!source.startsWith("internal:")) {
    return { label: source, href: null as string | null };
  }
  const id = source.slice("internal:".length).trim();
  if (!id) return { label: "Internal", href: null as string | null };
  return { label: "Internal Deal", href: `/deals/${id}` };
}

function comparableSourceType(source: string) {
  return source.startsWith("internal:") ? "Internal Deal" : source;
}

function comparableQualityLabel(quality?: "high" | "medium" | "low") {
  if (quality === "high") return "High";
  if (quality === "medium") return "Medium";
  if (quality === "low") return "Low";
  return "Unavailable";
}

function classificationLabel(value?: string | null) {
  if (!value) return "PIPELINE LISTING";
  return value.replaceAll("_", " ");
}

function operationalLabel(value?: string | null) {
  if (!value) return "Unavailable";
  return value.replaceAll("_", " ");
}

function gateValue(value: number | string | null) {
  if (value === null || value === undefined) return "Unavailable";
  if (typeof value === "number") return Number.isInteger(value) ? `${value}` : value.toFixed(1);
  return value;
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareNullableNumbers(a: number | null | undefined, b: number | null | undefined, dir: SortDir) {
  const av = typeof a === "number" ? a : Number.NEGATIVE_INFINITY;
  const bv = typeof b === "number" ? b : Number.NEGATIVE_INFINITY;
  if (av === bv) return 0;
  return dir === "asc" ? av - bv : bv - av;
}

function InsightCard({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <article className="detail-card insight-card">
      <div className="stat-label">{title}</div>
      <dl className="insight-list">
        {rows.map((row, index) => (
          <div className="insight-row" key={`${title}-${index}-${row.label}`}>
            <dt className="insight-key">{row.label}</dt>
            <dd className="insight-value">{row.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export default function DealDetailPage({ params }: { params: { id: string } }) {
  const authReady = useRequireAuth();
  const { publishState } = useChatContext();
  const { notify } = useToast();
  const [overview, setOverview] = useState<DealOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mediaKind, setMediaKind] = useState<(typeof MEDIA_KIND_OPTIONS)[number]>("PHOTO");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");

  const [documentKind, setDocumentKind] = useState<(typeof DOCUMENT_KIND_OPTIONS)[number]>("OM");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [projection, setProjection] = useState<DealProjection | null>(null);
  const [comparableQuery, setComparableQuery] = useState("");
  const [comparableSourceFilter, setComparableSourceFilter] = useState("");
  const [comparableQualityFilter, setComparableQualityFilter] = useState("");
  const [maxDistanceMiles, setMaxDistanceMiles] = useState("");
  const [minSalePrice, setMinSalePrice] = useState("");
  const [maxSalePrice, setMaxSalePrice] = useState("");
  const [minPricePerSqft, setMinPricePerSqft] = useState("");
  const [maxPricePerSqft, setMaxPricePerSqft] = useState("");
  const [minCapRate, setMinCapRate] = useState("");
  const [maxCapRate, setMaxCapRate] = useState("");
  const [comparableSortBy, setComparableSortBy] = useState<
    "address" | "distanceMiles" | "salePrice" | "pricePerSqft" | "capRate" | "quality" | "source"
  >("distanceMiles");
  const [comparableSortDir, setComparableSortDir] = useState<SortDir>("asc");
  const [saleTypeFilter, setSaleTypeFilter] = useState("");
  const [saleDateFrom, setSaleDateFrom] = useState("");
  const [saleDateTo, setSaleDateTo] = useState("");
  const [saleMinPrice, setSaleMinPrice] = useState("");
  const [saleMaxPrice, setSaleMaxPrice] = useState("");
  const [salesSortBy, setSalesSortBy] = useState<"saleDate" | "salePrice" | "saleType">("saleDate");
  const [salesSortDir, setSalesSortDir] = useState<SortDir>("desc");
  const [assessmentStageFilter, setAssessmentStageFilter] = useState("");
  const [assessmentYearMin, setAssessmentYearMin] = useState("");
  const [assessmentYearMax, setAssessmentYearMax] = useState("");
  const [assessmentSortBy, setAssessmentSortBy] = useState<
    "taxYear" | "rollStage" | "justValue" | "assessedValue" | "taxableValue"
  >("taxYear");
  const [assessmentSortDir, setAssessmentSortDir] = useState<SortDir>("desc");

  const loadOverview = useCallback(async () => {
    if (!authReady) return;
    try {
      const payload = await apiFetch<DealOverview>(`/deals/${params.id}/overview`);
      setOverview(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deal overview");
      setOverview(null);
    }
  }, [authReady, params.id]);

  useEffect(() => {
    loadOverview().catch(() => undefined);
  }, [loadOverview]);

  const deal = overview?.deal;

  useEffect(() => {
    const score = overview?.opportunitySummary?.score ?? deal?.pipelineScore ?? deal?.score ?? null;
    publishState({
      route: `/deals/${params.id}`,
      selectedDealId: params.id,
      selectedDealKey: params.id,
      activeFiltersCount: 0,
      activeFilters: {},
      pipelineVisibleRange: null,
      pipelineVisibleRows: deal
        ? [
            {
              dealId: deal.id,
              dealKey: deal.id,
              name: deal.name,
              market: deal.market ?? undefined,
              assetType: deal.assetType ?? undefined,
              useCategory: deal.propertyUseCode ?? undefined,
              pipelineScore: score,
              classification: overview?.opportunitySummary?.classification ?? deal.classification ?? undefined,
              status: deal.status,
            },
          ]
        : [],
    });
  }, [deal, overview?.opportunitySummary?.classification, overview?.opportunitySummary?.score, params.id, publishState]);

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY || "";
  const addressLabel = useMemo(() => {
    if (!deal) return "";
    return [deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ");
  }, [deal]);

  const locationQuery = useMemo(() => {
    if (!deal) return "";
    if (typeof deal.latitude === "number" && typeof deal.longitude === "number") {
      return `${deal.latitude},${deal.longitude}`;
    }
    return addressLabel;
  }, [deal, addressLabel]);

  const mapEmbedUrl = useMemo(() => {
    if (!locationQuery) return "";
    if (mapsKey) {
      return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapsKey)}&q=${encodeURIComponent(locationQuery)}`;
    }
    return `https://www.google.com/maps?q=${encodeURIComponent(locationQuery)}&output=embed`;
  }, [locationQuery, mapsKey]);

  const streetViewEmbedUrl = useMemo(() => {
    if (!locationQuery) return "";
    if (mapsKey) {
      return `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(mapsKey)}&location=${encodeURIComponent(locationQuery)}`;
    }
    return `https://maps.google.com/maps?q=${encodeURIComponent(locationQuery)}&layer=c&output=svembed`;
  }, [locationQuery, mapsKey]);

  const streetViewExternalUrl = useMemo(() => {
    if (!locationQuery) return "";
    if (typeof deal?.latitude === "number" && typeof deal?.longitude === "number") {
      return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${deal.latitude},${deal.longitude}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery)}`;
  }, [locationQuery, deal?.latitude, deal?.longitude]);

  const comparables = useMemo(
    () => (overview?.comparables ?? []).filter((item) => item.address?.trim()),
    [overview?.comparables]
  );
  const comparableSourceOptions = useMemo(
    () =>
      Array.from(new Set(comparables.map((item) => comparableSourceType(item.source))))
        .filter((value) => value.trim())
        .sort((a, b) => a.localeCompare(b)),
    [comparables]
  );
  const filteredComparables = useMemo(() => {
    const normalizedQuery = comparableQuery.trim().toLowerCase();
    const maxDistance = parseOptionalNumber(maxDistanceMiles);
    const minPrice = parseOptionalNumber(minSalePrice);
    const maxPrice = parseOptionalNumber(maxSalePrice);
    const minPpsf = parseOptionalNumber(minPricePerSqft);
    const maxPpsf = parseOptionalNumber(maxPricePerSqft);
    const minCap = parseOptionalNumber(minCapRate);
    const maxCap = parseOptionalNumber(maxCapRate);

    const filtered = comparables.filter((item) => {
      const sourceType = comparableSourceType(item.source);
      const qualityLabel = comparableQualityLabel(item.quality).toLowerCase();

      if (normalizedQuery) {
        const searchable = `${item.address} ${sourceType}`.toLowerCase();
        if (!searchable.includes(normalizedQuery)) return false;
      }
      if (comparableSourceFilter && sourceType !== comparableSourceFilter) return false;
      if (comparableQualityFilter && qualityLabel !== comparableQualityFilter.toLowerCase()) return false;
      if (maxDistance !== null && (typeof item.distanceMiles !== "number" || item.distanceMiles > maxDistance)) return false;
      if (minPrice !== null && (typeof item.salePrice !== "number" || item.salePrice < minPrice)) return false;
      if (maxPrice !== null && (typeof item.salePrice !== "number" || item.salePrice > maxPrice)) return false;
      if (minPpsf !== null && (typeof item.pricePerSqft !== "number" || item.pricePerSqft < minPpsf)) return false;
      if (maxPpsf !== null && (typeof item.pricePerSqft !== "number" || item.pricePerSqft > maxPpsf)) return false;
      if (minCap !== null && (typeof item.capRate !== "number" || item.capRate < minCap)) return false;
      if (maxCap !== null && (typeof item.capRate !== "number" || item.capRate > maxCap)) return false;

      return true;
    });

    return filtered.sort((a, b) => {
      if (comparableSortBy === "address") {
        const av = a.address.toLowerCase();
        const bv = b.address.toLowerCase();
        return comparableSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (comparableSortBy === "source") {
        const av = comparableSourceType(a.source).toLowerCase();
        const bv = comparableSourceType(b.source).toLowerCase();
        return comparableSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      if (comparableSortBy === "quality") {
        const rank = (value?: string) => {
          if (value === "high") return 3;
          if (value === "medium") return 2;
          if (value === "low") return 1;
          return 0;
        };
        const av = rank(a.quality);
        const bv = rank(b.quality);
        return comparableSortDir === "asc" ? av - bv : bv - av;
      }
      if (comparableSortBy === "distanceMiles") {
        return compareNullableNumbers(a.distanceMiles, b.distanceMiles, comparableSortDir);
      }
      if (comparableSortBy === "salePrice") {
        return compareNullableNumbers(a.salePrice, b.salePrice, comparableSortDir);
      }
      if (comparableSortBy === "pricePerSqft") {
        return compareNullableNumbers(a.pricePerSqft, b.pricePerSqft, comparableSortDir);
      }
      return compareNullableNumbers(a.capRate, b.capRate, comparableSortDir);
    });
  }, [
    comparables,
    comparableQuery,
    comparableSourceFilter,
    comparableQualityFilter,
    maxDistanceMiles,
    minSalePrice,
    maxSalePrice,
    minPricePerSqft,
    maxPricePerSqft,
    minCapRate,
    maxCapRate,
    comparableSortBy,
    comparableSortDir,
  ]);
  const filteredSales = useMemo(() => {
    const from = saleDateFrom ? new Date(saleDateFrom) : null;
    const to = saleDateTo ? new Date(saleDateTo) : null;
    const minPrice = parseOptionalNumber(saleMinPrice);
    const maxPrice = parseOptionalNumber(saleMaxPrice);

    return (overview?.sales ?? [])
      .filter((row) => {
        if (saleTypeFilter && (row.saleType ?? "").toLowerCase() !== saleTypeFilter.toLowerCase()) return false;
        if (from && row.saleDate) {
          const saleDate = new Date(row.saleDate);
          if (saleDate < from) return false;
        }
        if (to && row.saleDate) {
          const saleDate = new Date(row.saleDate);
          if (saleDate > to) return false;
        }
        if (minPrice !== null && (typeof row.salePrice !== "number" || row.salePrice < minPrice)) return false;
        if (maxPrice !== null && (typeof row.salePrice !== "number" || row.salePrice > maxPrice)) return false;
        return true;
      })
      .sort((a, b) => {
        if (salesSortBy === "saleType") {
          const av = (a.saleType ?? "").toLowerCase();
          const bv = (b.saleType ?? "").toLowerCase();
          return salesSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (salesSortBy === "salePrice") {
          return compareNullableNumbers(a.salePrice, b.salePrice, salesSortDir);
        }
        const av = a.saleDate ? new Date(a.saleDate).getTime() : Number.NEGATIVE_INFINITY;
        const bv = b.saleDate ? new Date(b.saleDate).getTime() : Number.NEGATIVE_INFINITY;
        if (av === bv) return 0;
        return salesSortDir === "asc" ? av - bv : bv - av;
      });
  }, [overview?.sales, saleTypeFilter, saleDateFrom, saleDateTo, saleMinPrice, saleMaxPrice, salesSortBy, salesSortDir]);
  const filteredAssessments = useMemo(() => {
    const yearMin = parseOptionalNumber(assessmentYearMin);
    const yearMax = parseOptionalNumber(assessmentYearMax);

    return (overview?.assessments ?? [])
      .filter((row) => {
        if (assessmentStageFilter && (row.rollStage ?? "").toLowerCase() !== assessmentStageFilter.toLowerCase()) return false;
        if (yearMin !== null && row.taxYear < yearMin) return false;
        if (yearMax !== null && row.taxYear > yearMax) return false;
        return true;
      })
      .sort((a, b) => {
        if (assessmentSortBy === "rollStage") {
          const av = (a.rollStage ?? "").toLowerCase();
          const bv = (b.rollStage ?? "").toLowerCase();
          return assessmentSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (assessmentSortBy === "justValue") return compareNullableNumbers(a.justValue, b.justValue, assessmentSortDir);
        if (assessmentSortBy === "assessedValue") return compareNullableNumbers(a.assessedValue, b.assessedValue, assessmentSortDir);
        if (assessmentSortBy === "taxableValue") return compareNullableNumbers(a.taxableValue, b.taxableValue, assessmentSortDir);
        return assessmentSortDir === "asc" ? a.taxYear - b.taxYear : b.taxYear - a.taxYear;
      });
  }, [overview?.assessments, assessmentStageFilter, assessmentYearMin, assessmentYearMax, assessmentSortBy, assessmentSortDir]);

  async function handleRecomputeComps() {
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await apiFetch<{ message: string; count: number }>(`/deals/${params.id}/recompute-comps`, {
        method: "POST",
      });
      setActionMessage(`${response.message}. Generated comps: ${response.count}`);
      notify(`Comparables recomputed (${response.count})`, "success");
      await loadOverview();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to recompute comparables";
      setActionMessage(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshFacts() {
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await apiFetch<{ updated: boolean; fieldsUpdated?: string[]; reason?: string }>(
        `/deals/${params.id}/refresh-facts`,
        {
          method: "POST",
        }
      );
      if (response.updated) {
        const count = Array.isArray(response.fieldsUpdated) ? response.fieldsUpdated.length : 0;
        setActionMessage(`Property facts refreshed. Fields updated: ${count}`);
        notify(`Facts refreshed (${count} fields)`, "success");
      } else {
        setActionMessage(response.reason || "No new source facts available");
        notify(response.reason || "No new source facts available", "info");
      }
      await loadOverview();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh facts";
      setActionMessage(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecomputeInsights() {
    setBusy(true);
    setActionMessage(null);
    try {
      await apiFetch(`/deals/${params.id}/recompute-insights`, { method: "POST" });
      setActionMessage("Insights recomputed");
      notify("Insights recomputed", "success");
      await loadOverview();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to recompute insights";
      setActionMessage(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleProjection(scenario: "conservative" | "base" | "aggressive") {
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await apiFetch<DealProjection>(`/deals/${params.id}/projections`, {
        method: "POST",
        body: JSON.stringify({ scenario }),
      });
      setProjection(response);
      setActionMessage(`Projection updated (${scenario})`);
      notify(`Projection updated (${scenario})`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build projection";
      setActionMessage(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mediaUrl.trim()) return;
    setBusy(true);
    setActionMessage(null);
    try {
      await apiFetch(`/deals/${params.id}/media`, {
        method: "POST",
        body: JSON.stringify({
          kind: mediaKind,
          url: mediaUrl.trim(),
          caption: mediaCaption.trim() || undefined,
        }),
      });
      setActionMessage("Media added");
      notify("Media added", "success");
      setMediaUrl("");
      setMediaCaption("");
      await loadOverview();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add media";
      setActionMessage(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentUrl.trim() || !documentTitle.trim()) return;
    setBusy(true);
    setActionMessage(null);
    try {
      await apiFetch(`/deals/${params.id}/documents`, {
        method: "POST",
        body: JSON.stringify({
          kind: documentKind,
          title: documentTitle.trim(),
          url: documentUrl.trim(),
        }),
      });
      setActionMessage("Document added");
      notify("Document added", "success");
      setDocumentTitle("");
      setDocumentUrl("");
      await loadOverview();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to add document";
      setActionMessage(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleComparableSort(column: "address" | "distanceMiles" | "salePrice" | "pricePerSqft" | "capRate" | "quality" | "source") {
    if (comparableSortBy === column) {
      setComparableSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setComparableSortBy(column);
    setComparableSortDir(column === "address" || column === "source" || column === "quality" ? "asc" : "desc");
  }

  function toggleSalesSort(column: "saleDate" | "salePrice" | "saleType") {
    if (salesSortBy === column) {
      setSalesSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSalesSortBy(column);
    setSalesSortDir(column === "saleType" ? "asc" : "desc");
  }

  function toggleAssessmentSort(column: "taxYear" | "rollStage" | "justValue" | "assessedValue" | "taxableValue") {
    if (assessmentSortBy === column) {
      setAssessmentSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setAssessmentSortBy(column);
    setAssessmentSortDir(column === "rollStage" ? "asc" : "desc");
  }

  if (!authReady) {
    return <div className="card"><p>Checking session...</p></div>;
  }

  if (error) {
    return <div className="card"><p>{error}</p></div>;
  }

  if (!deal || !overview) {
    return <div className="card"><p>Loading deal...</p></div>;
  }

  const lotSqftNumber = typeof deal.lotSizeSqft === "number" ? deal.lotSizeSqft : null;
  const lotAcresLabel =
    lotSqftNumber && lotSqftNumber > 0
      ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(lotSqftNumber / 43560)} acres`
      : null;
  const lotSizeLabel = lotAcresLabel
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(lotSqftNumber ?? 0)} (${lotAcresLabel})`
    : prettyNumber(deal.lotSizeSqft);

  const facts = overview.facts ?? {};
  const sales = overview.sales ?? [];
  const assessments = overview.assessments ?? [];
  const completenessScore = overview.completeness?.score ?? deal.dataCompletenessScore ?? 0;
  const missingFields = overview.completeness?.missingFields ?? [];
  const opportunity = overview.opportunitySummary;
  const dataQuality = overview.dataQuality;
  const investmentThesis = overview.investmentThesis;
  const investmentThesisV2 = overview.investmentThesisV2;
  const operationalDecision = overview.operationalDecision;
  const thesisGates = investmentThesis ? Object.values(investmentThesis.gates ?? {}) : [];
  const failedThesisGates = thesisGates.filter((gate) => !gate.passed).map((gate) => gate.label);
  const decisionClassification = investmentThesis?.classification ?? opportunity?.classification ?? deal.classification ?? "PIPELINE_LISTING";
  const decisionReason = investmentThesis?.reason ?? opportunity?.classificationReason ?? "No opportunity explanation available yet.";
  const decisionNextAction = investmentThesis?.nextBestAction ?? opportunity?.nextBestAction ?? "Run recompute actions to refresh decision.";
  const decisionLane = operationalDecision?.lane ?? opportunity?.lane ?? deal.lane ?? "RESEARCH_REQUIRED";
  const decisionAction = operationalDecision?.recommendedAction ?? opportunity?.recommendedAction ?? deal.recommendedAction ?? "MONITOR";
  const decisionDistressStage = operationalDecision?.distressStage ?? opportunity?.distressStage ?? deal.distressStage ?? "UNKNOWN";
  const decisionContactability =
    operationalDecision?.contactabilityScore ?? opportunity?.contactability ?? deal.contactabilityScore ?? null;
  const decisionNoiseReason = operationalDecision?.noiseReason ?? opportunity?.noiseReason ?? deal.noiseReason ?? null;
  const decisionIsNoise = operationalDecision?.isNoise ?? opportunity?.isNoise ?? deal.isNoise ?? false;
  const decisionWhy = (operationalDecision?.why ?? opportunity?.why ?? []).slice(0, 3);
  const decisionBlockers = (operationalDecision?.blockers ?? opportunity?.blockers ?? []).slice(0, 3);
  const decisionBadgeClass =
    decisionClassification === "TRUE_OPPORTUNITY"
      ? "badge badge-success"
      : decisionClassification === "WATCHLIST"
        ? "badge badge-warning"
        : decisionClassification === "DISTRESS_CANDIDATE"
          ? "badge badge-danger"
          : "badge badge-muted";

  const demographic = asRecord(overview.insights?.demographic);
  const climateRisk = asRecord(overview.insights?.climateRisk);
  const valuation = asRecord(overview.insights?.valuation);

  return (
    <div className="detail-layout">
      <section className="card detail-section">
        <div className="page-header">
          <div>
            <h1 className="page-title">{deal.name}</h1>
            <p className="page-subtitle">{addressLabel || "Address not available"}</p>
          </div>
          <span className="badge badge-muted">{deal.status}</span>
        </div>

        <div className="actions-row" style={{ marginBottom: 12 }}>
          <button className="button-outline" disabled={busy} onClick={() => handleRefreshFacts().catch(() => undefined)}>
            Refresh Facts
          </button>
          <button className="button-outline" disabled={busy} onClick={() => loadOverview().catch(() => undefined)}>
            Reload
          </button>
          <button className="button-secondary" disabled={busy} onClick={() => handleRecomputeComps().catch(() => undefined)}>
            Recompute Comps
          </button>
          <button className="button-ghost" disabled={busy} onClick={() => handleRecomputeInsights().catch(() => undefined)}>
            Recompute Insights
          </button>
          {streetViewExternalUrl && (
            <a
              className="button button-outline"
              href={streetViewExternalUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              Open Street View
            </a>
          )}
        </div>

        {actionMessage && <div className="empty-state" style={{ marginBottom: 12 }}>{actionMessage}</div>}

        <div className="detail-grid">
          <div className="detail-card"><div className="stat-label">Market</div><div className="stat-value">{deal.market ?? "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Asset Type</div><div className="stat-value">{deal.assetType ?? "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Pipeline Score</div><div className="stat-value">{deal.pipelineScore ?? deal.score ?? "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Classification</div><div className="stat-value">{classificationLabel(investmentThesis?.classification ?? deal.classification)}</div></div>
          <div className="detail-card"><div className="stat-label">Lane</div><div className="stat-value">{operationalLabel(decisionLane)}</div></div>
          <div className="detail-card"><div className="stat-label">Recommended Action</div><div className="stat-value">{operationalLabel(decisionAction)}</div></div>
          <div className="detail-card"><div className="stat-label">Distress Stage</div><div className="stat-value">{operationalLabel(decisionDistressStage)}</div></div>
          <div className="detail-card"><div className="stat-label">Contactability</div><div className="stat-value">{typeof decisionContactability === "number" ? `${decisionContactability.toFixed(0)}%` : "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Parcel ID</div><div className="stat-value">{deal.parcelId ?? "Unavailable"}</div></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="stat-label">Data Completeness</div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, completenessScore))}%`,
                height: "100%",
                background: "linear-gradient(90deg, #3ecf8e, #2ea7ff)",
              }}
            />
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {prettyNumber(completenessScore)}% complete
          </div>
        </div>

        <div className="empty-state" style={{ marginTop: 14, textAlign: "left" }}>
          <div className="actions-row" style={{ marginBottom: 8 }}>
            <span className={decisionBadgeClass}>{classificationLabel(decisionClassification)}</span>
          </div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {investmentThesisV2?.verdict ??
              (decisionClassification === "TRUE_OPPORTUNITY"
                ? "¿Es oportunidad real? Sí, cumple regla estricta."
                : decisionClassification === "WATCHLIST"
                  ? "¿Es oportunidad real? Parcial, aún en watchlist."
                  : decisionClassification === "DISTRESS_CANDIDATE"
                    ? "¿Es oportunidad real? Especial situación distress confirmada."
                    : "¿Es oportunidad real? Aún no, es pipeline listing.")}
          </div>
          <div>{decisionReason}</div>
          <div style={{ marginTop: 6 }}>
            <strong>Lane/Action:</strong> {operationalLabel(decisionLane)} · {operationalLabel(decisionAction)}
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>Noise:</strong> {decisionIsNoise ? `Yes${decisionNoiseReason ? ` (${operationalLabel(decisionNoiseReason)})` : ""}` : "No"}
          </div>
          {decisionWhy.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Why:</strong> {decisionWhy.join(" | ")}
            </div>
          )}
          {decisionBlockers.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Blockers:</strong> {decisionBlockers.join(" | ")}
            </div>
          )}
          {failedThesisGates.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Failed Gates:</strong> {failedThesisGates.join(", ")}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <strong>Next Action:</strong> {investmentThesisV2?.nextAction ?? decisionNextAction}
          </div>
        </div>
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Opportunity Snapshot</h3>
        {opportunity ? (
          <>
            <div className="detail-grid">
              <div className="detail-card"><div className="stat-label">Opportunity Score</div><div className="stat-value">{opportunity.score}</div></div>
              <div className="detail-card"><div className="stat-label">Verdict</div><div className="stat-value">{opportunity.verdict.replaceAll("_", " ")}</div></div>
              <div className="detail-card"><div className="stat-label">Classification</div><div className="stat-value">{classificationLabel(opportunity.classification)}</div></div>
              <div className="detail-card"><div className="stat-label">Lane</div><div className="stat-value">{operationalLabel(opportunity.lane)}</div></div>
              <div className="detail-card"><div className="stat-label">Recommended Action</div><div className="stat-value">{operationalLabel(opportunity.recommendedAction)}</div></div>
              <div className="detail-card"><div className="stat-label">Distress Stage</div><div className="stat-value">{operationalLabel(opportunity.distressStage)}</div></div>
              <div className="detail-card"><div className="stat-label">Next Event</div><div className="stat-value">{opportunity.nextEvent ? new Date(opportunity.nextEvent).toLocaleDateString() : "Unavailable"}</div></div>
              <div className="detail-card"><div className="stat-label">Contactability</div><div className="stat-value">{typeof opportunity.contactability === "number" ? `${opportunity.contactability.toFixed(0)}%` : "Unavailable"}</div></div>
              <div className="detail-card"><div className="stat-label">Confidence</div><div className="stat-value">{opportunity.confidence}</div></div>
              <div className="detail-card"><div className="stat-label">Estimated Value</div><div className="stat-value">{prettyCurrency(opportunity.estimatedValue)}</div></div>
              <div className="detail-card"><div className="stat-label">Spread vs Ask</div><div className="stat-value">{typeof opportunity.spreadToAskPct === "number" ? `${opportunity.spreadToAskPct.toFixed(1)}%` : "Unavailable"}</div></div>
              <div className="detail-card"><div className="stat-label">Comparable Count</div><div className="stat-value">{opportunity.comparableCount ?? "Unavailable"}</div></div>
            </div>
            <div className="empty-state" style={{ marginBottom: 12, textAlign: "left" }}>
              <strong>Classification Reason:</strong> {opportunity.classificationReason}
              <div style={{ marginTop: 6 }}>
                <strong>Next Best Action:</strong> {opportunity.nextBestAction}
              </div>
            </div>
            <div className="actions-row" style={{ marginBottom: 12 }}>
              <button className="button-outline" disabled={busy} onClick={() => handleProjection("conservative").catch(() => undefined)}>
                Conservative Projection
              </button>
              <button className="button-outline" disabled={busy} onClick={() => handleProjection("base").catch(() => undefined)}>
                Base Projection
              </button>
              <button className="button-outline" disabled={busy} onClick={() => handleProjection("aggressive").catch(() => undefined)}>
                Aggressive Projection
              </button>
            </div>
            {projection && (
              <div className="detail-grid">
                <div className="detail-card"><div className="stat-label">Scenario</div><div className="stat-value">{projection.scenario}</div></div>
                <div className="detail-card"><div className="stat-label">Annual NOI</div><div className="stat-value">{prettyCurrency(projection.metrics.annualNOI)}</div></div>
                <div className="detail-card"><div className="stat-label">Estimated Exit Value</div><div className="stat-value">{prettyCurrency(projection.metrics.estimatedExitValue)}</div></div>
                <div className="detail-card"><div className="stat-label">Total Invested</div><div className="stat-value">{prettyCurrency(projection.metrics.totalInvested)}</div></div>
                <div className="detail-card"><div className="stat-label">Projected Profit</div><div className="stat-value">{prettyCurrency(projection.metrics.profit)}</div></div>
                <div className="detail-card"><div className="stat-label">Cash-on-Cash</div><div className="stat-value">{`${projection.metrics.cashOnCashPct.toFixed(2)}%`}</div></div>
              </div>
            )}
            <div className="detail-grid">
              <div className="detail-card">
                <div className="stat-label">Top Drivers</div>
                <div className="tag-list" style={{ marginTop: 8 }}>
                  {opportunity.topDrivers.map((item, index) => (
                    <span className="tag" key={`driver-${index}`}>{item}</span>
                  ))}
                </div>
              </div>
              <div className="detail-card">
                <div className="stat-label">Risk Flags</div>
                <div className="tag-list" style={{ marginTop: 8 }}>
                  {opportunity.riskFlags.map((item, index) => (
                    <span className="tag" key={`risk-${index}`}>{item}</span>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">Dato no disponible en fuentes actuales. Usa Refresh Facts y Recompute Insights.</div>
        )}
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Data Quality</h3>
        {dataQuality ? (
          <div className="detail-grid">
            <div className="detail-card"><div className="stat-label">Completeness</div><div className="stat-value">{prettyNumber(dataQuality.completenessScore)}%</div></div>
            <div className="detail-card"><div className="stat-label">Source</div><div className="stat-value">{dataQuality.source}</div></div>
            <div className="detail-card"><div className="stat-label">Has Geo</div><div className="stat-value">{dataQuality.hasGeo ? "Yes" : "No"}</div></div>
            <div className="detail-card"><div className="stat-label">Has Pricing</div><div className="stat-value">{dataQuality.hasPricing ? "Yes" : "No"}</div></div>
            <div className="detail-card"><div className="stat-label">Has Building Facts</div><div className="stat-value">{dataQuality.hasBuildingFacts ? "Yes" : "No"}</div></div>
            <div className="detail-card"><div className="stat-label">Last Updated</div><div className="stat-value">{dataQuality.lastUpdatedAt ? new Date(dataQuality.lastUpdatedAt).toLocaleString() : "Unavailable"}</div></div>
          </div>
        ) : (
          <div className="empty-state">Dato no disponible en fuentes actuales. Usa Refresh Facts para recalcular calidad.</div>
        )}
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Property Facts</h3>
        {missingFields.length > 0 && (
          <div className="empty-state" style={{ marginBottom: 12 }}>
            Missing data from source: {missingFields.join(", ")}.
          </div>
        )}
        <div className="detail-grid">
          <div className="detail-card"><div className="stat-label">Lot Size (SqFt)</div><div className="stat-value">{facts.lotSizeSqft ? prettyNumber(facts.lotSizeSqft) : lotSizeLabel}</div></div>
          <div className="detail-card"><div className="stat-label">Building Size (SqFt)</div><div className="stat-value">{prettyNumber(facts.buildingSizeSqft ?? deal.buildingSizeSqft)}</div></div>
          <div className="detail-card"><div className="stat-label">Year Built</div><div className="stat-value">{facts.yearBuilt ?? deal.yearBuilt ?? "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Zoning</div><div className="stat-value">{facts.zoning ?? deal.zoning ?? "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Municipality</div><div className="stat-value">{facts.municipality ?? deal.municipality ?? deal.city ?? "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Property Use Code</div><div className="stat-value">{facts.propertyUseCode ?? deal.propertyUseCode ?? "Unavailable"}</div></div>
          <div className="detail-card"><div className="stat-label">Asking Price</div><div className="stat-value">{prettyCurrency(facts.askingPrice ?? deal.askingPrice)}</div></div>
          <div className="detail-card"><div className="stat-label">Price / SqFt</div><div className="stat-value">{prettyCurrency(facts.pricePerSqft ?? deal.pricePerSqft)}</div></div>
          <div className="detail-card"><div className="stat-label">Latitude</div><div className="stat-value">{prettyNumber(deal.latitude)}</div></div>
          <div className="detail-card"><div className="stat-label">Longitude</div><div className="stat-value">{prettyNumber(deal.longitude)}</div></div>
        </div>
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Gallery</h3>
        {overview.media.length ? (
          <div className="gallery-grid">
            {overview.media.map((item) => (
              <article className="media-card" key={item.id}>
                {item.kind === "VIDEO" ? (
                  <video src={item.url} controls preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.caption || "Deal media"} loading="lazy" />
                )}
                <div className="muted" style={{ fontSize: 12 }}>{item.caption || item.kind}</div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">Dato no disponible en fuentes actuales. Puedes agregar media manualmente.</div>
        )}

        <form className="filters-grid" style={{ marginTop: 12 }} onSubmit={handleCreateMedia}>
          <select value={mediaKind} onChange={(event) => setMediaKind(event.target.value as (typeof MEDIA_KIND_OPTIONS)[number])}>
            {MEDIA_KIND_OPTIONS.map((kind) => (
              <option value={kind} key={kind}>{kind}</option>
            ))}
          </select>
          <input value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://..." />
          <input value={mediaCaption} onChange={(event) => setMediaCaption(event.target.value)} placeholder="Caption (optional)" />
          <button type="submit" disabled={busy}>Add Media</button>
        </form>
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Map & Street View</h3>
        {mapEmbedUrl ? (
          <div className="map-grid">
            <iframe title="Location map" src={mapEmbedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            <iframe title="Street view" src={streetViewEmbedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          </div>
        ) : (
          <div className="empty-state">Dato no disponible en fuentes actuales. Ejecuta Refresh Facts o revisa la fuente GIS.</div>
        )}
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Documents</h3>
        {overview.documents.length ? (
          <div className="doc-list">
            {overview.documents.map((doc) => (
              <a className="doc-item" href={doc.url} target="_blank" rel="noreferrer" key={doc.id}>
                <strong>{doc.title}</strong>
                <span className="muted">{doc.kind}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="empty-state">Dato no disponible en fuentes actuales. Puedes adjuntar documentos manualmente.</div>
        )}

        <form className="filters-grid" style={{ marginTop: 12 }} onSubmit={handleCreateDocument}>
          <select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as (typeof DOCUMENT_KIND_OPTIONS)[number])}>
            {DOCUMENT_KIND_OPTIONS.map((kind) => (
              <option value={kind} key={kind}>{kind}</option>
            ))}
          </select>
          <input value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} placeholder="Document title" />
          <input value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} placeholder="https://..." />
          <button type="submit" disabled={busy}>Add Document</button>
        </form>
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Investment Thesis</h3>
        {investmentThesis ? (
          <>
            <div className="actions-row" style={{ marginBottom: 12 }}>
              <span
                className={
                  investmentThesis.classification === "TRUE_OPPORTUNITY"
                    ? "badge badge-success"
                    : investmentThesis.classification === "WATCHLIST"
                      ? "badge badge-warning"
                      : investmentThesis.classification === "DISTRESS_CANDIDATE"
                        ? "badge badge-danger"
                        : "badge badge-muted"
                }
              >
                {classificationLabel(investmentThesis.classification)}
              </span>
            </div>

            <div className="empty-state" style={{ textAlign: "left", marginBottom: 12 }}>
              <strong>{investmentThesis.headline}</strong>
              <div style={{ marginTop: 6 }}>{investmentThesis.reason}</div>
            </div>

            <div className="detail-grid">
              <div className="detail-card"><div className="stat-label">Spread vs Ask</div><div className="stat-value">{typeof investmentThesis.spreadToAskPct === "number" ? `${investmentThesis.spreadToAskPct.toFixed(1)}%` : "Unavailable"}</div></div>
              <div className="detail-card"><div className="stat-label">Usable Comps</div><div className="stat-value">{investmentThesis.comparableCount}</div></div>
              <div className="detail-card"><div className="stat-label">Completeness</div><div className="stat-value">{`${investmentThesis.completenessScore.toFixed(1)}%`}</div></div>
              <div className="detail-card"><div className="stat-label">Confidence</div><div className="stat-value">{investmentThesis.confidence}</div></div>
              <div className="detail-card"><div className="stat-label">Foreclosure</div><div className="stat-value">{investmentThesis.foreclosureStatus === "confirmed_by_official_source" ? "Confirmed" : "Not confirmed"}</div></div>
            </div>

            <div className="detail-grid">
              {thesisGates.map((gate, index) => (
                <div className="detail-card" key={`${gate.label}-${index}`}>
                  <div className="stat-label">{gate.label}</div>
                  <div className="stat-value">{gate.passed ? "PASS" : "FAIL"}</div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                    Value: {gateValue(gate.value)} | Threshold: {String(gate.threshold)}
                  </div>
                </div>
              ))}
            </div>

            <div className="empty-state" style={{ textAlign: "left" }}>
              <strong>Next Action:</strong> {investmentThesis.nextBestAction}
            </div>
          </>
        ) : (
          <div className="empty-state">
            Dato no disponible en fuentes actuales. Ejecuta <strong>Recompute Insights</strong> y <strong>Recompute Comps</strong>.
          </div>
        )}
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Comparables</h3>
        {comparables.length ? (
          <>
            <div className="actions-row" style={{ marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Showing {filteredComparables.length} of {comparables.length} comparables
              </span>
              <button
                className="button-ghost"
                type="button"
                onClick={() => {
                  setComparableQuery("");
                  setComparableSourceFilter("");
                  setComparableQualityFilter("");
                  setMaxDistanceMiles("");
                  setMinSalePrice("");
                  setMaxSalePrice("");
                  setMinPricePerSqft("");
                  setMaxPricePerSqft("");
                  setMinCapRate("");
                  setMaxCapRate("");
                  setComparableSortBy("distanceMiles");
                  setComparableSortDir("asc");
                }}
              >
                Clear Comparable Filters
              </button>
            </div>
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th><ColumnHeaderSort label="Comparable Property" column="address" sortBy={comparableSortBy} sortDir={comparableSortDir} onToggle={() => toggleComparableSort("address")} /></th>
                <th><ColumnHeaderSort label="Distance to Subject (mi)" column="distanceMiles" sortBy={comparableSortBy} sortDir={comparableSortDir} onToggle={() => toggleComparableSort("distanceMiles")} /></th>
                <th><ColumnHeaderSort label="Sale Price (USD)" column="salePrice" sortBy={comparableSortBy} sortDir={comparableSortDir} onToggle={() => toggleComparableSort("salePrice")} /></th>
                <th><ColumnHeaderSort label="Price/SqFt (USD)" column="pricePerSqft" sortBy={comparableSortBy} sortDir={comparableSortDir} onToggle={() => toggleComparableSort("pricePerSqft")} /></th>
                <th><ColumnHeaderSort label="Cap Rate (%)" column="capRate" sortBy={comparableSortBy} sortDir={comparableSortDir} onToggle={() => toggleComparableSort("capRate")} /></th>
                <th><ColumnHeaderSort label="Data Quality" column="quality" sortBy={comparableSortBy} sortDir={comparableSortDir} onToggle={() => toggleComparableSort("quality")} title="Confidence of comparable quality" /></th>
                <th><ColumnHeaderSort label="Data Source" column="source" sortBy={comparableSortBy} sortDir={comparableSortDir} onToggle={() => toggleComparableSort("source")} /></th>
              </tr>
              <TableFilterRow>
                <th>
                  <input
                    value={comparableQuery}
                    onChange={(event) => setComparableQuery(event.target.value)}
                    placeholder="Address or source"
                    aria-label="Filter comparables by address or source"
                    style={{ minWidth: 180 }}
                  />
                </th>
                <th>
                  <input
                    value={maxDistanceMiles}
                    onChange={(event) => setMaxDistanceMiles(event.target.value)}
                    placeholder="Max mi"
                    aria-label="Max comparable distance miles"
                    style={{ width: 80 }}
                  />
                </th>
                <th>
                  <div className="actions-row">
                    <input
                      value={minSalePrice}
                      onChange={(event) => setMinSalePrice(event.target.value)}
                      placeholder="Min"
                      aria-label="Minimum comparable sale price"
                      style={{ width: 90 }}
                    />
                    <input
                      value={maxSalePrice}
                      onChange={(event) => setMaxSalePrice(event.target.value)}
                      placeholder="Max"
                      aria-label="Maximum comparable sale price"
                      style={{ width: 90 }}
                    />
                  </div>
                </th>
                <th>
                  <div className="actions-row">
                    <input
                      value={minPricePerSqft}
                      onChange={(event) => setMinPricePerSqft(event.target.value)}
                      placeholder="Min"
                      aria-label="Minimum comparable price per sqft"
                      style={{ width: 85 }}
                    />
                    <input
                      value={maxPricePerSqft}
                      onChange={(event) => setMaxPricePerSqft(event.target.value)}
                      placeholder="Max"
                      aria-label="Maximum comparable price per sqft"
                      style={{ width: 85 }}
                    />
                  </div>
                </th>
                <th>
                  <div className="actions-row">
                    <input
                      value={minCapRate}
                      onChange={(event) => setMinCapRate(event.target.value)}
                      placeholder="Min"
                      aria-label="Minimum comparable cap rate"
                      style={{ width: 80 }}
                    />
                    <input
                      value={maxCapRate}
                      onChange={(event) => setMaxCapRate(event.target.value)}
                      placeholder="Max"
                      aria-label="Maximum comparable cap rate"
                      style={{ width: 80 }}
                    />
                  </div>
                </th>
                <th>
                  <select value={comparableQualityFilter} onChange={(event) => setComparableQualityFilter(event.target.value)} aria-label="Filter by comparable quality">
                    <option value="">All qualities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </th>
                <th>
                  <select value={comparableSourceFilter} onChange={(event) => setComparableSourceFilter(event.target.value)} aria-label="Filter by comparable source">
                    <option value="">All sources</option>
                    {comparableSourceOptions.map((sourceOption) => (
                      <option key={`source-${sourceOption}`} value={sourceOption}>
                        {sourceOption}
                      </option>
                    ))}
                  </select>
                </th>
              </TableFilterRow>
            </thead>
            <tbody>
              {filteredComparables.map((item) => {
                const source = comparableSource(item.source);
                const comparableLink = item.comparableDealId ? `/deals/${item.comparableDealId}` : source.href;
                return (
                  <tr key={item.id}>
                    <td>
                      <div>{item.address}</div>
                      {typeof item.resolvedAddressConfidence === "number" ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          Address confidence: {(item.resolvedAddressConfidence * 100).toFixed(0)}%
                        </div>
                      ) : null}
                    </td>
                    <td>{prettyNumber(item.distanceMiles)}</td>
                    <td>{prettyCurrency(item.salePrice)}</td>
                    <td>{prettyCurrency(item.pricePerSqft)}</td>
                    <td>{typeof item.capRate === "number" ? `${item.capRate.toFixed(2)}%` : "Unavailable"}</td>
                    <td>{comparableQualityLabel(item.quality)}</td>
                    <td>
                      {comparableLink ? (
                        <a href={comparableLink} className="muted" style={{ textDecoration: "underline" }}>
                          {source.label}
                        </a>
                      ) : (
                        source.label
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          </>
        ) : (
          <TableEmptyState message="Dato no disponible en fuentes actuales para comparables." actionLabel="Recompute comps" onAction={() => handleRecomputeComps().catch(() => undefined)} />
        )}
        {comparables.length > 0 && filteredComparables.length === 0 ? (
          <TableEmptyState message="No comparables match current filters. Adjust or clear filters." actionLabel="Clear filters" onAction={() => {
            setComparableQuery("");
            setComparableSourceFilter("");
            setComparableQualityFilter("");
            setMaxDistanceMiles("");
            setMinSalePrice("");
            setMaxSalePrice("");
            setMinPricePerSqft("");
            setMaxPricePerSqft("");
            setMinCapRate("");
            setMaxCapRate("");
          }} />
        ) : null}
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Sales & Tax History</h3>
        <div className="detail-grid">
          <div className="detail-card">
            <div className="stat-label">Recent Sales</div>
            <div className="stat-value">{sales.length}</div>
          </div>
          <div className="detail-card">
            <div className="stat-label">Assessment Records</div>
            <div className="stat-value">{assessments.length}</div>
          </div>
        </div>
        {sales.length ? (
          <>
            <div className="actions-row" style={{ marginTop: 12, marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Showing {filteredSales.length} of {sales.length} sales
              </span>
              <button
                className="button-ghost"
                type="button"
                onClick={() => {
                  setSaleTypeFilter("");
                  setSaleDateFrom("");
                  setSaleDateTo("");
                  setSaleMinPrice("");
                  setSaleMaxPrice("");
                  setSalesSortBy("saleDate");
                  setSalesSortDir("desc");
                }}
              >
                Clear Sales Filters
              </button>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th><ColumnHeaderSort label="Sale Date" column="saleDate" sortBy={salesSortBy} sortDir={salesSortDir} onToggle={() => toggleSalesSort("saleDate")} /></th>
                    <th><ColumnHeaderSort label="Sale Price" column="salePrice" sortBy={salesSortBy} sortDir={salesSortDir} onToggle={() => toggleSalesSort("salePrice")} /></th>
                    <th><ColumnHeaderSort label="Sale Type" column="saleType" sortBy={salesSortBy} sortDir={salesSortDir} onToggle={() => toggleSalesSort("saleType")} /></th>
                  </tr>
                  <TableFilterRow>
                    <th>
                      <div className="actions-row">
                        <input type="date" value={saleDateFrom} onChange={(event) => setSaleDateFrom(event.target.value)} aria-label="Sales date from" />
                        <input type="date" value={saleDateTo} onChange={(event) => setSaleDateTo(event.target.value)} aria-label="Sales date to" />
                      </div>
                    </th>
                    <th>
                      <div className="actions-row">
                        <input value={saleMinPrice} onChange={(event) => setSaleMinPrice(event.target.value)} placeholder="Min" aria-label="Minimum sale price" />
                        <input value={saleMaxPrice} onChange={(event) => setSaleMaxPrice(event.target.value)} placeholder="Max" aria-label="Maximum sale price" />
                      </div>
                    </th>
                    <th>
                      <input value={saleTypeFilter} onChange={(event) => setSaleTypeFilter(event.target.value)} placeholder="Type" aria-label="Filter by sale type" />
                    </th>
                  </TableFilterRow>
                </thead>
                <tbody>
                  {filteredSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{sale.saleDate ? new Date(sale.saleDate).toLocaleDateString() : "Unavailable"}</td>
                      <td>{prettyCurrency(sale.salePrice)}</td>
                      <td>{sale.saleType || "Unavailable"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredSales.length === 0 ? (
              <TableEmptyState message="No sales match current filters." actionLabel="Clear filters" onAction={() => {
                setSaleTypeFilter("");
                setSaleDateFrom("");
                setSaleDateTo("");
                setSaleMinPrice("");
                setSaleMaxPrice("");
              }} />
            ) : null}
          </>
        ) : (
          <TableEmptyState message="Dato no disponible en fuentes actuales para historial de ventas." />
        )}

        {assessments.length ? (
          <>
            <div className="actions-row" style={{ marginTop: 12, marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Showing {filteredAssessments.length} of {assessments.length} assessments
              </span>
              <button
                className="button-ghost"
                type="button"
                onClick={() => {
                  setAssessmentStageFilter("");
                  setAssessmentYearMin("");
                  setAssessmentYearMax("");
                  setAssessmentSortBy("taxYear");
                  setAssessmentSortDir("desc");
                }}
              >
                Clear Assessment Filters
              </button>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th><ColumnHeaderSort label="Tax Year" column="taxYear" sortBy={assessmentSortBy} sortDir={assessmentSortDir} onToggle={() => toggleAssessmentSort("taxYear")} /></th>
                    <th><ColumnHeaderSort label="Roll Stage" column="rollStage" sortBy={assessmentSortBy} sortDir={assessmentSortDir} onToggle={() => toggleAssessmentSort("rollStage")} /></th>
                    <th><ColumnHeaderSort label="Just Value" column="justValue" sortBy={assessmentSortBy} sortDir={assessmentSortDir} onToggle={() => toggleAssessmentSort("justValue")} /></th>
                    <th><ColumnHeaderSort label="Assessed Value" column="assessedValue" sortBy={assessmentSortBy} sortDir={assessmentSortDir} onToggle={() => toggleAssessmentSort("assessedValue")} /></th>
                    <th><ColumnHeaderSort label="Taxable Value" column="taxableValue" sortBy={assessmentSortBy} sortDir={assessmentSortDir} onToggle={() => toggleAssessmentSort("taxableValue")} /></th>
                  </tr>
                  <TableFilterRow>
                    <th>
                      <div className="actions-row">
                        <input value={assessmentYearMin} onChange={(event) => setAssessmentYearMin(event.target.value)} placeholder="Min year" aria-label="Minimum tax year" />
                        <input value={assessmentYearMax} onChange={(event) => setAssessmentYearMax(event.target.value)} placeholder="Max year" aria-label="Maximum tax year" />
                      </div>
                    </th>
                    <th>
                      <input value={assessmentStageFilter} onChange={(event) => setAssessmentStageFilter(event.target.value)} placeholder="PR/FC/FN" aria-label="Filter by roll stage" />
                    </th>
                    <th />
                    <th />
                    <th />
                  </TableFilterRow>
                </thead>
                <tbody>
                  {filteredAssessments.map((row) => (
                    <tr key={row.id}>
                      <td>{row.taxYear}</td>
                      <td>{row.rollStage || "Unavailable"}</td>
                      <td>{prettyCurrency(row.justValue)}</td>
                      <td>{prettyCurrency(row.assessedValue)}</td>
                      <td>{prettyCurrency(row.taxableValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredAssessments.length === 0 ? (
              <TableEmptyState message="No assessments match current filters." actionLabel="Clear filters" onAction={() => {
                setAssessmentStageFilter("");
                setAssessmentYearMin("");
                setAssessmentYearMax("");
              }} />
            ) : null}
          </>
        ) : (
          <TableEmptyState message="Dato no disponible en fuentes actuales para historial fiscal." />
        )}
      </section>

      <section className="card detail-section">
        <h3 className="section-title">Insights</h3>
        {overview.insights ? (
          <>
            {overview.insights.updatedAt && (
              <p className="muted" style={{ marginTop: -6, marginBottom: 10 }}>
                Updated: {new Date(overview.insights.updatedAt).toLocaleString()}
              </p>
            )}
            <div className="insight-grid">
              <InsightCard
                title="Demographics"
                rows={[
                  { label: "Source", value: pickText(demographic, "source") },
                  { label: "Status", value: pickText(demographic, "status") },
                  { label: "Market", value: pickText(demographic, "market") },
                  { label: "City", value: pickText(demographic, "city") },
                  { label: "Summary", value: pickTextFromKeys(demographic, ["summary", "notes"]) },
                ]}
              />
              <InsightCard
                title="Climate Risk"
                rows={[
                  { label: "Source", value: pickText(climateRisk, "source") },
                  { label: "Status", value: pickText(climateRisk, "status") },
                  { label: "Risk Level", value: pickText(climateRisk, "riskLevel") },
                  { label: "Latitude", value: prettyNumber(pickNestedNumber(climateRisk, "location", "latitude")) },
                  { label: "Longitude", value: prettyNumber(pickNestedNumber(climateRisk, "location", "longitude")) },
                  { label: "Summary", value: pickTextFromKeys(climateRisk, ["summary", "notes"]) },
                ]}
              />
              <InsightCard
                title="Valuation"
                rows={[
                  { label: "Source", value: pickText(valuation, "source") },
                  { label: "Comparable Count", value: prettyNumber(pickNumber(valuation, "comparableCount")) },
                  { label: "Usable Comparables", value: prettyNumber(pickNumber(valuation, "usableComparableCount")) },
                  { label: "Average Price/SqFt", value: prettyCurrency(pickNumber(valuation, "avgCompPricePerSqft")) },
                  { label: "Median Price/SqFt", value: prettyCurrency(pickNumber(valuation, "medianCompPricePerSqft")) },
                  { label: "Average Cap Rate", value: prettyNumber(pickNumber(valuation, "avgCompCapRate")) },
                  { label: "Estimated Value", value: prettyCurrency(pickNumber(valuation, "estimatedValue")) },
                  { label: "Confidence", value: pickText(valuation, "confidence") },
                  { label: "Summary", value: pickTextFromKeys(valuation, ["summary", "notes"]) },
                ]}
              />
            </div>
          </>
        ) : (
          <div className="empty-state">Dato no disponible en fuentes actuales. Usa Recompute Insights.</div>
        )}
      </section>

      <section className="card detail-section">
        <div style={{ marginBottom: 16 }}>
          <h3 className="section-title">Owners</h3>
          {(overview.ownership?.owners?.length || deal.owners?.length) ? (
            <>
              <div className="tag-list">
                {(overview.ownership?.owners?.length
                  ? overview.ownership.owners.map((entry) => ({ id: entry.id, name: entry.name }))
                  : deal.owners?.map((entry) => ({ id: entry.owner.id, name: entry.owner.name })) ?? []
                ).map((entry) => (
                  <span className="tag" key={entry.id}>{entry.name}</span>
                ))}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                Mailing address: {deal.mailingAddress || "Unavailable"}
              </div>
            </>
          ) : (
            <div className="empty-state">No owners listed.</div>
          )}
        </div>

        <div>
          <h3 className="section-title">Pain Points</h3>
          {deal.painPoints?.length ? (
            <div className="tag-list">
              {deal.painPoints.map((pp, idx) => (
                <span className="tag" key={`${pp.type}-${idx}`}>{pp.type}: {pp.description ?? ""}</span>
              ))}
            </div>
          ) : (
            <div className="empty-state">No pain points recorded.</div>
          )}
        </div>
      </section>
    </div>
  );
}
