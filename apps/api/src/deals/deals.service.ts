import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma.service";
import { fetchArcgisWhere } from "../integrations/connectors/arcgis";
import { CreateDealDto } from "./dto/create-deal.dto";
import { CreateDealDocumentDto } from "./dto/create-deal-document.dto";
import { CreateDealMediaDto } from "./dto/create-deal-media.dto";
import { CreateWorkflowTaskDto } from "./dto/create-workflow-task.dto";
import { DealsBackfillDto } from "./dto/deals-backfill.dto";
import { ListDealsQueryDto } from "./dto/list-deals-query.dto";
import { ProjectionScenarioDto } from "./dto/projection-scenario.dto";
import { UpdateDealDto } from "./dto/update-deal.dto";
import { UpdateWorkflowTaskDto } from "./dto/update-workflow-task.dto";

const EARTH_RADIUS_MILES = 3958.8;
const MIAMI_DADE_FALLBACK_LAYER = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_Emaps/MapServer/72";
const MIN_COMPARABLE_SALE_PRICE = 1000;
const MAX_COMPARABLE_SALE_PRICE = 1_000_000_000;

type DealClassification = "PIPELINE_LISTING" | "WATCHLIST" | "TRUE_OPPORTUNITY" | "DISTRESS_CANDIDATE";
type InsightConfidence = "high" | "medium" | "low";
type DealLane =
  | "DISTRESS_OWNER"
  | "AUCTION_MONITOR"
  | "GOV_LAND_P3"
  | "OFF_MARKET_STANDARD"
  | "NON_ACQUIRABLE_NOISE"
  | "RESEARCH_REQUIRED";
type RecommendedAction = "CONTACT_NOW" | "MONITOR" | "AUCTION_PREP" | "GOV_PURSUE" | "RESEARCH" | "ARCHIVE";
type DistressStage =
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
type NoiseReason = "COMMON_AREA" | "ROADWAY" | "RAILROAD" | "CENTRALLY_ASSESSED" | "UTILITY" | "UNKNOWN";
type OpportunityGateStatus = {
  label: string;
  passed: boolean;
  value: number | string | null;
  threshold: number | string;
};

type OpportunityClassificationResult = {
  classification: DealClassification;
  classificationReason: string;
  gates: {
    spread: OpportunityGateStatus;
    comps: OpportunityGateStatus;
    completeness: OpportunityGateStatus;
    confidence: OpportunityGateStatus;
  };
  nextBestAction: string;
  foreclosureStatus: string;
};

type OperationalDecision = {
  lane: DealLane;
  recommendedAction: RecommendedAction;
  distressStage: DistressStage;
  nextEventDate: Date | null;
  contactabilityScore: number;
  isNoise: boolean;
  noiseReason: NoiseReason | null;
  ownerType: "PRIVATE" | "GOV" | "HOA" | "UTILITY" | "UNKNOWN";
  why: string[];
  blockers: string[];
};

const OPPORTUNITY_THRESHOLDS = {
  minSpreadPct: 10,
  minComparableCount: 8,
  minCompletenessScore: 70,
} as const;

const SPREAD_SANITY = {
  minPct: -90,
  maxPct: 250,
} as const;

const ENGINE_VERSION = "operational-triage-v1";

const NOISE_RULES: Array<{ reason: NoiseReason; keywords: string[] }> = [
  { reason: "UNKNOWN", keywords: ["VACANT GOVERNMENTAL", "VACANT LAND - GOVERNMENTAL"] },
  { reason: "COMMON_AREA", keywords: ["COMMON AREA", "COMMON AREA/ELEMENT", "REC AREA"] },
  { reason: "ROADWAY", keywords: ["ROADWAY"] },
  { reason: "RAILROAD", keywords: ["RAILROAD"] },
  { reason: "CENTRALLY_ASSESSED", keywords: ["CENTRALLY ASSESSED"] },
  { reason: "UTILITY", keywords: ["UTILITY"] },
];

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[$,]/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function extractGeometryPoint(feature: { geometry?: Record<string, unknown> }) {
  const geometry = feature.geometry;
  if (!geometry || typeof geometry !== "object") return undefined;

  const x = geometry.x;
  const y = geometry.y;
  if (typeof x === "number" && typeof y === "number") {
    return { latitude: y, longitude: x };
  }

  const rings = geometry.rings as unknown;
  if (!Array.isArray(rings) || !Array.isArray(rings[0]) || !rings[0].length) return undefined;

  const points = rings[0] as Array<[number, number]>;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    if (typeof point[0] !== "number" || typeof point[1] !== "number") continue;
    sumX += point[0];
    sumY += point[1];
    count += 1;
  }

  if (!count) return undefined;
  return {
    latitude: sumY / count,
    longitude: sumX / count,
  };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMiles(
  originLat?: number | null,
  originLng?: number | null,
  targetLat?: number | null,
  targetLng?: number | null
) {
  if (
    originLat === undefined ||
    originLat === null ||
    originLng === undefined ||
    originLng === null ||
    targetLat === undefined ||
    targetLat === null ||
    targetLng === undefined ||
    targetLng === null
  ) {
    return null;
  }

  const dLat = toRadians(targetLat - originLat);
  const dLng = toRadians(targetLng - originLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(originLat)) * Math.cos(toRadians(targetLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((EARTH_RADIUS_MILES * c).toFixed(3));
}

function avg(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!filtered.length) return null;
  const total = filtered.reduce((sum, value) => sum + value, 0);
  return total / filtered.length;
}

function median(values: Array<number | null | undefined>) {
  const filtered = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!filtered.length) return null;
  const middle = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 0) {
    return (filtered[middle - 1] + filtered[middle]) / 2;
  }
  return filtered[middle];
}

