import { decidirDistress } from "./distress-classification";
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

  // 13-sep-2026: ArcGIS devuelve las claves CALIFICADAS cuando la capa es un join.
  // Broward (BCPA) manda "SQLGIS02.dbo.BCPA_INFO.NAME_LINE_1" en vez de "NAME_LINE_1",
  // asi que la busqueda exacta de arriba no encontraba NADA y el condado entero
  // entraba sin dueno ni direccion. Segunda pasada: comparar por el ultimo segmento.
  for (const key of keys) {
    const suffix = `.${key}`;
    for (const [recordKey, value] of Object.entries(record)) {
      if (!recordKey.endsWith(suffix)) continue;
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
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

/**
 * 25-oct-2026 (decision de JR): askingPrice es el precio que pide alguien, y solo existe en listings y brokers. Una
 * parcela del condado no tiene precio pedido: la tasacion y la ultima venta quedan como referencia, con su fuente, en
 * MdpaAssessment y MdpaSale. Antes se copiaba la tasacion a askingPrice y el spread comparaba la valuacion contra la
 * tasacion como si fuera un precio pedido.
 */
export function esFuenteDeParcelas(source?: string | null) {
  const s = (source ?? "").trim().toLowerCase();
  return s.endsWith("-parcels") || s === "mdpa";
}

/** La unica cuenta de completitud. En parcelas no cuentan askingPrice ni pricePerSqft, que alli no existen. */
export function computeDealCompletenessScore(input: {
  parcelId?: string | null; address?: string | null; city?: string | null; zip?: string | null;
  propertyUseCode?: string | null; lotSizeSqft?: number | null; buildingSizeSqft?: number | null;
  yearBuilt?: number | null; zoning?: string | null; askingPrice?: number | null;
  pricePerSqft?: number | null; latitude?: number | null; longitude?: number | null;
  source?: string | null;
}) {
  const conPrecio = !esFuenteDeParcelas(input.source);
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
    ...(conPrecio ? [
      typeof input.askingPrice === "number" && input.askingPrice > 0,
      typeof input.pricePerSqft === "number" && input.pricePerSqft > 0,
    ] : []),
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

/**
 * 15-oct-2026: gobierno por nombre, pero no una entidad privada que nombra un condado o una ciudad. "United Way
 * of Broward County Inc" o "County Line Plaza LLC" contaban como gobierno por decir COUNTY. Un nombre con forma de
 * empresa o de entidad privada no es gobierno, salvo "municipal corporation". Se suma Village of (Wellington).
 */
// 25-oct-2026 (revision de Codex del PR 26): con "gobierno es ruido", el dueno decide cuando el codigo de uso no es de
// gobierno. Se suman el gobierno federal, los departamentos y juntas del estado, las autoridades publicas (aeropuerto,
// vivienda, puerto) y los distritos especiales (parques, hospital, agua). Medido el 25-oct sobre las parcelas que no
// eran ruido: Boca Raton Airport Authority, Boca Raton Housing Authority, Housing Authority of the City, Greater Boca
// Raton Beach & Park Dist y Lower Fl Keys Hospital Dist. El filtro de forma privada (LLC, INC...) sigue mandando.
const RE_GOBIERNO = new RegExp([
  "COUNTY", "CITY OF", "STATE OF", "TOWN OF", "VILLAGE OF", "UNITED STATES",
  // Segunda revision de Codex: "BOARD OF TRUSTEES" y "DEPARTMENT OF" solos tambien los usan entidades privadas
  // (la junta de una universidad privada). Van atados al gobierno: el fondo estatal de tierras y los departamentos
  // del estado o de la nacion, y transporte.
  "\\b(FLORIDA|FLA|FL|U ?S|UNITED STATES) (DEPARTMENT|DEPT) OF\\b", "\\b(DEPARTMENT|DEPT) OF TRANSPORTATION\\b",
  "INTERNAL IMPROVEMENT", "\\bAUTHORITY\\b",
  "\\b(PARK|HOSPITAL|WATER|DRAINAGE|SCHOOL|FIRE|SPECIAL|MGMT|MANAGEMENT|IMPROVEMENT|SOIL|MOSQUITO|INLET|PORT|TRANSIT|INDEPENDENT) (DIST|DISTRICT)\\b",
].join("|"));
const RE_PRIVADO =
  /\b(INC|INCORPORATED|LLC|L L C|LLP|LP|LTD|CORP|CORPORATION|COMPANY|FOUNDATION|ASSOCIATION|ASSN|ASSOC|CHURCH|MINISTRIES|BANK|CLUB|UNITED WAY|HOLDINGS|PROPERTIES|PARTNERS)\b/;

export function esNombreDeGobierno(nombre: string): boolean {
  const n = nombre.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!RE_GOBIERNO.test(n)) return false;
  return !RE_PRIVADO.test(n) || /MUNICIPAL CORP/.test(n);
}

/**
 * TIERRA DE CONSERVACION (16-oct-2026, JR: "Quita P3"). En Jupiter Island, 59 parcelas federales del refugio de
 * fauna (el dueno figura como UNITED STATES OF AMERICA y el domicilio es "C/O FISH & WILDLIFE SERVICE") entraban a
 * GOV_LAND_P3 por su codigo DOR 88, y 2 de Nature Conservancy tambien. No es tierra que un gobierno vaya a licitar
 * ni que un dueno privado venda: es conservacion. Se reconoce por el dueno (una entidad de conservacion) o por el
 * domicilio postal de una agencia de conservacion. El domicilio solo cuenta con el nombre completo de la agencia:
 * una calle "Conservancy Dr" o "Audubon Ave" no es una agencia. Un consorcio con "Conservancy" en el nombre sigue
 * siendo consorcio. El rol corta el nombre del dueno en 30 a 33 letras ("OCEAN REEF CONSERVATION ASSOCI"): la
 * palabra que sigue a CONSERVATION puede venir cortada.
 */
const RE_DUENO_CONSERVACION =
  /\b(FISH (AND|&) WILDLIFE|WILDLIFE REFUGE|CONSERVANCY|NATIONAL PARK SERVICE|AUDUBON SOCIETY|CONSERVATION (FUND|ASSOC\w*|ASSN|COMMISSION|DISTRICT|FOUNDATION|TRUST|SOCIETY|LANDS?))\b/;
const RE_DOMICILIO_CONSERVACION =
  /\b(FISH (AND|&) WILDLIFE SERVICE|FISH AND WILDLIFE CONSERVATION COMMISSION|NATIONAL PARK SERVICE|WILDLIFE REFUGE)\b/;
const RE_CONSORCIO = /\b(HOMEOWNERS|HOA|CONDOMINIUM|CONDO|PROPERTY OWNERS|MASTER ASSOCIATION|COMMUNITY ASSOCIATION)\b/;

export function esConservacion(ownerNames: string[], mailingAddress?: string | null): boolean {
  const limpio = (t: string) => t.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const porDueno = ownerNames.some((n) => {
    const t = limpio(String(n ?? ""));
    return RE_DUENO_CONSERVACION.test(t) && !RE_CONSORCIO.test(t);
  });
  return porDueno || RE_DOMICILIO_CONSERVACION.test(limpio(String(mailingAddress ?? "")));
}

export function inferOwnerType(ownerNames: string[]) {
  const joined = ownerNames.join(" ").toUpperCase();
  if (!joined.trim()) return "UNKNOWN" as const;
  if (ownerNames.some((n) => esNombreDeGobierno(String(n ?? "")))) return "GOV" as const;
  if (joined.includes("HOA") || joined.includes("HOMEOWNERS")) return "HOA" as const;
  if (joined.includes("UTILITY") || joined.includes("WATER") || joined.includes("ELECTRIC")) return "UTILITY" as const;
  return "PRIVATE" as const;
}

/**
 * 28-sep-2026: la version anterior aplanaba TODO el payload y buscaba palabras.
 * Medido sobre los expedientes reales, clasificaba mal 62 de 238 deals: mandaba
 * a PRE_FORECLOSURE 28 violaciones de "Failure to Register Foreclosed Property"
 * y no reconocia los 23 foreclosures serios, porque Broward abrevia "Fore".
 * El detalle esta en distress-classification.ts, que lee campos con nombre.
 */
export function inferDistressStage(
  signals: Array<{ source?: string | null; metadata?: string | null }>,
  propertyUseCode?: string | null,
): import("./deals.types").DistressStage {
  return decidirDistress(signals, propertyUseCode).stage;
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
