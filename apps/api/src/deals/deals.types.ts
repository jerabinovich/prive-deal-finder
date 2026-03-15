export const EARTH_RADIUS_MILES = 3958.8;
export const MIAMI_DADE_FALLBACK_LAYER =
  "https://gisweb.miamidade.gov/arcgis/rest/services/MD_Emaps/MapServer/72";
export const MIN_COMPARABLE_SALE_PRICE = 1000;
export const MAX_COMPARABLE_SALE_PRICE = 1_000_000_000;

export type DealClassification =
  | "PIPELINE_LISTING"
  | "WATCHLIST"
  | "TRUE_OPPORTUNITY"
  | "DISTRESS_CANDIDATE";

export type InsightConfidence = "high" | "medium" | "low";

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

export type OpportunityGateStatus = {
  label: string;
  passed: boolean;
  value: number | string | null;
  threshold: number | string;
};

export type OpportunityClassificationResult = {
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

export type OperationalDecision = {
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

export const OPPORTUNITY_THRESHOLDS = {
  minSpreadPct: 10,
  minComparableCount: 8,
  minCompletenessScore: 70,
} as const;

export const SPREAD_SANITY = {
  minPct: -90,
  maxPct: 250,
} as const;

export const ENGINE_VERSION = "operational-triage-v1";

export const NOISE_RULES: Array<{ reason: NoiseReason; keywords: string[] }> = [
  { reason: "UNKNOWN", keywords: ["VACANT GOVERNMENTAL", "VACANT LAND - GOVERNMENTAL"] },
  { reason: "COMMON_AREA", keywords: ["COMMON AREA", "COMMON AREA/ELEMENT", "REC AREA"] },
  { reason: "ROADWAY", keywords: ["ROADWAY"] },
  { reason: "RAILROAD", keywords: ["RAILROAD"] },
  { reason: "CENTRALLY_ASSESSED", keywords: ["CENTRALLY ASSESSED"] },
  { reason: "UTILITY", keywords: ["UTILITY"] },
];
