import { detectNoiseReason, inferOwnerType } from "../deals/deals.utils";
import type { NoiseReason } from "../deals/deals.types";

/**
 * SCORE DE TRIAGE (ingesta) — 12-sep-2026
 *
 * QUE REEMPLAZA Y POR QUE. La version anterior sumaba puntos por tener parcelId,
 * direccion, ciudad, zip y dueno: media COMPLETITUD DEL REGISTRO, no oportunidad.
 * Consecuencia medida: de 72 deals, 46 daban 100 y los "mejores" eran una parcela
 * de ferrocarril, un baldio del condado y un area comun. Ademas duplicaba a
 * `dataCompletenessScore`, que ya mide exactamente eso y se guarda aparte.
 *
 * QUE MIDE AHORA: "vale la pena que un humano mire esta parcela". NO es el Deal
 * Score. El Deal Score de verdad es PRIVE_SCORING_PLAYBOOK.md (implementado en
 * brain-ai-prive/scripts/scoring.py v2.1) y necesita underwriting: retorno vs
 * target, entitlements, control, exit. Un registro de catastro no tiene nada de
 * eso. Este score es el filtro ANTES de ese analisis.
 *
 * ALINEACION: los pesos de mercado (20) y tipo de activo (15) son los del
 * playbook, no inventados. La escalera de activos es la del playbook:
 * Multifamily/Mixed-Use/Land 15 · Industrial 12 · Hospitality 10 · Otro 5.
 *
 * TECHO DELIBERADO: sin fuentes de foreclosure conectadas, el maximo alcanzable
 * es 55. Que nada pase de 55 NO es un bug: es la senal visible de que falta la
 * entrada principal del sistema. El score viejo tapaba eso dando 100.
 */

export const TRIAGE_SCORE_VERSION = "triage-v2-playbook-aligned";

/** Sin distress, el techo es este. Verlo en el maximo = faltan las fuentes judiciales. */
export const MAX_SCORE_WITHOUT_DISTRESS = 55;

const CORE_SOUTH_FLORIDA = [
  "MIAMI-DADE", "MIAMI DADE", "MIAMI", "BROWARD", "FORT LAUDERDALE", "HOLLYWOOD",
  "PALM BEACH", "WEST PALM BEACH", "JUPITER", "BOCA RATON", "DELRAY",
  "MONROE", "KEY WEST", "FLORIDA KEYS", "CORAL GABLES", "AVENTURA", "DORAL",
  "HIALEAH", "HOMESTEAD", "MIAMI BEACH", "SUNNY ISLES", "POMPANO", "DEERFIELD",
];

/** Escalera de activos del playbook (§Core Score · "Tipo de activo", max 15). */
function assetFitPoints(haystack: string): { points: number; label: string } {
  if (/MULTI[- ]?FAMILY|MULTIFAMILY|MIXED[- ]?USE|VACANT LAND|VACANT RESIDENTIAL|VACANT COMMERCIAL|\bLAND\b/.test(haystack))
    return { points: 15, label: "activo core (multifamily / mixed-use / land)" };
  if (/INDUSTRIAL|WAREHOUSE|WAREH|DISTRIBUTION|TERMINAL|FLEX/.test(haystack))
    return { points: 12, label: "industrial" };
  if (/HOTEL|MOTEL|HOSPITALITY|RESORT/.test(haystack))
    return { points: 10, label: "hospitality" };
  return { points: 5, label: "otro tipo de activo" };
}

function marketFitPoints(city?: string, municipality?: string, state?: string) {
  const hay = `${city ?? ""} ${municipality ?? ""}`.toUpperCase();
  if (CORE_SOUTH_FLORIDA.some((m) => hay.includes(m)))
    return { points: 20, label: "mercado core (South Florida)" };
  if ((state ?? "").toUpperCase() === "FL")
    return { points: 10, label: "Florida, fuera del core" };
  return { points: 3, label: "mercado periferico" };
}

export type TriageScoreResult = {
  score: number;
  isNoise: boolean;
  noiseReason: NoiseReason | null;
  reasons: string[];
  version: string;
};