function isReasonableSalePrice(value: number | null | undefined) {
  return typeof value === "number" && value >= MIN_COMPARABLE_SALE_PRICE && value <= MAX_COMPARABLE_SALE_PRICE;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safePercent(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function isSpreadOutlier(spreadToAskPct: number | null) {
  if (typeof spreadToAskPct !== "number" || !Number.isFinite(spreadToAskPct)) return false;
  return spreadToAskPct < SPREAD_SANITY.minPct || spreadToAskPct > SPREAD_SANITY.maxPct;
}

function computeDealCompletenessScore(input: {
  parcelId?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  propertyUseCode?: string | null;
  lotSizeSqft?: number | null;
  buildingSizeSqft?: number | null;
  yearBuilt?: number | null;
  zoning?: string | null;
  askingPrice?: number | null;
  pricePerSqft?: number | null;
  latitude?: number | null;
  longitude?: number | null;
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

  const completed = checks.filter(Boolean).length;
  return Number(((completed / checks.length) * 100).toFixed(1));
}

function toCleanText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function formatAddress(parts: Array<string | null | undefined>) {
  return parts.map((part) => toCleanText(part)).filter(Boolean).join(", ").trim() || null;
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch (_error) {
    return null;
  }
}

function inferAssetTypeFromUse(rawValue?: string | null) {
  const value = toCleanText(rawValue);
  if (!value) return undefined;

  const normalized = value.toUpperCase();
  if (normalized.includes("INDUSTR")) return "Industrial";
  if (normalized.includes("OFFICE")) return "Office";
  if (normalized.includes("RETAIL")) return "Retail";
  if (normalized.includes("HOTEL") || normalized.includes("HOSPITALITY")) return "Hospitality";
  if (normalized.includes("MIXED")) return "Mixed Use";
  if (normalized.includes("AGRIC")) return "Agricultural";
  if (normalized.includes("VACANT") || normalized.includes("LAND") || normalized.includes("LOT")) return "Land";
  if (normalized.includes("COMMON AREA")) return "Residential Common Area/Element";
  if (normalized.includes("MULTI") || normalized.includes("APART")) return "Multifamily";
  if (normalized.includes("CONDO")) return "Condo";
  if (normalized.includes("SINGLE") || normalized.includes("RESIDENTIAL")) return "Residential";
  return value;
}

function normalizeConfidence(value: unknown): InsightConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

function detectNoiseReason(assetType?: string | null, propertyUseCode?: string | null): NoiseReason | null {
  const haystack = `${assetType ?? ""} ${propertyUseCode ?? ""}`.toUpperCase();
  for (const rule of NOISE_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.reason;
    }
  }
  return null;
}

function parseEventDate(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function inferOwnerType(ownerNames: string[]) {
  const joined = ownerNames.join(" ").toUpperCase();
  if (!joined.trim()) return "UNKNOWN" as const;
  if (joined.includes("COUNTY") || joined.includes("CITY OF") || joined.includes("STATE OF") || joined.includes("TOWN OF")) {
    return "GOV" as const;
  }
  if (joined.includes("HOA") || joined.includes("HOMEOWNERS")) {
    return "HOA" as const;
  }
  if (joined.includes("UTILITY") || joined.includes("WATER") || joined.includes("ELECTRIC")) {
    return "UTILITY" as const;
  }
  return "PRIVATE" as const;
}

function inferDistressStage(signals: Array<{ metadata?: string | null; source?: string | null }>): DistressStage {
  if (!signals.length) return "NONE";
  const payload = signals
    .map((signal) => {
      const parsed = parseJson<Record<string, unknown>>(signal.metadata ?? null);
      return JSON.stringify(parsed ?? {}).toUpperCase();
    })
    .join(" ");
  if (payload.includes("AUCTION") || payload.includes("NOTICE OF SALE")) return "AUCTION_SCHEDULED";
  if (payload.includes("POSTPONED") || payload.includes("CANCEL")) return "AUCTION_POSTPONED_OR_CANCELLED";
  if (payload.includes("LIS PENDENS") || payload.includes("FORECLOS")) return "PRE_FORECLOSURE";
  if (payload.includes("TAX")) return "TAX_SALE_PROCESS";
  if (payload.includes("BANKRUPTCY")) return "BANKRUPTCY";
  if (payload.includes("PROBATE")) return "PROBATE_ESTATE";
  return "SIGNALS_ONLY";
}

function classifyOpportunity(input: {
  spreadToAskPct: number | null;
  spreadOutlier: boolean;
  comparableCount: number;
  completenessScore: number;
  confidence: InsightConfidence;
  distressConfirmed: boolean;
  topDrivers: string[];
  riskFlags: string[];
}): OpportunityClassificationResult {
  const spreadPassed =
    !input.spreadOutlier &&
    typeof input.spreadToAskPct === "number" &&
    input.spreadToAskPct >= OPPORTUNITY_THRESHOLDS.minSpreadPct;
  const compsPassed = input.comparableCount >= OPPORTUNITY_THRESHOLDS.minComparableCount;
  const completenessPassed = input.completenessScore >= OPPORTUNITY_THRESHOLDS.minCompletenessScore;
  const confidencePassed = input.confidence !== "low";

  const gates = {
    spread: {
      label: "Spread",
      passed: spreadPassed,
      value: input.spreadToAskPct,
      threshold: OPPORTUNITY_THRESHOLDS.minSpreadPct,
    },
    comps: {
      label: "Comps",
      passed: compsPassed,
      value: input.comparableCount,
      threshold: OPPORTUNITY_THRESHOLDS.minComparableCount,
    },
    completeness: {
      label: "Completeness",
      passed: completenessPassed,
      value: Number(input.completenessScore.toFixed(1)),
      threshold: OPPORTUNITY_THRESHOLDS.minCompletenessScore,
    },
    confidence: {
      label: "Confidence",
      passed: confidencePassed,
      value: input.confidence,
      threshold: "not low",
    },
  };

  const passedCount = [spreadPassed, compsPassed, completenessPassed, confidencePassed].filter(Boolean).length;
  let classification: DealClassification = "PIPELINE_LISTING";
  if (input.distressConfirmed) {
    classification = "DISTRESS_CANDIDATE";
  } else if (passedCount === 4) {
    classification = "TRUE_OPPORTUNITY";
  } else if (passedCount >= 2) {
    classification = "WATCHLIST";
  }

  const failedGates = Object.values(gates).filter((gate) => !gate.passed).map((gate) => gate.label);
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

  const limitedDrivers = input.topDrivers.slice(0, 3);
  const limitedRisks = input.riskFlags.slice(0, 3);
  const spreadOutlierNote = input.spreadOutlier ? " Spread signal is outlier and excluded from strict gate pass." : "";
  const classificationReason =
    classification === "TRUE_OPPORTUNITY"
      ? `Meets strict gates (spread, comps, completeness, confidence). Drivers: ${limitedDrivers.join(" | ") || "n/a"}.`
      : classification === "WATCHLIST"
        ? `Partial gate pass (${passedCount}/4). Needs work on: ${failedGates.join(", ")}.${spreadOutlierNote}`
        : classification === "DISTRESS_CANDIDATE"
          ? "Official distress signal detected. Treat as special-situation opportunity."
          : `Fails strict opportunity gates. Main risks: ${limitedRisks.join(" | ") || "insufficient pricing edge"}.${spreadOutlierNote}`;

  return {
    classification,
    classificationReason,
    gates,
    nextBestAction,
    foreclosureStatus: input.distressConfirmed ? "confirmed_by_official_source" : "not_confirmed_by_official_source",
  };
}

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildListWhere(
    params: ListDealsQueryDto,
    options?: {
      exclude?: Array<
        | "q"
        | "status"
        | "market"
        | "assetType"
        | "propertyUseCode"
        | "parcelId"
        | "source"
        | "minScore"
        | "maxScore"
        | "lane"
        | "recommendedAction"
        | "distressStage"
        | "isNoise"
        | "contactability"
        | "nextEventRange"
      >;
    }
  ): Prisma.DealWhereInput {
    const excluded = new Set(options?.exclude ?? []);
    const where: Prisma.DealWhereInput = {};

    if (!excluded.has("q") && params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { address: { contains: q, mode: "insensitive" } },
        { assetType: { contains: q, mode: "insensitive" } },
        { propertyUseCode: { contains: q, mode: "insensitive" } },
      ];
    }

    if (!excluded.has("status") && params.status?.trim()) where.status = params.status.trim();
    if (!excluded.has("market") && params.market?.trim()) where.market = params.market.trim();
    if (!excluded.has("assetType") && params.assetType?.trim()) {
      where.assetType = { contains: params.assetType.trim(), mode: "insensitive" };
    }
    if (!excluded.has("propertyUseCode") && params.propertyUseCode?.trim()) {
      where.propertyUseCode = { contains: params.propertyUseCode.trim(), mode: "insensitive" };
    }
    if (!excluded.has("parcelId") && params.parcelId?.trim()) where.parcelId = params.parcelId.trim();
    if (!excluded.has("source") && params.source?.trim()) where.source = params.source.trim();
    if (!excluded.has("lane") && params.lane?.trim()) {
      where.lane = params.lane.trim() as any;
    }
    if (!excluded.has("recommendedAction") && params.recommendedAction?.trim()) {
      where.recommendedAction = params.recommendedAction.trim() as any;
    }
    if (!excluded.has("distressStage") && params.distressStage?.trim()) {
      where.distressStage = params.distressStage.trim() as any;
    }
    if (!excluded.has("isNoise") && typeof params.isNoise === "boolean") {
      where.isNoise = params.isNoise;
    }
    if (!excluded.has("contactability") && typeof params.contactability === "number" && Number.isFinite(params.contactability)) {
      where.contactabilityScore = { gte: params.contactability };
    }
    if (!excluded.has("nextEventRange") && (params.nextEventFrom || params.nextEventTo)) {
      const range: Prisma.DateTimeNullableFilter = {};
      if (params.nextEventFrom) range.gte = new Date(params.nextEventFrom);
      if (params.nextEventTo) range.lte = new Date(params.nextEventTo);
      where.nextEventDate = range;
    }

    const minScore = !excluded.has("minScore") ? params.minScore : undefined;
    const maxScore = !excluded.has("maxScore") ? params.maxScore : undefined;
    if (minScore !== undefined || maxScore !== undefined) {
      where.score = {};
      if (minScore !== undefined) (where.score as { gte?: number }).gte = minScore;
      if (maxScore !== undefined) (where.score as { lte?: number }).lte = maxScore;
    }

    return where;
  }

  private async ensureDeal(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal) {
      throw new NotFoundException("Deal not found");
    }
    return deal;
  }

  private computeOperationalDecision(input: {
    deal: {
      assetType?: string | null;
      propertyUseCode?: string | null;
      parcelId?: string | null;
      address?: string | null;
      mailingAddress?: string | null;
      nextEventDate?: Date | null;
      contactabilityScore?: number | null;
      isNoise?: boolean | null;
      noiseReason?: string | null;
    };
    owners: Array<{ name?: string | null; phone?: string | null; email?: string | null }>;
    distressSignals: Array<{ metadata?: string | null }>;
    events: Array<{ eventType?: string | null; eventDate?: Date | null; source?: string | null }>;
    classification: DealClassification;
    completenessScore: number;
    spreadToAskPct: number | null;
    comparableCount: number;
  }): OperationalDecision {
    const ownerNames = input.owners.map((owner) => toCleanText(owner.name ?? null)).filter((item): item is string => Boolean(item));
    const ownerType = inferOwnerType(ownerNames);
    const explicitNoiseReason = input.deal.noiseReason as NoiseReason | null;
    const noiseReason = explicitNoiseReason ?? detectNoiseReason(input.deal.assetType, input.deal.propertyUseCode);
    const isNoise = Boolean(input.deal.isNoise) || Boolean(noiseReason);
    const haystack = `${input.deal.assetType ?? ""} ${input.deal.propertyUseCode ?? ""}`.toUpperCase();
    const isGovKeyword =
      haystack.includes("GOVERNMENTAL") || haystack.includes("COUNTY") || haystack.includes("CITY") || haystack.includes("STATE");
    const isGov = ownerType === "GOV" || isGovKeyword;
    const distressStage = input.distressSignals.length
      ? inferDistressStage(input.distressSignals)
      : isGov
        ? "GOVERNMENT_LAND"
        : "NONE";
    const todayMs = Date.now();
    const nextEventFromEvents = input.events
      .map((entry) => parseEventDate(entry.eventDate))
      .filter((entry): entry is Date => Boolean(entry))
      .filter((entry) => entry.getTime() >= todayMs)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const nextEventDate = nextEventFromEvents ?? input.deal.nextEventDate ?? null;
    const hasDispositionEvidence = input.events.some((entry) => {
      const eventType = (entry.eventType ?? "").toUpperCase();
      const source = (entry.source ?? "").toUpperCase();
      return (
        eventType.includes("RFP") ||
        eventType.includes("RFQ") ||
        eventType.includes("IFB") ||
        eventType.includes("SURPLUS") ||
        eventType.includes("PUBLIC_AUCTION") ||
        source.includes("GOVDEALS") ||
        source.includes("SAM.GOV")
      );
    });
    const hasDistress = input.distressSignals.length > 0;
    const hasPhone = input.owners.some((owner) => Boolean(toCleanText(owner.phone ?? null)));
    const hasEmail = input.owners.some((owner) => Boolean(toCleanText(owner.email ?? null)));
    const rawContactability =
      (input.deal.contactabilityScore ?? 0) > 0
        ? Number(input.deal.contactabilityScore)
        : clamp(
            (input.deal.mailingAddress ? 35 : 0) +
              (input.deal.address ? 15 : 0) +
              (hasPhone ? 30 : 0) +
              (hasEmail ? 20 : 0),
            0,
            100,
          );
    const contactabilityScore = Number(rawContactability.toFixed(1));

    const why: string[] = [];
    const blockers: string[] = [];
    let lane: DealLane;
    let recommendedAction: RecommendedAction;

    if (isNoise) {
      lane = "NON_ACQUIRABLE_NOISE";
      recommendedAction = "ARCHIVE";
      why.push("Use category matches non-acquirable pattern.");
      blockers.push("Non-acquirable asset category by policy.");
    } else if (!input.deal.parcelId && !input.deal.address) {
      lane = "RESEARCH_REQUIRED";
      recommendedAction = "RESEARCH";
      why.push("Missing property identifier for reliable actioning.");
      blockers.push("Need parcel ID or confirmed situs address.");
    } else if (isGov) {
      lane = "GOV_LAND_P3";
      recommendedAction = hasDispositionEvidence ? "GOV_PURSUE" : "MONITOR";
      why.push("Government-owned/use parcel routed to Gov/P3 lane.");
      if (!hasDispositionEvidence) blockers.push("No official disposition evidence yet (RFP/surplus/auction).");
    } else if (hasDistress) {
      if (distressStage === "AUCTION_SCHEDULED" || distressStage === "AUCTION_POSTPONED_OR_CANCELLED") {
        lane = "AUCTION_MONITOR";
        recommendedAction = "AUCTION_PREP";
        why.push("Distress evidence indicates auction-stage workflow.");
      } else {
        lane = "DISTRESS_OWNER";
        recommendedAction = "CONTACT_NOW";
        why.push("Official distress evidence supports direct owner/trustee action.");
      }
    } else {
      lane = "OFF_MARKET_STANDARD";
      recommendedAction =
        input.classification === "TRUE_OPPORTUNITY"
          ? "CONTACT_NOW"
          : input.classification === "WATCHLIST"
            ? "MONITOR"
            : input.completenessScore < 40
              ? "RESEARCH"
              : "MONITOR";
      why.push("Off-market workflow selected from current data quality and opportunity gates.");
    }

    if (typeof input.spreadToAskPct === "number" && input.spreadToAskPct < 10) {
      blockers.push("Spread below strict threshold (10%).");
    }
    if (input.comparableCount < 8) blockers.push("Comparable coverage below strict threshold (8).");
    if (input.completenessScore < 70) blockers.push("Data completeness below strict threshold (70%).");
    if (contactabilityScore < 50) blockers.push("Low contactability; enrich owner phone/email first.");

    return {
      lane,
      recommendedAction,
      distressStage,
      nextEventDate,
      contactabilityScore,
      isNoise,
      noiseReason,
      ownerType,
      why: why.slice(0, 3),
      blockers: blockers.slice(0, 6),
    };
  }

  private hasMissingFacts(deal: {
    lotSizeSqft: number | null;
    buildingSizeSqft: number | null;
    yearBuilt: number | null;
    zoning: string | null;
    askingPrice: number | null;
    pricePerSqft: number | null;
  }) {
    return (
      deal.lotSizeSqft === null ||
      deal.buildingSizeSqft === null ||
      deal.yearBuilt === null ||
      deal.zoning === null ||
      deal.askingPrice === null ||
      deal.pricePerSqft === null
    );
  }

  private async fetchSourceFeaturesByParcel(parcelId: string, source: string) {
    const escaped = parcelId.replace(/'/g, "''");
    const maxRows = Number(process.env.ARCGIS_MAX_ROWS || 50);

    const attempts: Array<{ url: string; where: string }> = [];

    if (source === "palm-beach-parcels") {
      const url = process.env.PALM_BEACH_PARCELS_URL;
      if (url) {
        attempts.push({ url, where: `PARID = '${escaped}'` });
        attempts.push({ url, where: `PARCEL_NUMBER = '${escaped}'` });
      }
    } else if (source === "broward-parcels") {
      const url = process.env.BROWARD_PARCELS_URL;
      if (url) {
        attempts.push({ url, where: `PARCELID = '${escaped}'` });
        attempts.push({ url, where: `LOWPARCELI = '${escaped}'` });
      }
    } else if (source === "miami-dade-parcels") {
      const configuredUrl = process.env.MIAMI_DADE_PARCELS_URL;
      if (configuredUrl) {
        attempts.push({ url: configuredUrl, where: `FOLIO = '${escaped}'` });
        attempts.push({ url: configuredUrl, where: `PARID = '${escaped}'` });
        attempts.push({ url: configuredUrl, where: `PARCEL_ID = '${escaped}'` });
      }
      attempts.push({ url: MIAMI_DADE_FALLBACK_LAYER, where: `FOLIO = '${escaped}'` });
    } else {
      return [];
    }

    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const features = await fetchArcgisWhere(attempt.url, attempt.where, maxRows);
        if (features.length) return features;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        errors.push(`${attempt.url} (${attempt.where}): ${message}`);
      }
    }

    if (errors.length) {
      throw new Error(`Fact refresh failed for ${source}: ${errors.join(" | ")}`);
    }
    return [];
  }

  private async derivePricingFallbackFacts(dealId: string, buildingSizeSqft: number | null) {
    const [metric, latestSale, latestAssessment] = await Promise.all([
      this.prisma.dealMetric.findUnique({ where: { dealId } }),
      this.prisma.mdpaSale.findFirst({
        where: { dealId, salePrice: { not: null } },
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
      }),
      this.prisma.mdpaAssessment.findFirst({
        where: {
          dealId,
          OR: [{ justValue: { not: null } }, { assessedValue: { not: null } }, { taxableValue: { not: null } }],
        },
        orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    const metricPrice = isReasonableSalePrice(metric?.price) ? metric?.price ?? null : null;
    const latestSalePrice = isReasonableSalePrice(latestSale?.salePrice) ? latestSale?.salePrice ?? null : null;
    const assessmentValue =
      [latestAssessment?.justValue, latestAssessment?.assessedValue, latestAssessment?.taxableValue].find((value) =>
        isReasonableSalePrice(value),
      ) ?? null;

    const askingPrice = metricPrice ?? latestSalePrice ?? assessmentValue;
    const pricePerSqft =
      askingPrice !== null && typeof buildingSizeSqft === "number" && buildingSizeSqft > 0
        ? askingPrice / buildingSizeSqft
        : null;

    return {
      askingPrice,
      pricePerSqft,
      pricingSource: metricPrice
        ? "deal-metric"
        : latestSalePrice
          ? "latest-sale"
          : assessmentValue
            ? "latest-assessment"
            : null,
    };
  }

  private extractFactsFromFeatures(
    features: unknown[]
  ): {
    address?: string;
    mailingAddress?: string;
    city?: string;
    municipality?: string;
    state?: string;
    zip?: string;
    propertyUseCode?: string;
    assetType?: string;
    lotSizeSqft?: number;
    buildingSizeSqft?: number;
    yearBuilt?: number;
    zoning?: string;
    askingPrice?: number;
    pricePerSqft?: number;
    latitude?: number;
    longitude?: number;
  } {
    const lotChunks: number[] = [];
    const buildingChunks: number[] = [];
    const yearChunks: number[] = [];
    const askingChunks: number[] = [];
    const pricePerSqftChunks: number[] = [];
    const latitudes: number[] = [];
    const longitudes: number[] = [];
    let address: string | undefined;
    let mailingAddress: string | undefined;
    let city: string | undefined;
    let municipality: string | undefined;
    let state: string | undefined;
    let zip: string | undefined;
    let propertyUseCode: string | undefined;
    let assetType: string | undefined;
    let zoning: string | undefined;

    for (const item of features) {
      const feature = item as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> };
      const attrs = feature.attributes ?? (item as Record<string, unknown>);
      if (!attrs || typeof attrs !== "object") continue;

      address =
        address ??
        pickField(attrs, [
          "SITUS_ADDRESS",
          "SITE_ADDR",
          "SITE_ADDRESS",
          "SITE_ADDR_STR",
          "SITEADDRES",
          "TRUE_SITE_ADDR",
          "ADDRESS",
          "PROP_ADDRESS",
        ]);
      mailingAddress =
        mailingAddress ??
        pickField(attrs, ["MAIL_ADDR", "MAILING_ADDRESS", "OWNER_MAILING_ADDRESS", "OWNER_ADDRESS", "PSTLADDRESS"]);
      city = city ?? pickField(attrs, ["SITUS_CITY", "CITY", "MUNICIPALITY", "TRUE_SITE_CITY", "CITYNAME", "PSTLCITY"]);
      municipality = municipality ?? pickField(attrs, ["MUNICIPALITY", "CITY", "SITUS_CITY", "CITYNAME"]);
      state = state ?? pickField(attrs, ["SITUS_STATE", "STATE", "PSTLSTATE"]);
      zip = zip ?? pickField(attrs, ["SITUS_ZIP", "ZIP", "ZIPCODE", "TRUE_SITE_ZIP_CODE", "ZIP1", "PSTLZIP5"]);
      propertyUseCode =
        propertyUseCode ?? pickField(attrs, ["USE_CODE", "PROPERTY_USE", "DOR_UC", "CLASS_CODE", "PROPERTY_TYPE"]);
      assetType =
        assetType ?? pickField(attrs, ["PROPERTY_USE", "USEDSCRP", "PRPRTYDSCR", "CLASSDSCRP", "DOR_DESC"]);
      zoning = zoning ?? pickField(attrs, ["ZONING", "ZONING_DESC", "ZONINGCODE", "CVTTXDSCRP", "CLASSDSCRP", "DOR_DESC"]);

      const lotSqft = toNumber(
        pickField(attrs, ["LOT_SIZE_SQFT", "LOT_SQFT", "LOTSQFT", "LAND_SQFT", "LANDSQFT", "LOTSIZE", "LOT_SIZE"])
      );
      const acres = toNumber(pickField(attrs, ["ACRES"]));
      if (typeof lotSqft === "number" && lotSqft > 0) lotChunks.push(lotSqft);
      if (typeof acres === "number" && acres > 0) lotChunks.push(acres * 43560);

      const buildingSqft = toNumber(
        pickField(attrs, [
          "BUILDING_SQFT",
          "BLDG_SQFT",
          "TOT_BUILDING_SQFT",
          "TOTBLDGAREA",
          "BLDGAREA",
          "RESFLRAREA",
          "BUILDINGAREA",
          "LIVING_AREA",
          "STATEDAREA",
          "AREA",
          "FLOOR_AREA",
          "GROSS_AREA",
          "GROSS_LIVING_AREA",
          "TOT_LVG_AREA",
        ])
      );
      if (typeof buildingSqft === "number" && buildingSqft > 0) buildingChunks.push(buildingSqft);

      const yearBuilt = toNumber(
        pickField(attrs, [
          "YEAR_BUILT",
          "YR_BUILT",
          "YRBLT",
          "RESYRBLT",
          "BUILT_YEAR",
          "ACT_YR_BLT",
          "STRUCT_YR_BLT",
          "EFF_YEAR_BUILT",
          "EFF_YR_BLT",
          "YEAR_ADDED",
        ])
      );
      if (typeof yearBuilt === "number" && yearBuilt >= 1700 && yearBuilt <= 2100) yearChunks.push(Math.round(yearBuilt));

      const askingCandidates = [
        "MARKET_VALUE",
        "JUST_VALUE",
        "ASSESSED_VALUE",
        "ASSESSED_VAL",
        "TOTAL_VALUE",
        "TOTAL_MARKET",
        "CNTASSDVAL",
        "ASSDVALYRC",
        "TXBLVALYRC",
        "LAND_VALUE",
        "LAND_MARKET",
        "IMPRV_MRKT",
        "APPRAISED_VALUE",
        "PRICE",
      ]
        .map((field) => toNumber(attrs[field]))
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      askingChunks.push(...askingCandidates);

      const ppsf = toNumber(pickField(attrs, ["PRICE_PER_SQFT", "PPSF", "MARKET_VALUE_PER_SQFT"]));
      if (typeof ppsf === "number" && ppsf > 0) pricePerSqftChunks.push(ppsf);

      const attrLat = toNumber(pickField(attrs, ["LATITUDE", "LAT", "YCOORD", "Y_COORD"]));
      const attrLng = toNumber(pickField(attrs, ["LONGITUDE", "LON", "LNG", "XCOORD", "X_COORD"]));
      const geometryPoint = extractGeometryPoint(feature);
      const lat = geometryPoint?.latitude ?? attrLat;
      const lng = geometryPoint?.longitude ?? attrLng;
      if (typeof lat === "number" && typeof lng === "number") {
        latitudes.push(lat);
        longitudes.push(lng);
      }
    }

    const lotSizeSqft = lotChunks.length ? lotChunks.reduce((sum, value) => sum + value, 0) : undefined;
    const buildingSizeSqft = buildingChunks.length ? Math.max(...buildingChunks) : undefined;
    const yearBuilt = yearChunks.length ? Math.max(...yearChunks) : undefined;
    const positiveAsking = askingChunks.filter((value) => value > 0);
    const askingPrice = positiveAsking.length
      ? Math.max(...positiveAsking)
      : askingChunks.length
        ? Math.max(...askingChunks)
        : undefined;
    const pricePerSqft =
      pricePerSqftChunks.length
        ? pricePerSqftChunks.reduce((sum, value) => sum + value, 0) / pricePerSqftChunks.length
        : askingPrice && buildingSizeSqft && buildingSizeSqft > 0
          ? askingPrice / buildingSizeSqft
          : undefined;
    const latitude = latitudes.length ? latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length : undefined;
    const longitude = longitudes.length
      ? longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length
      : undefined;

    return {
      address,
      mailingAddress,
      city,
      municipality,
      state,
      zip,
      propertyUseCode,
      assetType,
      lotSizeSqft,
      buildingSizeSqft,
      yearBuilt,
      zoning,
      askingPrice,
      pricePerSqft,
      latitude,
      longitude,
    };
  }

  private async refreshFactsForDeal(deal: {
    id: string;
    source: string | null;
    parcelId: string | null;
    address: string | null;
    mailingAddress: string | null;
    city: string | null;
    municipality: string | null;
    state: string | null;
    zip: string | null;
    assetType: string | null;
    propertyUseCode: string | null;
    lotSizeSqft: number | null;
    buildingSizeSqft: number | null;
    yearBuilt: number | null;
    zoning: string | null;
    askingPrice: number | null;
    pricePerSqft: number | null;
    dataCompletenessScore: number | null;
    latitude: number | null;
    longitude: number | null;
  }) {
    const localUpdateData: Prisma.DealUpdateInput = {};
    const inferredAssetType = inferAssetTypeFromUse(deal.propertyUseCode ?? deal.assetType);
    if (!deal.assetType && inferredAssetType) {
      localUpdateData.assetType = inferredAssetType;
    }
    if (!deal.municipality && deal.city) {
      localUpdateData.municipality = deal.city;
    }

    if (!deal.parcelId || !deal.source) {
      const localPricingFallback = await this.derivePricingFallbackFacts(deal.id, deal.buildingSizeSqft);
      if (
        (deal.askingPrice === null || deal.askingPrice <= 0) &&
        typeof localPricingFallback.askingPrice === "number" &&
        localPricingFallback.askingPrice > 0
      ) {
        localUpdateData.askingPrice = localPricingFallback.askingPrice;
      }
      if (
        (deal.pricePerSqft === null || deal.pricePerSqft <= 0) &&
        typeof localPricingFallback.pricePerSqft === "number" &&
        localPricingFallback.pricePerSqft > 0
      ) {
        localUpdateData.pricePerSqft = localPricingFallback.pricePerSqft;
      }

      const mergedLocalFacts = {
        parcelId: deal.parcelId,
        address: deal.address,
        city: (localUpdateData.municipality as string | undefined) ?? deal.city,
        zip: deal.zip,
        propertyUseCode: deal.propertyUseCode,
        lotSizeSqft: deal.lotSizeSqft,
        buildingSizeSqft: deal.buildingSizeSqft,
        yearBuilt: deal.yearBuilt,
        zoning: deal.zoning,
        askingPrice: deal.askingPrice,
        pricePerSqft: deal.pricePerSqft,
        latitude: deal.latitude,
        longitude: deal.longitude,
      };
      const localCompletenessScore = computeDealCompletenessScore(mergedLocalFacts);
      if (
        deal.dataCompletenessScore === null ||
        Number.isNaN(deal.dataCompletenessScore) ||
        Math.abs(localCompletenessScore - deal.dataCompletenessScore) >= 0.1
      ) {
        localUpdateData.dataCompletenessScore = localCompletenessScore;
      }

      if (Object.keys(localUpdateData).length) {
        await this.prisma.deal.update({
          where: { id: deal.id },
          data: localUpdateData,
        });
        return { updated: true, fieldsUpdated: Object.keys(localUpdateData) };
      }
      return { updated: false, reason: "Deal missing parcel/source" };
    }

    const features = await this.fetchSourceFeaturesByParcel(deal.parcelId, deal.source);
    const facts = features.length ? this.extractFactsFromFeatures(features) : {};
    const updateData: Prisma.DealUpdateInput = { ...localUpdateData };

    if (!deal.address && facts.address) updateData.address = facts.address;
    if (!deal.mailingAddress && facts.mailingAddress) updateData.mailingAddress = facts.mailingAddress;
    if (!deal.city && facts.city) updateData.city = facts.city;
    if (!deal.municipality && (facts.municipality || facts.city)) {
      updateData.municipality = facts.municipality ?? facts.city;
    }
    if (!deal.state && facts.state) updateData.state = facts.state;
    if (!deal.zip && facts.zip) updateData.zip = facts.zip;
    if (!deal.propertyUseCode && facts.propertyUseCode) updateData.propertyUseCode = facts.propertyUseCode;
    if (!deal.assetType) {
      const inferredFromFacts = inferAssetTypeFromUse(facts.assetType ?? facts.propertyUseCode ?? deal.propertyUseCode);
      if (inferredFromFacts) updateData.assetType = inferredFromFacts;
    }

    if (
      typeof facts.lotSizeSqft === "number" &&
      facts.lotSizeSqft > 0 &&
      (deal.lotSizeSqft === null || deal.lotSizeSqft <= 0 || facts.lotSizeSqft > deal.lotSizeSqft * 1.2)
    ) {
      updateData.lotSizeSqft = facts.lotSizeSqft;
    }
    if (
      (deal.buildingSizeSqft === null || deal.buildingSizeSqft <= 0) &&
      typeof facts.buildingSizeSqft === "number" &&
      facts.buildingSizeSqft > 0
    ) {
      updateData.buildingSizeSqft = facts.buildingSizeSqft;
    }
    if ((deal.yearBuilt === null || deal.yearBuilt < 1700) && typeof facts.yearBuilt === "number") {
      updateData.yearBuilt = facts.yearBuilt;
    }
    if (!deal.zoning && facts.zoning) updateData.zoning = facts.zoning;
    if ((deal.askingPrice === null || deal.askingPrice <= 0) && typeof facts.askingPrice === "number") {
      updateData.askingPrice = facts.askingPrice;
    }
    if ((deal.pricePerSqft === null || deal.pricePerSqft <= 0) && typeof facts.pricePerSqft === "number") {
      updateData.pricePerSqft = facts.pricePerSqft;
    }

    const projectedBuildingSize =
      (updateData.buildingSizeSqft as number | undefined) ??
      (typeof facts.buildingSizeSqft === "number" ? facts.buildingSizeSqft : undefined) ??
      deal.buildingSizeSqft;
    const pricingFallback = await this.derivePricingFallbackFacts(deal.id, projectedBuildingSize ?? null);
    if (
      (deal.askingPrice === null || deal.askingPrice <= 0) &&
      updateData.askingPrice === undefined &&
      typeof pricingFallback.askingPrice === "number" &&
      pricingFallback.askingPrice > 0
    ) {
      updateData.askingPrice = pricingFallback.askingPrice;
    }
    if (
      (deal.pricePerSqft === null || deal.pricePerSqft <= 0) &&
      updateData.pricePerSqft === undefined &&
      typeof pricingFallback.pricePerSqft === "number" &&
      pricingFallback.pricePerSqft > 0
    ) {
      updateData.pricePerSqft = pricingFallback.pricePerSqft;
    }

    if (deal.latitude === null && typeof facts.latitude === "number") updateData.latitude = facts.latitude;
    if (deal.longitude === null && typeof facts.longitude === "number") updateData.longitude = facts.longitude;

    const mergedFacts = {
      parcelId: deal.parcelId,
      address: (updateData.address as string | undefined) ?? deal.address,
      city: (updateData.city as string | undefined) ?? deal.city,
      zip: (updateData.zip as string | undefined) ?? deal.zip,
      propertyUseCode: (updateData.propertyUseCode as string | undefined) ?? deal.propertyUseCode,
      lotSizeSqft: (updateData.lotSizeSqft as number | undefined) ?? deal.lotSizeSqft,
      buildingSizeSqft: (updateData.buildingSizeSqft as number | undefined) ?? deal.buildingSizeSqft,
      yearBuilt: (updateData.yearBuilt as number | undefined) ?? deal.yearBuilt,
      zoning: (updateData.zoning as string | undefined) ?? deal.zoning,
      askingPrice: (updateData.askingPrice as number | undefined) ?? deal.askingPrice,
      pricePerSqft: (updateData.pricePerSqft as number | undefined) ?? deal.pricePerSqft,
      latitude: (updateData.latitude as number | undefined) ?? deal.latitude,
      longitude: (updateData.longitude as number | undefined) ?? deal.longitude,
    };
    const completenessScore = computeDealCompletenessScore(mergedFacts);
    if (
      deal.dataCompletenessScore === null ||
      Number.isNaN(deal.dataCompletenessScore) ||
      Math.abs(completenessScore - deal.dataCompletenessScore) >= 0.1
    ) {
      updateData.dataCompletenessScore = completenessScore;
    }

    if (!Object.keys(updateData).length) {
      return { updated: false, reason: features.length ? "No new facts available" : "No source features found" };
    }

    await this.prisma.deal.update({
      where: { id: deal.id },
      data: updateData,
    });

    return {
      updated: true,
      fieldsUpdated: Object.keys(updateData),
    };
  }

  async refreshFacts(dealId: string) {
    const deal = await this.ensureDeal(dealId);
    const result = await this.refreshFactsForDeal(deal);
    return result;
  }

  async backfillFacts(params: DealsBackfillDto = {}) {
    const startedAt = new Date();
    const limit = Math.max(1, Math.min(params.limit ?? 150, 1000));
    const onlyMissingFacts = params.onlyMissingFacts ?? true;
    const recomputeComparables = params.recomputeComparables ?? true;
    const recomputeInsights = params.recomputeInsights ?? true;
    const dryRun = params.dryRun ?? false;

    const baseWhere: Prisma.DealWhereInput = {};
    if (params.source) baseWhere.source = params.source;
    if (params.market) baseWhere.market = params.market;

    const criticalMissingWhere: Prisma.DealWhereInput = {
      ...baseWhere,
      OR: [{ buildingSizeSqft: null }, { yearBuilt: null }, { askingPrice: null }],
    };
    const extendedMissingWhere: Prisma.DealWhereInput = {
      ...baseWhere,
      OR: [
        { lotSizeSqft: null },
        { buildingSizeSqft: null },
        { yearBuilt: null },
        { zoning: null },
        { askingPrice: null },
        { pricePerSqft: null },
      ],
    };
    const prioritizedOrderBy: Prisma.DealOrderByWithRelationInput[] = [
      { dataCompletenessScore: "asc" },
      { updatedAt: "desc" },
    ];

    let deals: Awaited<ReturnType<typeof this.prisma.deal.findMany>> = [];
    if (!onlyMissingFacts) {
      deals = await this.prisma.deal.findMany({
        where: baseWhere,
        take: limit,
        orderBy: prioritizedOrderBy,
      });
    } else {
      const criticalDeals = await this.prisma.deal.findMany({
        where: criticalMissingWhere,
        take: limit,
        orderBy: prioritizedOrderBy,
      });

      if (criticalDeals.length >= limit) {
        deals = criticalDeals;
      } else {
        const excludedIds = criticalDeals.map((deal) => deal.id);
        const secondaryDeals = await this.prisma.deal.findMany({
          where: {
            ...extendedMissingWhere,
            ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
          },
          take: limit - criticalDeals.length,
          orderBy: prioritizedOrderBy,
        });
        deals = [...criticalDeals, ...secondaryDeals];
      }
    }

    const summary = {
      filters: {
        source: params.source ?? null,
        market: params.market ?? null,
        limit,
        onlyMissingFacts,
        prioritizedFields: ["buildingSizeSqft", "yearBuilt", "askingPrice"],
        recomputeComparables,
        recomputeInsights,
        dryRun,
      },
      totals: {
        candidates: deals.length,
        processed: 0,
        factUpdates: 0,
        factSkips: 0,
        compsRecomputed: 0,
        insightsRecomputed: 0,
        errors: 0,
      },
      errors: [] as Array<{ dealId: string; step: string; message: string }>,
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
    };

    if (dryRun) {
      const finishedAt = new Date();
      summary.finishedAt = finishedAt;
      summary.durationMs = finishedAt.getTime() - startedAt.getTime();
      return summary;
    }

    for (const deal of deals) {
      summary.totals.processed += 1;

      try {
        const result = await this.refreshFactsForDeal(deal);
        if (result.updated) {
          summary.totals.factUpdates += 1;
        } else {
          summary.totals.factSkips += 1;
        }
      } catch (error) {
        summary.totals.errors += 1;
        summary.errors.push({
          dealId: deal.id,
          step: "refresh-facts",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }

      if (recomputeComparables) {
        try {
          await this.recomputeComparables(deal.id);
          summary.totals.compsRecomputed += 1;
        } catch (error) {
          summary.totals.errors += 1;
          summary.errors.push({
            dealId: deal.id,
            step: "recompute-comps",
            message: error instanceof Error ? error.message : "unknown error",
          });
        }
      }

      if (recomputeInsights) {
        try {
          await this.recomputeInsights(deal.id);
          summary.totals.insightsRecomputed += 1;
        } catch (error) {
          summary.totals.errors += 1;
          summary.errors.push({
            dealId: deal.id,
            step: "recompute-insights",
            message: error instanceof Error ? error.message : "unknown error",
          });
        }
      }
    }

    const finishedAt = new Date();
    summary.finishedAt = finishedAt;
    summary.durationMs = finishedAt.getTime() - startedAt.getTime();
    return summary;
  }

  async recomputeOperationalTriage(input: { limit?: number; onlyMissingLane?: boolean } = {}) {
    const limit = Number.isFinite(input.limit) ? Math.min(Math.max(Math.round(input.limit ?? 500), 1), 5000) : 500;
    const where: Prisma.DealWhereInput = input.onlyMissingLane
      ? {
          OR: [{ lane: null }, { recommendedAction: null }, { laneUpdatedAt: null }],
        }
      : {};
    const deals = await this.prisma.deal.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        insight: true,
        owners: { include: { owner: true } },
        distressSignals: {
          where: { status: "CONFIRMED" },
          orderBy: { observedAt: "desc" },
          take: 10,
        },
        events: {
          orderBy: { eventDate: "asc" },
          take: 25,
        },
        _count: {
          select: { comparables: true },
        },
      },
    });

    const summary = {
      processed: deals.length,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    for (const deal of deals) {
      try {
        const derived = this.deriveOpportunitySignals({
          askingPrice: deal.askingPrice,
          completenessScore: deal.dataCompletenessScore,
          valuationJson: deal.insight?.valuationJson ?? null,
          fallbackComparableCount: deal._count.comparables,
          distressConfirmed: deal.distressSignals.length > 0,
        });
        const decision = this.computeOperationalDecision({
          deal,
          owners: deal.owners.map((entry) => ({
            name: entry.owner.name,
            phone: entry.owner.phone,
            email: entry.owner.email,
          })),
          distressSignals: deal.distressSignals,
          events: deal.events,
          classification: derived.classification.classification,
          completenessScore: derived.completenessScore,
          spreadToAskPct: derived.spreadToAskPct,
          comparableCount: derived.comparableCount,
        });

        const changed =
          deal.lane !== decision.lane ||
          deal.recommendedAction !== decision.recommendedAction ||
          deal.distressStage !== decision.distressStage ||
          deal.isNoise !== decision.isNoise ||
          deal.noiseReason !== decision.noiseReason ||
          Math.abs((deal.contactabilityScore ?? -1) - decision.contactabilityScore) >= 0.1 ||
          (deal.nextEventDate?.getTime() ?? 0) !== (decision.nextEventDate?.getTime() ?? 0);

        if (!changed) {
          summary.skipped += 1;
          continue;
        }

        await this.prisma.$transaction([
          this.prisma.deal.update({
            where: { id: deal.id },
            data: {
              lane: decision.lane,
              recommendedAction: decision.recommendedAction,
              distressStage: decision.distressStage,
              nextEventDate: decision.nextEventDate,
              contactabilityScore: decision.contactabilityScore,
              isNoise: decision.isNoise,
              noiseReason: decision.noiseReason,
              laneUpdatedAt: new Date(),
            },
          }),
          this.prisma.dealDecisionAudit.create({
            data: {
              dealId: deal.id,
              classification: derived.classification.classification,
              lane: decision.lane,
              recommendedAction: decision.recommendedAction,
              reasoningJson: JSON.stringify({
                why: decision.why,
                blockers: decision.blockers,
                gates: derived.classification.gates,
                spreadToAskPct: derived.spreadToAskPct,
                comparableCount: derived.comparableCount,
                completenessScore: derived.completenessScore,
              }),
              engineVersion: ENGINE_VERSION,
            },
          }),
        ]);
        summary.updated += 1;
      } catch (_error) {
        summary.errors += 1;
      }
    }

    return summary;
  }

  async list(params: ListDealsQueryDto) {
    const where = this.buildListWhere(params);

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const sortDir: Prisma.SortOrder = params.sortDir === "asc" ? "asc" : "desc";
    const sortBy = params.sortBy ?? "updatedAt";
    const baseOrderBy: Prisma.DealOrderByWithRelationInput =
      sortBy === "name"
        ? { name: sortDir }
        : sortBy === "market"
          ? { market: sortDir }
          : sortBy === "assetType"
            ? { assetType: sortDir }
            : sortBy === "propertyUseCode"
              ? { propertyUseCode: sortDir }
                : sortBy === "score"
                  ? { score: sortDir }
                  : sortBy === "lane"
                    ? { lane: sortDir }
                    : sortBy === "recommendedAction"
                      ? { recommendedAction: sortDir }
                      : sortBy === "distressStage"
                        ? { distressStage: sortDir }
                        : sortBy === "nextEventDate"
                          ? { nextEventDate: sortDir }
                          : sortBy === "contactabilityScore"
                            ? { contactabilityScore: sortDir }
                  : sortBy === "status"
                    ? { status: sortDir }
                  : { updatedAt: sortDir };
    const include = {
      metrics: true,
      owners: { include: { owner: true } },
      events: {
        orderBy: { eventDate: "asc" as const },
        take: 10,
      },
      media: {
        orderBy: { sortOrder: "asc" as const },
        take: 1,
      },
      insight: true,
      distressSignals: {
        where: { status: "CONFIRMED" },
        take: 1,
        orderBy: { observedAt: "desc" as const },
      },
      _count: {
        select: { comparables: true },
      },
    };

    const mapDeal = (item: Prisma.DealGetPayload<{ include: typeof include }>) => {
      const derived = this.deriveOpportunitySignals({
        askingPrice: item.askingPrice,
        completenessScore: item.dataCompletenessScore,
        valuationJson: item.insight?.valuationJson ?? null,
        fallbackComparableCount: item._count.comparables,
        distressConfirmed: item.distressSignals.length > 0,
      });
      const decision = this.computeOperationalDecision({
        deal: item,
        owners: item.owners.map((entry) => ({
          name: entry.owner.name,
          phone: entry.owner.phone,
          email: entry.owner.email,
        })),
        distressSignals: item.distressSignals,
        events: item.events,
        classification: derived.classification.classification,
        completenessScore: derived.completenessScore,
        spreadToAskPct: derived.spreadToAskPct,
        comparableCount: derived.comparableCount,
      });

      return {
        ...item,
        pipelineScore: item.score ?? null,
        classification: derived.classification.classification,
        lane: item.lane ?? decision.lane,
        recommendedAction: item.recommendedAction ?? decision.recommendedAction,
        distressStage: item.distressStage ?? decision.distressStage,
        nextEventDate: item.nextEventDate ?? decision.nextEventDate,
        contactabilityScore: item.contactabilityScore ?? decision.contactabilityScore,
        isNoise: item.isNoise || decision.isNoise,
        noiseReason: item.noiseReason ?? decision.noiseReason,
        ownerType: decision.ownerType,
      };
    };

    const rankClassification = (value: DealClassification) => {
      if (value === "PIPELINE_LISTING") return 1;
      if (value === "WATCHLIST") return 2;
      if (value === "TRUE_OPPORTUNITY") return 3;
      return 4;
    };

    const sortMappedRows = (rows: Array<ReturnType<typeof mapDeal>>) => {
      if (!["classification", "lane", "recommendedAction", "distressStage", "nextEventDate", "contactabilityScore"].includes(sortBy)) return rows;
      return [...rows].sort((a, b) => {
        if (sortBy === "classification") {
          const rankA = rankClassification(a.classification as DealClassification);
          const rankB = rankClassification(b.classification as DealClassification);
          if (rankA !== rankB) {
            return sortDir === "asc" ? rankA - rankB : rankB - rankA;
          }
        } else if (sortBy === "lane") {
          const laneA = String(a.lane ?? "");
          const laneB = String(b.lane ?? "");
          const result = laneA.localeCompare(laneB);
          if (result !== 0) return sortDir === "asc" ? result : -result;
        } else if (sortBy === "recommendedAction") {
          const actionA = String(a.recommendedAction ?? "");
          const actionB = String(b.recommendedAction ?? "");
          const result = actionA.localeCompare(actionB);
          if (result !== 0) return sortDir === "asc" ? result : -result;
        } else if (sortBy === "distressStage") {
          const stageA = String(a.distressStage ?? "");
          const stageB = String(b.distressStage ?? "");
          const result = stageA.localeCompare(stageB);
          if (result !== 0) return sortDir === "asc" ? result : -result;
        } else if (sortBy === "nextEventDate") {
          const timeA = a.nextEventDate ? new Date(a.nextEventDate).getTime() : Number.POSITIVE_INFINITY;
          const timeB = b.nextEventDate ? new Date(b.nextEventDate).getTime() : Number.POSITIVE_INFINITY;
          if (timeA !== timeB) return sortDir === "asc" ? timeA - timeB : timeB - timeA;
        } else if (sortBy === "contactabilityScore") {
          const scoreA = typeof a.contactabilityScore === "number" ? a.contactabilityScore : -1;
          const scoreB = typeof b.contactabilityScore === "number" ? b.contactabilityScore : -1;
          if (scoreA !== scoreB) return sortDir === "asc" ? scoreA - scoreB : scoreB - scoreA;
        }
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        return bTime - aTime;
      });
    };

    if (!params.classification && !params.ownerType && sortBy !== "classification") {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.deal.findMany({
          where,
          include,
          take: limit,
          skip: offset,
          orderBy: baseOrderBy,
        }),
        this.prisma.deal.count({ where }),
      ]);

      return { items: items.map(mapDeal), total, limit, offset };
    }

    const allRows = await this.prisma.deal.findMany({
      where,
      include,
      orderBy: baseOrderBy,
    });
    const mappedRows = sortMappedRows(allRows.map(mapDeal));
    const classificationFiltered = params.classification
      ? mappedRows.filter((row) => row.classification === params.classification)
      : mappedRows;
    const ownerTypeFiltered = params.ownerType?.trim()
      ? classificationFiltered.filter((row) => String(row.ownerType).toLowerCase() === params.ownerType?.trim().toLowerCase())
      : classificationFiltered;
    const selected = ownerTypeFiltered.slice(offset, offset + limit);

    return {
      items: selected,
      total: ownerTypeFiltered.length,
      limit,
      offset,
    };
  }

  async getFacets(params: ListDealsQueryDto = {}) {
    const [assetRows, useRows, marketRows, statusRows] = await Promise.all([
      this.prisma.deal.findMany({
        where: this.buildListWhere(params, { exclude: ["assetType"] }),
        select: { assetType: true },
      }),
      this.prisma.deal.findMany({
        where: this.buildListWhere(params, { exclude: ["propertyUseCode"] }),
        select: { propertyUseCode: true },
      }),
      this.prisma.deal.findMany({
        where: this.buildListWhere(params, { exclude: ["market"] }),
        select: { market: true },
      }),
      this.prisma.deal.findMany({
        where: this.buildListWhere(params, { exclude: ["status"] }),
        select: { status: true },
      }),
    ]);

    const aggregate = (values: Array<string | null | undefined>) => {
      const counter = new Map<string, number>();
      for (const rawValue of values) {
        const value = rawValue?.trim();
        if (!value) continue;
        counter.set(value, (counter.get(value) ?? 0) + 1);
      }
      return Array.from(counter.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    };

    return {
      assetTypes: aggregate(assetRows.map((row) => row.assetType)),
      propertyUseCodes: aggregate(useRows.map((row) => row.propertyUseCode)),
      markets: aggregate(marketRows.map((row) => row.market)),
      statuses: aggregate(statusRows.map((row) => row.status)),
    };
  }

  async getById(id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        metrics: true,
        painPoints: true,
        owners: { include: { owner: true } },
        media: { orderBy: { sortOrder: "asc" } },
        documents: true,
        comparables: { orderBy: [{ distanceMiles: "asc" }, { createdAt: "desc" }] },
        distressSignals: {
          orderBy: { observedAt: "desc" },
          take: 10,
        },
        insight: true,
      },
    });
    if (!deal) return null;

    const opportunitySummary = await this.getOpportunitySummary(id);
    return {
      ...deal,
      pipelineScore: deal.score ?? null,
      classification: opportunitySummary.classification,
      lane: deal.lane ?? opportunitySummary.lane,
      recommendedAction: deal.recommendedAction ?? opportunitySummary.recommendedAction,
      distressStage: deal.distressStage ?? opportunitySummary.distressStage,
      nextEventDate: deal.nextEventDate ?? (opportunitySummary.nextEvent ? new Date(opportunitySummary.nextEvent) : null),
      contactabilityScore: deal.contactabilityScore ?? opportunitySummary.contactability,
      isNoise: deal.isNoise || opportunitySummary.isNoise,
      noiseReason: deal.noiseReason ?? opportunitySummary.noiseReason,
    };
  }

  private missingFactFields(deal: {
    parcelId: string | null;
    address: string | null;
    city: string | null;
    zip: string | null;
    propertyUseCode: string | null;
    lotSizeSqft: number | null;
    buildingSizeSqft: number | null;
    yearBuilt: number | null;
    zoning: string | null;
    askingPrice: number | null;
    pricePerSqft: number | null;
    latitude: number | null;
    longitude: number | null;
  }) {
    return [
      deal.parcelId ? null : "parcelId",
      deal.address ? null : "address",
      deal.city ? null : "city",
      deal.zip ? null : "zip",
      deal.propertyUseCode ? null : "propertyUseCode",
      deal.lotSizeSqft ? null : "lotSizeSqft",
      deal.buildingSizeSqft ? null : "buildingSizeSqft",
      deal.yearBuilt ? null : "yearBuilt",
      deal.zoning ? null : "zoning",
      deal.askingPrice ? null : "askingPrice",
      deal.pricePerSqft ? null : "pricePerSqft",
      deal.latitude ? null : "latitude",
      deal.longitude ? null : "longitude",
    ].filter((item): item is string => Boolean(item));
  }

  private deriveOpportunitySignals(input: {
    askingPrice: number | null;
    completenessScore: number | null;
    valuationJson: string | null;
    fallbackComparableCount: number;
    topDrivers?: string[];
    riskFlags?: string[];
    distressConfirmed: boolean;
  }) {
    const valuation = parseJson<Record<string, unknown>>(input.valuationJson) ?? {};
    const estimatedValueCandidate = valuation.estimatedValue;
    const estimatedValue =
      typeof estimatedValueCandidate === "number" && Number.isFinite(estimatedValueCandidate)
        ? estimatedValueCandidate
        : null;
    const askingPrice = isReasonableSalePrice(input.askingPrice) ? input.askingPrice : null;
    const spreadToAskPct =
      estimatedValue !== null && askingPrice !== null ? safePercent(estimatedValue - askingPrice, askingPrice) : null;
    const spreadOutlier = isSpreadOutlier(spreadToAskPct);

    const valuationComparableCount = valuation.comparableCount;
    const comparableCount =
      typeof valuationComparableCount === "number" && Number.isFinite(valuationComparableCount)
        ? Math.max(0, Math.round(valuationComparableCount))
        : input.fallbackComparableCount;

    const confidence = normalizeConfidence(valuation.confidence);
    const completenessScore = Number.isFinite(input.completenessScore) ? Number(input.completenessScore) : 0;
    const topDrivers = (input.topDrivers ?? []).slice(0, 3);
    const riskFlags = (input.riskFlags ?? []).slice(0, 3);

    const classification = classifyOpportunity({
      spreadToAskPct,
      spreadOutlier,
      comparableCount,
      completenessScore,
      confidence,
      distressConfirmed: input.distressConfirmed,
      topDrivers,
      riskFlags,
    });

    return {
      spreadToAskPct,
      spreadOutlier,
      comparableCount,
      confidence,
      completenessScore,
      estimatedValue,
      classification,
    };
  }

  async getDataQuality(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal) {
      throw new NotFoundException("Deal not found");
    }

    const missingFields = this.missingFactFields(deal);

    return {
      dealId: deal.id,
      completenessScore: deal.dataCompletenessScore ?? 0,
      missingFields,
      source: deal.source ?? "unknown",
      hasGeo: typeof deal.latitude === "number" && typeof deal.longitude === "number",
      hasPricing: typeof deal.askingPrice === "number" || typeof deal.pricePerSqft === "number",
      hasBuildingFacts:
        typeof deal.buildingSizeSqft === "number" || typeof deal.yearBuilt === "number" || Boolean(deal.zoning),
      lastUpdatedAt: deal.updatedAt,
    };
  }

  async getOpportunitySummary(id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        comparables: true,
        insight: true,
        owners: { include: { owner: true } },
        events: { orderBy: { eventDate: "asc" }, take: 25 },
        distressSignals: {
          where: { status: "CONFIRMED" },
          orderBy: { observedAt: "desc" },
          take: 1,
        },
        sales: {
          orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
          take: 15,
        },
        assessments: {
          orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }],
          take: 5,
        },
      },
    });

    if (!deal) {
      throw new NotFoundException("Deal not found");
    }

    const usableComparables = deal.comparables.filter(
      (row) =>
        (typeof row.salePrice === "number" && row.salePrice > 0) ||
        (typeof row.pricePerSqft === "number" && row.pricePerSqft > 0) ||
        (typeof row.capRate === "number" && row.capRate > 0),
    );
    const usableComparableCount = usableComparables.length;

    const completeness = deal.dataCompletenessScore ?? 0;
    const completenessWeighted = (completeness / 100) * 35;
    const coverageWeighted = clamp(usableComparableCount * 1.25, 0, 25);

    const valuation = parseJson<Record<string, unknown>>(deal.insight?.valuationJson) ?? {};
    const estimatedValueCandidate = valuation.estimatedValue;
    const estimatedValue =
      typeof estimatedValueCandidate === "number" && Number.isFinite(estimatedValueCandidate)
        ? estimatedValueCandidate
        : null;
    const askingPrice = isReasonableSalePrice(deal.askingPrice) ? deal.askingPrice : null;
    const spreadToAskPct =
      estimatedValue !== null && askingPrice !== null ? safePercent(estimatedValue - askingPrice, askingPrice) : null;
    const spreadOutlier = isSpreadOutlier(spreadToAskPct);

    const spreadWeighted =
      spreadToAskPct === null
        ? 0
        : spreadToAskPct >= 25
          ? 25
          : spreadToAskPct >= 10
            ? 18
            : spreadToAskPct >= 0
              ? 12
              : spreadToAskPct >= -10
                ? 6
                : 0;
    const qualityBonus = deal.source === "mdpa" ? 8 : 4;
    const missingPenalty = clamp(this.missingFactFields(deal).length * 1.5, 0, 18);
    const score = clamp(Math.round(completenessWeighted + coverageWeighted + spreadWeighted + qualityBonus - missingPenalty), 0, 100);

    const verdict = score >= 75 ? "STRONG_BUY" : score >= 45 ? "WATCHLIST" : "HIGH_RISK";
    const confidence =
      usableComparableCount >= 12 && completeness >= 70
        ? "high"
        : usableComparableCount >= 6 && completeness >= 45
          ? "medium"
          : "low";

    const topDrivers: string[] = [];
    if (usableComparableCount >= 10) topDrivers.push(`Strong comparable coverage (${usableComparableCount} usable comps).`);
    if (spreadToAskPct !== null && !spreadOutlier && spreadToAskPct >= 10) {
      topDrivers.push(`Estimated value is ${spreadToAskPct.toFixed(1)}% above asking price.`);
    }
    if (completeness >= 70) {
      topDrivers.push(`High data completeness (${completeness.toFixed(1)}%).`);
    } else if (completeness >= 50) {
      topDrivers.push(`Moderate data completeness (${completeness.toFixed(1)}%).`);
    }
    if (!topDrivers.length) {
      topDrivers.push("Opportunity score is mostly driven by available comparables and current asking data.");
    }

    const riskFlags: string[] = [];
    if (this.missingFactFields(deal).length > 0) {
      riskFlags.push(`Missing critical facts: ${this.missingFactFields(deal).join(", ")}.`);
    }
    if (askingPrice === null) {
      riskFlags.push("No reliable asking price available; spread signal is disabled.");
    }
    if (spreadToAskPct !== null && spreadToAskPct < 0) {
      riskFlags.push("Estimated value is below current asking price.");
    }
    if (spreadOutlier) {
      riskFlags.push(
        `Spread signal outlier (${spreadToAskPct?.toFixed(1)}%). Validate asking price and valuation assumptions.`,
      );
    }
    if (usableComparableCount < 6) {
      riskFlags.push("Low comparable depth may reduce valuation reliability.");
    }
    if (!riskFlags.length) {
      riskFlags.push("No critical risk flags from current internal signals.");
    }

    const distressConfirmed = deal.distressSignals.length > 0;
    const classification = classifyOpportunity({
      spreadToAskPct,
      spreadOutlier,
      comparableCount: usableComparableCount,
      completenessScore: completeness,
      confidence,
      distressConfirmed,
      topDrivers,
      riskFlags,
    });
    const decision = this.computeOperationalDecision({
      deal,
      owners: deal.owners.map((entry) => ({
        name: entry.owner.name,
        phone: entry.owner.phone,
        email: entry.owner.email,
      })),
      distressSignals: deal.distressSignals,
      events: deal.events,
      classification: classification.classification,
      completenessScore: completeness,
      spreadToAskPct,
      comparableCount: usableComparableCount,
    });

    const limitedDrivers = topDrivers.slice(0, 3);
    const limitedRisks = riskFlags.slice(0, 3);

    return {
      dealId: deal.id,
      score,
      pipelineScore: score,
      verdict,
      confidence,
      classification: classification.classification,
      lane: deal.lane ?? decision.lane,
      recommendedAction: deal.recommendedAction ?? decision.recommendedAction,
      distressStage: deal.distressStage ?? decision.distressStage,
      nextEvent: (deal.nextEventDate ?? decision.nextEventDate)?.toISOString() ?? null,
      contactability: deal.contactabilityScore ?? decision.contactabilityScore,
      isNoise: deal.isNoise || decision.isNoise,
      noiseReason: deal.noiseReason ?? decision.noiseReason,
      ownerType: decision.ownerType,
      classificationReason: classification.classificationReason,
      gates: classification.gates,
      nextBestAction: classification.nextBestAction,
      foreclosureStatus: classification.foreclosureStatus,
      topDrivers: limitedDrivers,
      riskFlags: limitedRisks,
      blockers: decision.blockers,
      why: decision.why,
      estimatedValue,
      spreadToAskPct,
      spreadOutlier,
      comparableCount: usableComparableCount,
    };
  }

  async buildProjection(id: string, input: ProjectionScenarioDto = {}) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { insight: true },
    });
    if (!deal) {
      throw new NotFoundException("Deal not found");
    }

    const scenario = input.scenario ?? "base";
    const valuation = parseJson<Record<string, unknown>>(deal.insight?.valuationJson) ?? {};
    const estimatedValueFromInsights =
      typeof valuation.estimatedValue === "number" && Number.isFinite(valuation.estimatedValue)
        ? valuation.estimatedValue
        : null;
    const inferredAskingPrice = isReasonableSalePrice(deal.askingPrice) ? deal.askingPrice : null;
    const purchasePrice = input.purchasePrice ?? inferredAskingPrice ?? estimatedValueFromInsights ?? 0;
    const rehabCost = input.rehabCost ?? (scenario === "aggressive" ? purchasePrice * 0.12 : purchasePrice * 0.07);
    const monthlyRent =
      input.monthlyRent ??
      (scenario === "conservative" ? purchasePrice * 0.005 : scenario === "aggressive" ? purchasePrice * 0.0085 : purchasePrice * 0.0068);
    const monthlyExpenses =
      input.monthlyExpenses ??
      (scenario === "conservative"
        ? monthlyRent * 0.42
        : scenario === "aggressive"
          ? monthlyRent * 0.33
          : monthlyRent * 0.38);
    const exitCapRate = input.exitCapRate ?? (scenario === "conservative" ? 7.8 : scenario === "aggressive" ? 5.9 : 6.8);
    const holdingMonths = input.holdingMonths ?? (scenario === "aggressive" ? 18 : 24);

    const annualNOI = Math.max(0, (monthlyRent - monthlyExpenses) * 12);
    const estimatedExitValue = exitCapRate > 0 ? annualNOI / (exitCapRate / 100) : 0;
    const totalInvested = purchasePrice + rehabCost;
    const profit = estimatedExitValue - totalInvested;
    const cashOnCashPct = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

    return {
      dealId: id,
      scenario,
      warnings: purchasePrice > 0 ? [] : ["Insufficient pricing data for a reliable projection."],
      assumptions: {
        purchasePrice,
        rehabCost,
        monthlyRent,
        monthlyExpenses,
        exitCapRate,
        holdingMonths,
      },
      metrics: {
        annualNOI,
        estimatedExitValue,
        totalInvested,
        profit,
        cashOnCashPct,
      },
    };
  }

  async getOverview(id: string) {
    let deal = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        metrics: true,
        painPoints: true,
        owners: { include: { owner: true } },
      },
    });

    if (!deal) return null;

    if (this.hasMissingFacts(deal)) {
      try {
        const refreshResult = await this.refreshFactsForDeal(deal);
        if (refreshResult.updated) {
          deal = await this.prisma.deal.findUnique({
            where: { id },
            include: {
              metrics: true,
              painPoints: true,
              owners: { include: { owner: true } },
            },
          });
          if (!deal) return null;
        }
      } catch (_error) {
        // Best-effort enrichment: keep serving the overview even if source refresh fails.
      }
    }
    if (!deal) return null;
    const currentDeal = deal;

    const [media, documents, comparables, insight, sales, assessments] = await this.prisma.$transaction([
      this.prisma.dealMedia.findMany({
        where: { dealId: id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.dealDocument.findMany({
        where: { dealId: id },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.dealComparable.findMany({
        where: { dealId: id },
        orderBy: [{ distanceMiles: "asc" }, { createdAt: "desc" }],
      }),
      this.prisma.dealInsight.findUnique({
        where: { dealId: id },
      }),
      this.prisma.mdpaSale.findMany({
        where: { dealId: id },
        orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
        take: 25,
      }),
      this.prisma.mdpaAssessment.findMany({
        where: { dealId: id },
        orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }],
        take: 15,
      }),
    ]);

    const cleanComparables = comparables.filter((item) => Boolean(item.address?.trim())).map((item) => ({
      ...item,
      quality:
        typeof item.resolvedAddressConfidence === "number" && item.resolvedAddressConfidence >= 0.85
          ? "high"
          : typeof item.resolvedAddressConfidence === "number" && item.resolvedAddressConfidence >= 0.6
            ? "medium"
            : "low",
    }));

    const missingFields = this.missingFactFields(currentDeal);
    const [opportunitySummary, dataQuality] = await Promise.all([
      this.getOpportunitySummary(id),
      this.getDataQuality(id),
    ]);
    const operationalDecision = {
      lane: opportunitySummary.lane,
      recommendedAction: opportunitySummary.recommendedAction,
      distressStage: opportunitySummary.distressStage,
      nextEventDate: opportunitySummary.nextEvent,
      contactabilityScore: opportunitySummary.contactability,
      isNoise: opportunitySummary.isNoise,
      noiseReason: opportunitySummary.noiseReason,
      ownerType: opportunitySummary.ownerType,
      why: opportunitySummary.why ?? [],
      blockers: opportunitySummary.blockers ?? [],
    };
    const investmentThesis = {
      classification: opportunitySummary.classification,
      lane: opportunitySummary.lane,
      recommendedAction: opportunitySummary.recommendedAction,
      headline:
        opportunitySummary.classification === "TRUE_OPPORTUNITY"
          ? "Meets strict opportunity gates."
          : opportunitySummary.classification === "DISTRESS_CANDIDATE"
            ? "Special-situation candidate with confirmed distress signal."
            : opportunitySummary.classification === "WATCHLIST"
              ? "Partial opportunity signal. Keep under active review."
              : "Pipeline listing. No strict edge yet.",
      reason: opportunitySummary.classificationReason,
      spreadToAskPct: opportunitySummary.spreadToAskPct ?? null,
      comparableCount: opportunitySummary.comparableCount ?? 0,
      completenessScore: dataQuality.completenessScore ?? 0,
      confidence: opportunitySummary.confidence,
      foreclosureStatus: opportunitySummary.foreclosureStatus,
      gates: opportunitySummary.gates,
      nextBestAction: opportunitySummary.nextBestAction,
      drivers: opportunitySummary.topDrivers.slice(0, 3),
      risks: opportunitySummary.riskFlags.slice(0, 3),
    };
    const investmentThesisV2 = {
      verdict:
        operationalDecision.recommendedAction === "CONTACT_NOW" || operationalDecision.recommendedAction === "AUCTION_PREP"
          ? "Yes: operationally actionable"
          : operationalDecision.recommendedAction === "GOV_PURSUE"
            ? "Gov/P3: pursue procurement workflow"
            : operationalDecision.recommendedAction === "ARCHIVE"
              ? "No: non-acquirable noise"
              : "Not yet: keep in monitor/research",
      lane: operationalDecision.lane,
      action: operationalDecision.recommendedAction,
      reasons: operationalDecision.why.slice(0, 3),
      risks: operationalDecision.blockers.slice(0, 3),
      nextAction: opportunitySummary.nextBestAction,
    };

    return {
      deal: {
        ...currentDeal,
        pipelineScore: currentDeal.score ?? null,
        classification: opportunitySummary.classification,
        lane: currentDeal.lane ?? opportunitySummary.lane,
        recommendedAction: currentDeal.recommendedAction ?? opportunitySummary.recommendedAction,
        distressStage: currentDeal.distressStage ?? opportunitySummary.distressStage,
        nextEventDate: currentDeal.nextEventDate ?? (opportunitySummary.nextEvent ? new Date(opportunitySummary.nextEvent) : null),
        contactabilityScore: currentDeal.contactabilityScore ?? opportunitySummary.contactability,
        isNoise: currentDeal.isNoise || opportunitySummary.isNoise,
        noiseReason: currentDeal.noiseReason ?? opportunitySummary.noiseReason,
      },
      ownership: {
        owners: currentDeal.owners.map((entry) => ({
          id: entry.owner.id,
          name: entry.owner.name,
          mailingAddress: currentDeal.mailingAddress,
        })),
      },
      facts: {
        lotSizeSqft: currentDeal.lotSizeSqft,
        buildingSizeSqft: currentDeal.buildingSizeSqft,
        yearBuilt: currentDeal.yearBuilt,
        zoning: currentDeal.zoning,
        askingPrice: currentDeal.askingPrice,
        pricePerSqft: currentDeal.pricePerSqft,
        propertyUseCode: currentDeal.propertyUseCode,
        municipality: currentDeal.municipality ?? currentDeal.city,
      },
      assessments,
      sales,
      media,
      documents,
      comparables: cleanComparables,
      insights: insight
        ? {
            demographic: parseJson<Record<string, unknown>>(insight.demographicJson),
            climateRisk: parseJson<Record<string, unknown>>(insight.climateRiskJson),
            valuation: parseJson<Record<string, unknown>>(insight.valuationJson),
            updatedAt: insight.updatedAt,
          }
        : null,
      completeness: {
        score: currentDeal.dataCompletenessScore ?? 0,
        missingFields,
      },
      opportunitySummary,
      operationalDecision,
      dataQuality,
      investmentThesis,
      investmentThesisV2,
    };
  }

  async create(data: CreateDealDto) {
    const dataCompletenessScore = computeDealCompletenessScore({
      parcelId: data.parcelId,
      address: data.address,
      city: data.city,
      zip: data.zip,
      propertyUseCode: data.propertyUseCode,
      lotSizeSqft: data.lotSizeSqft,
      buildingSizeSqft: data.buildingSizeSqft,
      yearBuilt: data.yearBuilt,
      zoning: data.zoning,
      askingPrice: data.askingPrice,
      pricePerSqft: data.pricePerSqft,
      latitude: data.latitude,
      longitude: data.longitude,
    });
    return this.prisma.deal.create({ data: { ...data, dataCompletenessScore } });
  }

  async update(id: string, data: UpdateDealDto) {
    const current = await this.ensureDeal(id);
    const dataCompletenessScore = computeDealCompletenessScore({
      parcelId: data.parcelId ?? current.parcelId,
      address: data.address ?? current.address,
      city: data.city ?? current.city,
      zip: data.zip ?? current.zip,
      propertyUseCode: data.propertyUseCode ?? current.propertyUseCode,
      lotSizeSqft: data.lotSizeSqft ?? current.lotSizeSqft,
      buildingSizeSqft: data.buildingSizeSqft ?? current.buildingSizeSqft,
      yearBuilt: data.yearBuilt ?? current.yearBuilt,
      zoning: data.zoning ?? current.zoning,
      askingPrice: data.askingPrice ?? current.askingPrice,
      pricePerSqft: data.pricePerSqft ?? current.pricePerSqft,
      latitude: data.latitude ?? current.latitude,
      longitude: data.longitude ?? current.longitude,
    });
    return this.prisma.deal.update({ where: { id }, data: { ...data, dataCompletenessScore } });
  }

  async createMedia(dealId: string, data: CreateDealMediaDto) {
    await this.ensureDeal(dealId);

    return this.prisma.dealMedia.create({
      data: {
        dealId,
        kind: data.kind,
        url: data.url,
        caption: data.caption,
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async createDocument(dealId: string, data: CreateDealDocumentDto) {
    await this.ensureDeal(dealId);

    return this.prisma.dealDocument.create({
      data: {
        dealId,
        kind: data.kind,
        title: data.title,
        url: data.url,
      },
    });
  }

  async recomputeComparables(dealId: string) {
    const subject = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { metrics: true },
    });
    if (!subject) {
      throw new NotFoundException("Deal not found");
    }

    const candidates = await this.prisma.deal.findMany({
      where: { id: { not: dealId } },
      include: { metrics: true },
      orderBy: { updatedAt: "desc" },
      take: 1200,
    });

    const candidateIds = candidates.map((candidate) => candidate.id);
    const [candidateSales, candidateAssessments] = candidateIds.length
      ? await this.prisma.$transaction([
          this.prisma.mdpaSale.findMany({
            where: { dealId: { in: candidateIds }, salePrice: { not: null } },
            orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
          }),
          this.prisma.mdpaAssessment.findMany({
            where: { dealId: { in: candidateIds } },
            orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }],
          }),
        ])
      : [[], []];

    const latestSaleByDealId = new Map<string, number>();
    for (const sale of candidateSales) {
      if (latestSaleByDealId.has(sale.dealId)) continue;
      if (typeof sale.salePrice === "number" && sale.salePrice > 0) {
        latestSaleByDealId.set(sale.dealId, sale.salePrice);
      }
    }

    const latestAssessmentByDealId = new Map<string, number>();
    for (const assessment of candidateAssessments) {
      if (latestAssessmentByDealId.has(assessment.dealId)) continue;
      const candidateValue = [assessment.justValue, assessment.assessedValue, assessment.taxableValue].find(
        (value) => typeof value === "number" && value > 0,
      );
      if (typeof candidateValue === "number") {
        latestAssessmentByDealId.set(assessment.dealId, candidateValue);
      }
    }

    const seenKeys = new Set<string>();
    const rows = candidates
      .map((candidate) => {
        const exactAddress = toCleanText(candidate.address);
        const cityStateZip = formatAddress([candidate.city, candidate.state, candidate.zip]);
        const parcelFallback = toCleanText(candidate.parcelId)
          ? `${candidate.parcelId} - ${candidate.city ?? candidate.market ?? "Unknown area"}`
          : null;
        const normalizedAddress = exactAddress ?? cityStateZip ?? parcelFallback ?? `Deal ${candidate.id.slice(0, 8)}`;
        const resolvedAddressConfidence = exactAddress ? 1 : cityStateZip ? 0.7 : parcelFallback ? 0.5 : 0.2;

        const salePriceCandidates = [
          candidate.askingPrice,
          candidate.metrics?.price,
          latestSaleByDealId.get(candidate.id),
          latestAssessmentByDealId.get(candidate.id),
        ];
        const salePrice = salePriceCandidates.find((value) => isReasonableSalePrice(value)) ?? null;
        const derivedPricePerSqft =
          candidate.pricePerSqft ??
          (salePrice && candidate.buildingSizeSqft && candidate.buildingSizeSqft > 0
            ? salePrice / candidate.buildingSizeSqft
            : null);
        const capRate = candidate.metrics?.capRate ?? null;

        if (salePrice === null && derivedPricePerSqft === null && capRate === null) return null;

        const dedupeKey = `${normalizedAddress.toLowerCase()}|${salePrice ?? ""}|${derivedPricePerSqft ?? ""}|${capRate ?? ""}`;
        if (seenKeys.has(dedupeKey)) return null;
        seenKeys.add(dedupeKey);

        return {
          address: normalizedAddress,
          comparableDealId: candidate.id,
          resolvedAddressConfidence,
          marketMatch: subject.market && candidate.market ? subject.market === candidate.market : false,
          assetTypeMatch: subject.assetType && candidate.assetType ? subject.assetType === candidate.assetType : false,
          hasPricePerSqft: typeof derivedPricePerSqft === "number",
          hasCapRate: typeof capRate === "number",
          distanceMiles: distanceMiles(subject.latitude, subject.longitude, candidate.latitude, candidate.longitude),
          salePrice,
          pricePerSqft: derivedPricePerSqft,
          capRate,
          source: `internal:${candidate.id}`,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => {
        if (a.marketMatch !== b.marketMatch) return a.marketMatch ? -1 : 1;
        if (a.assetTypeMatch !== b.assetTypeMatch) return a.assetTypeMatch ? -1 : 1;
        if (a.hasPricePerSqft !== b.hasPricePerSqft) return a.hasPricePerSqft ? -1 : 1;
        if (a.hasCapRate !== b.hasCapRate) return a.hasCapRate ? -1 : 1;

        const left = a.distanceMiles ?? Number.MAX_SAFE_INTEGER;
        const right = b.distanceMiles ?? Number.MAX_SAFE_INTEGER;
        return left - right;
      })
      .slice(0, 20);

    await this.prisma.dealComparable.deleteMany({ where: { dealId } });
    if (rows.length) {
      await this.prisma.dealComparable.createMany({
        data: rows.map((row) => ({
          address: row.address,
          comparableDealId: row.comparableDealId,
          resolvedAddressConfidence: row.resolvedAddressConfidence,
          distanceMiles: row.distanceMiles,
          salePrice: row.salePrice,
          pricePerSqft: row.pricePerSqft,
          capRate: row.capRate,
          source: row.source,
          dealId,
        })),
      });
    }

    return {
      count: rows.length,
      dealId,
      message: rows.length ? "Comparables recomputed" : "No comparable records available",
    };
  }

  async recomputeInsights(dealId: string) {
    const subject = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { metrics: true },
    });
    if (!subject) {
      throw new NotFoundException("Deal not found");
    }

    let comparables = await this.prisma.dealComparable.findMany({ where: { dealId } });
    if (!comparables.length) {
      await this.recomputeComparables(dealId);
      comparables = await this.prisma.dealComparable.findMany({ where: { dealId } });
    }
    const sales = await this.prisma.mdpaSale.findMany({
      where: { dealId },
      orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
      take: 5,
    });
    const assessments = await this.prisma.mdpaAssessment.findMany({
      where: { dealId },
      orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }],
      take: 5,
    });

    const avgCompPricePerSqft = avg(comparables.map((item) => item.pricePerSqft));
    const medianCompPricePerSqft = median(comparables.map((item) => item.pricePerSqft));
    const avgCompCapRate = avg(comparables.map((item) => item.capRate));
    const comparableSalePrices = comparables
      .map((item) => item.salePrice)
      .filter((value): value is number => isReasonableSalePrice(value));
    const medianCompSalePrice = median(comparableSalePrices);
    const trimmedComparableSalePrices =
      medianCompSalePrice && medianCompSalePrice > 0
        ? comparableSalePrices.filter(
            (value) => value >= medianCompSalePrice / 3 && value <= medianCompSalePrice * 3,
          )
        : comparableSalePrices;
    const avgSalePrice = avg(trimmedComparableSalePrices);
    const latestRecordedSale = sales.find((row) => typeof row.salePrice === "number" || row.saleDate !== null) ?? null;
    const latestAssessment = assessments[0] ?? null;
    const usableComparableCount = comparables.filter(
      (item) =>
        typeof item.pricePerSqft === "number" ||
        typeof item.capRate === "number" ||
        typeof item.salePrice === "number",
    ).length;

    const estimatedValueFromPpsf =
      avgCompPricePerSqft && subject.buildingSizeSqft && subject.buildingSizeSqft > 0
        ? avgCompPricePerSqft * subject.buildingSizeSqft
        : null;
    const latestReasonableSale = latestRecordedSale?.salePrice;
    const subjectAskingPrice = isReasonableSalePrice(subject.askingPrice) ? subject.askingPrice : null;
    const latestReasonableAssessment = [latestAssessment?.justValue, latestAssessment?.assessedValue, latestAssessment?.taxableValue].find(
      (value) => isReasonableSalePrice(value),
    );

    const estimatedValue =
      estimatedValueFromPpsf ??
      avgSalePrice ??
      (isReasonableSalePrice(latestReasonableSale) ? latestReasonableSale : null) ??
      subjectAskingPrice ??
      latestReasonableAssessment ??
      null;

    const confidence =
      usableComparableCount >= 12 && avgCompPricePerSqft !== null
        ? "high"
        : usableComparableCount >= 6 &&
            (avgCompPricePerSqft !== null ||
              avgSalePrice !== null ||
              isReasonableSalePrice(latestRecordedSale?.salePrice) ||
              isReasonableSalePrice(latestAssessment?.justValue) ||
              isReasonableSalePrice(latestAssessment?.assessedValue) ||
              isReasonableSalePrice(latestAssessment?.taxableValue))
          ? "medium"
        : "low";

    const demographic = {
      source: "internal-v1",
      status: "partial",
      market: subject.market ?? null,
      city: subject.city ?? null,
      confidence: "low",
      summary: "Base demographics inferred from current market/city labels.",
    };

    const climateRisk = {
      source: "internal-v1",
      status: "partial",
      location: {
        latitude: subject.latitude ?? null,
        longitude: subject.longitude ?? null,
      },
      riskLevel: "unknown",
      confidence: subject.latitude && subject.longitude ? "medium" : "low",
      summary: "Geospatial coordinates available; external hazard feed pending.",
    };

    const valuation = {
      source: "internal-comps-v1",
      askingPrice: subject.askingPrice ?? null,
      subjectCapRate: subject.metrics?.capRate ?? null,
        comparableCount: comparables.length,
        usableComparableCount,
        avgCompPricePerSqft,
        medianCompPricePerSqft,
        avgCompCapRate,
        avgSalePrice,
        medianCompSalePrice,
      latestRecordedSaleDate: latestRecordedSale?.saleDate ?? null,
      latestRecordedSalePrice: latestRecordedSale?.salePrice ?? null,
      latestAssessmentYear: latestAssessment?.taxYear ?? null,
      latestAssessmentJustValue: latestAssessment?.justValue ?? null,
      latestAssessmentAssessedValue: latestAssessment?.assessedValue ?? null,
      latestAssessmentTaxableValue: latestAssessment?.taxableValue ?? null,
      estimatedValue,
      confidence,
      summary:
        usableComparableCount > 0
          ? "Valuation estimated from internal comparables."
          : "No usable comparables with pricing/cap-rate data were found.",
    };

    const insight = await this.prisma.dealInsight.upsert({
      where: { dealId },
      create: {
        dealId,
        demographicJson: JSON.stringify(demographic),
        climateRiskJson: JSON.stringify(climateRisk),
        valuationJson: JSON.stringify(valuation),
      },
      update: {
        demographicJson: JSON.stringify(demographic),
        climateRiskJson: JSON.stringify(climateRisk),
        valuationJson: JSON.stringify(valuation),
      },
    });

    return {
      dealId,
      updatedAt: insight.updatedAt,
      demographic,
      climateRisk,
      valuation,
    };
  }

  async getWorkflow(dealId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: { id: true, lane: true, recommendedAction: true, distressStage: true },
    });
    if (!deal) throw new NotFoundException("Deal not found");

    const tasks = await this.prisma.dealWorkflowTask.findMany({
      where: { dealId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    return {
      dealId,
      lane: deal.lane,
      recommendedAction: deal.recommendedAction,
      distressStage: deal.distressStage,
      tasks: tasks.map((task) => ({
        id: task.id,
        lane: task.lane,
        taskType: task.taskType,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        dueAt: task.dueAt?.toISOString() ?? null,
        ownerUserId: task.ownerUserId ?? null,
        source: task.source,
        metadata: parseJson<Record<string, unknown>>(task.metadata),
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      })),
    };
  }

  async createWorkflowTask(dealId: string, input: CreateWorkflowTaskDto) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
    if (!deal) throw new NotFoundException("Deal not found");

    const row = await this.prisma.dealWorkflowTask.create({
      data: {
        dealId,
        lane: (input.lane as Prisma.DealWorkflowTaskCreateInput["lane"]) ?? null,
        taskType: input.taskType.trim(),
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: input.priority ?? 3,
        status: (input.status as Prisma.DealWorkflowTaskCreateInput["status"]) ?? "TODO",
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        ownerUserId: input.ownerUserId ?? null,
        source: (input.source as Prisma.DealWorkflowTaskCreateInput["source"]) ?? "USER",
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });

    return {
      id: row.id,
      dealId: row.dealId,
      lane: row.lane,
      taskType: row.taskType,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      dueAt: row.dueAt?.toISOString() ?? null,
      ownerUserId: row.ownerUserId ?? null,
      source: row.source,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateWorkflowTask(dealId: string, taskId: string, input: UpdateWorkflowTaskDto) {
    const existing = await this.prisma.dealWorkflowTask.findFirst({
      where: { id: taskId, dealId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Workflow task not found");

    const row = await this.prisma.dealWorkflowTask.update({
      where: { id: taskId },
      data: {
        lane: input.lane === undefined ? undefined : (input.lane as Prisma.DealWorkflowTaskUpdateInput["lane"]),
        title: input.title?.trim(),
        description: input.description === undefined ? undefined : (input.description?.trim() || null),
        priority: input.priority,
        status: input.status as Prisma.DealWorkflowTaskUpdateInput["status"] | undefined,
        dueAt: input.dueAt === undefined ? undefined : (input.dueAt ? new Date(input.dueAt) : null),
        ownerUserId: input.ownerUserId === undefined ? undefined : input.ownerUserId,
        source: input.source as Prisma.DealWorkflowTaskUpdateInput["source"] | undefined,
        metadata: input.metadata === undefined ? undefined : (input.metadata ? JSON.stringify(input.metadata) : null),
      },
    });

    return {
      id: row.id,
      dealId: row.dealId,
      lane: row.lane,
      taskType: row.taskType,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      dueAt: row.dueAt?.toISOString() ?? null,
      ownerUserId: row.ownerUserId ?? null,
      source: row.source,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
