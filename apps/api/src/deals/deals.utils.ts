import {
  DealClassification,
  EARTH_RADIUS_MILES,
  InsightConfidence,
  MAX_COMPARABLE_SALE_PRICE,
  MIN_COMPARABLE_SALE_PRICE,
  NOISE_RULES,
  NoiseReason,
  OPPORTUNITY_THRESHOLDS,
  OpportunityClassificationResult,
  SPREAD_SANITY,
} from "./deals.types";

export function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[$,]/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function pickField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

export function extractGeometryPoint(feature: { geometry?: Record<string, unknown> }) {
  const geometry = feature.geometry;
  if (!geometry || typeof geometry !== "object") return undefined;
  const x = geometry.x;
  const y = geometry.y;
  if (typeof x === "number" && typeof y === "number") return { latitude: y, longitude: x };
  const rings = geometry.rings as unknown;
  if (!Array.isArray(rings) || !Array.isArray(rings[0]) || !rings[0].length) return undefined;
  const points = rings[0] as Array<[number, number]>;
  let sumX = 0, sumY = 0, count = 0;
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    if (typeof point[0] !== "number" || typeof point[1] !== "number") continue;
    sumX += point[0]; sumY += point[1]; count += 1;
  }
  if (!count) return undefined;
  return { latitude: sumY / count, longitude: sumX / count };
}

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceMiles(
  originLat?: number | null, originLng?: number | null,
  targetLat?: number | null, targetLng?: number | null,
) {
  if (originLat == null || originLng == null || targetLat == null || targetLng == null) return null;
  const dLat = toRadians(targetLat - originLat);
  const dLng = toRadians(targetLng - originLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(originLat)) * Math.cos(toRadians(targetLat)) * Math.sin(dLng / 2) ** 2;
  return Number((EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(3));
}

export function avg(values: Array<number | null | undefined>) {
  const filtered = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!filtered.length) return null;
  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

export function median(values: Array<number | null | undefined>) {
  const filtered = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!filtered.length) return null;
  const mid = Math.floor(filtered.length / 2);
  return filtered.length % 2 === 0 ? (filtered[mid - 1] + filtered[mid]) / 2 : filtered[mid];
}