export function computeTriageScore(params: {
  assetType?: string | null;
  propertyUseCode?: string | null;
  ownerNames?: string[];
  city?: string | null;
  municipality?: string | null;
  state?: string | null;
  yearBuilt?: number | null;
  lotSizeSqft?: number | null;
  /** Etapa de distress si ya hay senal oficial. Hoy siempre NONE: faltan las fuentes. */
  distressStage?: string | null;
}): TriageScoreResult {
  const reasons: string[] = [];

  // --- GATE 1: ruido no adquirible (ferrocarril, calzada, area comun, utility...) ---
  const noiseReason = detectNoiseReason(params.assetType, params.propertyUseCode);
  if (noiseReason) {
    return {
      score: 0, isNoise: true, noiseReason,
      reasons: [`descartado: ${noiseReason.toLowerCase()} — no es adquirible`],
      version: TRIAGE_SCORE_VERSION,
    };
  }

  // --- GATE 2: el dueno no puede vender (gobierno, HOA, utility) ---
  const ownerType = inferOwnerType(params.ownerNames ?? []);
  if (ownerType === "GOV" || ownerType === "UTILITY" || ownerType === "HOA") {
    return {
      score: 0, isNoise: true, noiseReason: ownerType === "UTILITY" ? "UTILITY" : "UNKNOWN",
      reasons: [`descartado: propietario ${ownerType} — no transacciona`],
      version: TRIAGE_SCORE_VERSION,
    };
  }

  let score = 0;

  const market = marketFitPoints(params.city ?? undefined, params.municipality ?? undefined, params.state ?? undefined);
  score += market.points;
  reasons.push(`${market.label} (+${market.points})`);

  const hay = `${params.assetType ?? ""} ${params.propertyUseCode ?? ""}`.toUpperCase();
  const asset = assetFitPoints(hay);
  score += asset.points;
  reasons.push(`${asset.label} (+${asset.points})`);

  // --- DISTRESS: el termino dominante. Hoy da 0 porque no hay fuentes judiciales. ---
  const stage = (params.distressStage ?? "NONE").toUpperCase();
  const distress: Record<string, number> = {
    AUCTION_SCHEDULED: 45, PRE_FORECLOSURE: 40, TAX_SALE_PROCESS: 35,
    BANKRUPTCY: 30, PROBATE_ESTATE: 30, CODE_ENFORCEMENT: 20,
    AUCTION_POSTPONED_OR_CANCELLED: 15, SIGNALS_ONLY: 10,
  };
  if (distress[stage]) {
    score += distress[stage];
    reasons.push(`distress ${stage} (+${distress[stage]})`);
  }

  // --- Propietario: quien decide del otro lado ---
  if (ownerType === "PRIVATE") {
    const joined = (params.ownerNames ?? []).join(" ").toUpperCase();
    const corporate = /\b(LLC|INC|CORP|LP|LTD|TRUST|PARTNERS|HOLDINGS|PROPERTIES|GROUP)\b/.test(joined);
    score += corporate ? 10 : 6;
    reasons.push(corporate ? "propietario corporativo identificable (+10)" : "propietario particular (+6)");
  }

  // --- Senales blandas de redesarrollo ---
  if (typeof params.yearBuilt === "number" && params.yearBuilt > 0 && params.yearBuilt <= 1980) {
    score += 5;
    reasons.push(`construido en ${params.yearBuilt} — posible redesarrollo (+5)`);
  }
  if (typeof params.lotSizeSqft === "number" && params.lotSizeSqft >= 10000) {
    score += 5;
    reasons.push("lote >= 10.000 sqft (+5)");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    isNoise: false, noiseReason: null, reasons,
    version: TRIAGE_SCORE_VERSION,
  };
}

/** Compatibilidad: los ingests solo guardan el numero. El detalle vive en computeTriageScore. */
export function computeScore(params: Parameters<typeof computeTriageScore>[0]): number {
  return computeTriageScore(params).score;
}