export function isReasonableSalePrice(value: number | null | undefined) {
  return typeof value === "number" && value >= MIN_COMPARABLE_SALE_PRICE && value <= MAX_COMPARABLE_SALE_PRICE;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function safePercent(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export function isSpreadOutlier(spreadToAskPct: number | null) {
  if (typeof spreadToAskPct !== "number" || !Number.isFinite(spreadToAskPct)) return false;
  return spreadToAskPct < SPREAD_SANITY.minPct || spreadToAskPct > SPREAD_SANITY.maxPct;
}

export function computeDealCompletenessScore(input: {
  parcelId?: string | null; address?: string | null; city?: string | null; zip?: string | null;
  propertyUseCode?: string | null; lotSizeSqft?: number | null; buildingSizeSqft?: number | null;
  yearBuilt?: number | null; zoning?: string | null; askingPrice?: number | null;
  pricePerSqft?: number | null; latitude?: number | null; longitude?: number | null;
}) {
  const checks = [
    Boolean(toCleanText(input.parcelId ?? null)),
    Boolean(toCleanText(input.address ?? null)),
    Boolean(toCleanText(input.city ?? null)),
    Boolean(toCleanText(input.zip ?? null)),
    Boolean(toCleanText(input.propertyUseCode ?? null)),
    typeof input.lotSizeSqft === "number" && input.lotSizeSqft > 0,
    typeof input.buildingSizeSqft === "number" && input.buildingSizeSqft > 0,
    typeof input.yearBuilt === "number" && input.yearBuilt >= 1700,
    Boolean(toCleanText(input.zoning ?? null)),
    typeof input.askingPrice === "number" && input.askingPrice > 0,
    typeof input.pricePerSqft === "number" && input.pricePerSqft > 0,
    typeof input.latitude === "number",
    typeof input.longitude === "number",
  ];
  return Number(((checks.filter(Boolean).length / checks.length) * 100).toFixed(1));
}

export function toCleanText(value: string | null | undefined) {
  return value?.trim() || null;
}

export function formatAddress(parts: Array<string | null | undefined>) {
  return parts.map((part) => toCleanText(part)).filter(Boolean).join(", ").trim() || null;
}

export function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export function inferAssetTypeFromUse(rawValue?: string | null) {
  const value = toCleanText(rawValue);
  if (!value) return undefined;
  const n = value.toUpperCase();
  if (n.includes("INDUSTR")) return "Industrial";
  if (n.includes("OFFICE")) return "Office";
  if (n.includes("RETAIL")) return "Retail";
  if (n.includes("HOTEL") || n.includes("HOSPITALITY")) return "Hospitality";
  if (n.includes("MIXED")) return "Mixed Use";
  if (n.includes("AGRIC")) return "Agricultural";
  if (n.includes("VACANT") || n.includes("LAND") || n.includes("LOT")) return "Land";
  if (n.includes("COMMON AREA")) return "Residential Common Area/Element";
  if (n.includes("MULTI") || n.includes("APART")) return "Multifamily";
  if (n.includes("CONDO")) return "Condo";
  if (n.includes("SINGLE") || n.includes("RESIDENTIAL")) return "Residential";
  return value;
}

export function normalizeConfidence(value: unknown): InsightConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

export function detectNoiseReason(assetType?: string | null, propertyUseCode?: string | null): NoiseReason | null {
  const haystack = `${assetType ?? ""} ${propertyUseCode ?? ""}`.toUpperCase();
  for (const rule of NOISE_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) return rule.reason;
  }
  return null;
}

export function parseEventDate(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

export function inferOwnerType(ownerNames: string[]) {
  const joined = ownerNames.join(" ").toUpperCase();
  if (!joined.trim()) return "UNKNOWN" as const;
  if (joined.includes("COUNTY") || joined.includes("CITY OF") || joined.includes("STATE OF") || joined.includes("TOWN OF"))
    return "GOV" as const;
  if (joined.includes("HOA") || joined.includes("HOMEOWNERS")) return "HOA" as const;
  if (joined.includes("UTILITY") || joined.includes("WATER") || joined.includes("ELECTRIC")) return "UTILITY" as const;
  return "PRIVATE" as const;
}

export function inferDistressStage(signals: Array<{ metadata?: string | null }>): import("./deals.types").DistressStage {
  if (!signals.length) return "NONE";
  const payload = signals
    .map((s) => JSON.stringify(parseJson<Record<string, unknown>>(s.metadata ?? null) ?? {}).toUpperCase())
    .join(" ");
  if (payload.includes("AUCTION") || payload.includes("NOTICE OF SALE")) return "AUCTION_SCHEDULED";
  if (payload.includes("POSTPONED") || payload.includes("CANCEL")) return "AUCTION_POSTPONED_OR_CANCELLED";
  if (payload.includes("LIS PENDENS") || payload.includes("FORECLOS")) return "PRE_FORECLOSURE";
  if (payload.includes("TAX")) return "TAX_SALE_PROCESS";
  if (payload.includes("BANKRUPTCY")) return "BANKRUPTCY";
  if (payload.includes("PROBATE")) return "PROBATE_ESTATE";
  return "SIGNALS_ONLY";
}

export function classifyOpportunity(input: {
  spreadToAskPct: number | null; spreadOutlier: boolean; comparableCount: number;
  completenessScore: number; confidence: InsightConfidence; distressConfirmed: boolean;
  topDrivers: string[]; riskFlags: string[];
}): OpportunityClassificationResult {
  const spreadPassed = !input.spreadOutlier && typeof input.spreadToAskPct === "number" && input.spreadToAskPct >= OPPORTUNITY_THRESHOLDS.minSpreadPct;
  const compsPassed = input.comparableCount >= OPPORTUNITY_THRESHOLDS.minComparableCount;
  const completenessPassed = input.completenessScore >= OPPORTUNITY_THRESHOLDS.minCompletenessScore;
  const confidencePassed = input.confidence !== "low";

  const gates = {
    spread: { label: "Spread", passed: spreadPassed, value: input.spreadToAskPct, threshold: OPPORTUNITY_THRESHOLDS.minSpreadPct },
    comps: { label: "Comps", passed: compsPassed, value: input.comparableCount, threshold: OPPORTUNITY_THRESHOLDS.minComparableCount },
    completeness: { label: "Completeness", passed: completenessPassed, value: Number(input.completenessScore.toFixed(1)), threshold: OPPORTUNITY_THRESHOLDS.minCompletenessScore },
    confidence: { label: "Confidence", passed: confidencePassed, value: input.confidence, threshold: "not low" },
  };

  const passedCount = [spreadPassed, compsPassed, completenessPassed, confidencePassed].filter(Boolean).length;
  let classification: DealClassification = "PIPELINE_LISTING";
  if (input.distressConfirmed) classification = "DISTRESS_CANDIDATE";
  else if (passedCount === 4) classification = "TRUE_OPPORTUNITY";
  else if (passedCount >= 2) classification = "WATCHLIST";

  const failedGates = Object.values(gates).filter((g) => !g.passed).map((g) => g.label);
  const spreadOutlierNote = input.spreadOutlier ? " Spread signal is outlier and excluded from strict gate pass." : "";

  const nextBestAction = failedGates.includes("Comps")
    ? "Recompute comparables to increase coverage."
    : failedGates.includes("Completeness")
      ? "Refresh property facts to improve data completeness."
      : failedGates.includes("Spread")
        ? input.spreadOutlier
          ? "Validate asking price and valuation inputs; spread is outlier."
          : "Reprice assumptions or compare against recent sales before advancing."
        : failedGates.includes("Confidence")
          ? "Recompute insights and review valuation confidence."
          : classification === "TRUE_OPPORTUNITY"
            ? "Promote to acquisition underwriting."
            : classification === "DISTRESS_CANDIDATE"
              ? "Run distress due diligence and legal verification."
              : "Keep in watchlist until gating metrics improve.";

  const classificationReason =
    classification === "TRUE_OPPORTUNITY"
      ? `Meets strict gates (spread, comps, completeness, confidence). Drivers: ${input.topDrivers.slice(0, 3).join(" | ") || "n/a"}.`
      : classification === "WATCHLIST"
        ? `Partial gate pass (${passedCount}/4). Needs work on: ${failedGates.join(", ")}.${spreadOutlierNote}`
        : classification === "DISTRESS_CANDIDATE"
          ? "Official distress signal detected. Treat as special-situation opportunity."
          : `Fails strict opportunity gates. Main risks: ${input.riskFlags.slice(0, 3).join(" | ") || "insufficient pricing edge"}.${spreadOutlierNote}`;

  return {
    classification, classificationReason, gates, nextBestAction,
    foreclosureStatus: input.distressConfirmed ? "confirmed_by_official_source" : "not_confirmed_by_official_source",
  };
}
