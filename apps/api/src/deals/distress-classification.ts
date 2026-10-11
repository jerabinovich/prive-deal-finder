import { toDorCode } from "../integrations/dor-use-codes";
import type { DistressStage } from "./deals.types";

/**
 * CLASIFICACION DE SEÑALES DE DISTRESS — 28-sep-2026
 *
 * QUE REEMPLAZA Y POR QUE. `inferDistressStage` de deals.utils.ts aplanaba TODO
 * el payload a un string y buscaba palabras sueltas. Medido contra los 63
 * expedientes reales de Broward y las 5.342 violaciones de Miami-Dade:
 *
 *   - Broward abrevia el tipo de caso como "Fore", no "Foreclosure". O sea que
 *     "Real Prop Homestead Res Fore $250,000 or More" NO contiene "FORECLOS" y
 *     los 54 foreclosures serios caian en SIGNALS_ONLY. Los 9 que la funcion si
 *     reconocia son los que escriben "Foreclosure" entero: las ejecuciones de
 *     consorcio de $1 a $15.000.
 *   - "Failure to Register Foreclosed Property" SI contiene "FORECLOS". Son 603
 *     violaciones de codigo sobre 28 deals, papeleo de registro, y quedaban
 *     clasificadas PRE_FORECLOSURE, el termino mas pesado del modelo.
 *   - Cualquier payload con "CANCEL" en cualquier campo se iba al carril de
 *     remates.
 *
 * Mismo error que dor-use-codes.ts ya documentaba: el texto engania, el campo
 * con nombre no. Aca se leen campos.
 *
 * REEMPLAZA TAMBIEN al ternario de integrations.service.ts:558, que decidia la
 * etapa por el NOMBRE DE LA FUENTE y le daba PRE_FORECLOSURE a las 63 senales
 * de Broward, incluidas las 32 de consorcios ejecutando expensas. Una funcion
 * alimentaba el carril y la otra el puntaje, y decidian distinto.
 *
 * REGLA DE NEGOCIO (JR, 28-sep-2026): cuentan como oportunidad los foreclosures
 * comerciales de cualquier monto, los residenciales desde USD 250.000, y los de
 * tierra, multifamily e industrial. Las ejecuciones de consorcio por expensas no
 * cuentan. Donde falta el dato que la regla necesita, NO dispara.
 */

export type ClaseCaso = "COMERCIAL" | "RES_HOMESTEAD" | "RES_NO_HOMESTEAD" | "OTRO";
export type BandaMonto = "HASTA_50K" | "ENTRE_50K_Y_250K" | "DESDE_250K" | "DESCONOCIDA";

export type CasoForeclosure = {
  clase: ClaseCaso;
  banda: BandaMonto;
  demandanteEsConsorcio: boolean;
  textoCaso: string;
};

export type SenalCruda = { source?: string | null; metadata?: string | null };

/** Codigos DOR que hacen interesante un caso "Other": tierra, multifamily, industrial. */
export const DOR_INTERES_EN_CASO_OTRO = new Set<string>([
  "00", "10", "40", "99",
  "03", "08",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
]);

/**
 * QUIEN EJECUTA (11-oct-2026, medido sobre los 116 expedientes reales de Broward). Broward corta el
 * demandante a unos 30 caracteres, y los bancos nacionales se llaman "National Association":
 *   - "U S BANK NATIONAL ASSOCIATION", "JPMORGAN CHASE BANK  NATIONAL AS" o "AMERANT BANK, N.A." son
 *     bancos; con la regla anterior caian como consorcio (10 casos) y la ejecucion hipotecaria se perdia.
 *   - "CORAL SPRINGS PROFESSIONAL CAMPUS MASTER ASSOCIATI" y "SUNRISE LAKES CONDO APTS PHASE 3" son
 *     consorcios cortados que la regla anterior no veia.
 * Las palabras propias de un consorcio (condo, homeowners, HOA, POA, community o master association)
 * deciden solas. "Association" a secas decide solo si no hay senal de prestamista.
 */
const RE_CONSORCIO_FUERTE =
  /(CONDO|HOMEOWNER|\bHOA\b|\bPOA\b|PROPERTY OWNERS|\b(COMMUNITY|MASTER|OWNERS|CLUB|TOWNHOMES?|ESTATES)\s+ASSOC)/;
const RE_ASOCIACION = /(ASSOCIAT|\bASSOC\b|\bASSN\b)/;
const RE_PRESTAMISTA =
  /(\bBANK\b|NATIONAL\s+AS|\bN\.?\s?A\.?(?=[\s,]|$)|MORTGAGE|TRUST\s+CO|\bLOAN|SAVINGS|CREDIT\s+UNION|LENDING|FUNDING|FINANC|SERVICING|\bFSB\b)/;

export function esDemandanteConsorcio(demandante: string): boolean {
  const d = demandante.toUpperCase();
  if (RE_CONSORCIO_FUERTE.test(d)) return true;
  return RE_ASOCIACION.test(d) && !RE_PRESTAMISTA.test(d);
}
const ESTADOS_VIGENTES = new Set(["LIEN", "OPEN", "REFERRED TO INTERNAL COMPLIANCE"]);
export const MINIMO_VIOLACIONES_VIGENTES = 3;

function leerJson(value?: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function texto(record: Record<string, unknown>, clave: string): string {
  const v = record[clave];
  return typeof v === "string" ? v.trim() : "";
}

export function clasificarClaseCaso(textoCaso: string): ClaseCaso {
  const t = textoCaso.toUpperCase();
  if (/\bCOMM\b|COMMERCIAL/.test(t)) return "COMERCIAL";
  if (/NONHOMESTEAD|NON-HOMESTEAD|NHMSTD/.test(t)) return "RES_NO_HOMESTEAD";
  if (/HOMESTEAD/.test(t)) return "RES_HOMESTEAD";
  return "OTRO";
}

export function clasificarBanda(textoCaso: string): BandaMonto {
  const t = textoCaso.toUpperCase();
  if (/250,?000 OR MORE|250K OR MORE/.test(t)) return "DESDE_250K";
  if (/BETWEEN \$?50,?000 AND \$?250,?000|50K TO \$?250K/.test(t)) return "ENTRE_50K_Y_250K";
  if (/50,?000 OR LESS/.test(t)) return "HASTA_50K";
  const montos = (t.match(/\$\s?[\d,]+/g) ?? [])
    .map((m) => Number(m.replace(/[^\d]/g, "")))
    .filter((n) => n > 0);
  if (!montos.length) return "DESCONOCIDA";
  const max = Math.max(...montos);
  if (max >= 250000) return "DESDE_250K";
  if (max > 50000) return "ENTRE_50K_Y_250K";
  return "HASTA_50K";
}

export function leerCasoForeclosure(metadata?: string | null): CasoForeclosure {
  const raw = leerJson(metadata);
  const interno = (raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}) as Record<string, unknown>;
  const textoCaso = texto(interno, "Case_Type") || texto(raw, "caseTypeCode") || texto(raw, "caseTypeDescription");
  const caption = (texto(raw, "caption") || texto(interno, "Caption")).toUpperCase();
  const demandante = caption.split("PLAINTIFF")[0] ?? caption;
  return {
    clase: clasificarClaseCaso(textoCaso),
    banda: clasificarBanda(textoCaso),
    demandanteEsConsorcio: esDemandanteConsorcio(demandante),
    textoCaso,
  };
}

/** La regla de JR. Sin el dato que necesita, devuelve false: no dispara. */
export function esForeclosureDeInteres(caso: CasoForeclosure, propertyUseCode?: string | null): boolean {
  if (!caso.textoCaso) return false;
  if (caso.demandanteEsConsorcio) return false;
  if (caso.banda === "DESCONOCIDA") return false;
  if (caso.clase === "COMERCIAL") return true;
  if (caso.clase === "RES_HOMESTEAD" || caso.clase === "RES_NO_HOMESTEAD") return caso.banda === "DESDE_250K";
  const dor = toDorCode(propertyUseCode ?? undefined);
  return dor ? DOR_INTERES_EN_CASO_OTRO.has(dor) : false;
}

export type ResumenCodeEnforcement = {
  vigentes: number;
  reoPosible: boolean;
  tipos: string[];
};

export function resumirCodeEnforcement(signals: SenalCruda[]): ResumenCodeEnforcement {
  let vigentes = 0;
  let reoPosible = false;
  const tipos = new Set<string>();
  for (const s of signals) {
    const raw = leerJson(s.metadata);
    const estado = texto(raw, "STAT_DESC").toUpperCase();
    const problema = texto(raw, "PROBLEM_DESC").toUpperCase();
    if (ESTADOS_VIGENTES.has(estado)) vigentes += 1;
    if (/FAILURE TO REGISTER FORECLOSED/.test(problema)) reoPosible = true;
    if (problema) tipos.add(problema);
  }
  return { vigentes, reoPosible, tipos: [...tipos] };
}

export type DecisionDistress = {
  stage: DistressStage;
  motivo: string;
  foreclosuresDeInteres: number;
  foreclosuresDescartados: number;
  codeEnforcementVigentes: number;
  reoPosible: boolean;
};

const ORDEN: Record<string, number> = {
  AUCTION_SCHEDULED: 6, PRE_FORECLOSURE: 5, TAX_SALE_PROCESS: 4,
  CODE_ENFORCEMENT: 3, SIGNALS_ONLY: 2, NONE: 1,
};

/**
 * Unica funcion que decide la etapa. La usan el carril y el puntaje, para que
 * no puedan volver a decir cosas distintas del mismo deal.
 *
 * AUCTION_SCHEDULED no se puede alcanzar todavia: hace falta el calendario de
 * remates judiciales, que no esta conectado. Eso es el techo de 55 que score.ts
 * ya documenta, y se ve, no se tapa.
 */
export function decidirDistress(signals: SenalCruda[], propertyUseCode?: string | null): DecisionDistress {
  const foreclosures = signals.filter((s) => (s.source ?? "").includes("foreclosure"));
  const codeEnf = signals.filter((s) => (s.source ?? "").includes("code-enforcement"));

  let deInteres = 0;
  for (const s of foreclosures) {
    if (esForeclosureDeInteres(leerCasoForeclosure(s.metadata), propertyUseCode)) deInteres += 1;
  }
  const descartados = foreclosures.length - deInteres;
  const ce = resumirCodeEnforcement(codeEnf);

  let stage: DistressStage = "NONE";
  let motivo = "sin senal de distress";

  if (deInteres > 0) {
    stage = "PRE_FORECLOSURE";
    motivo = `${deInteres} foreclosure(s) que cumplen el criterio`;
  } else if (ce.vigentes >= MINIMO_VIOLACIONES_VIGENTES) {
    stage = "SIGNALS_ONLY";
    motivo = `${ce.vigentes} violaciones de codigo vigentes`;
  } else if (descartados > 0 || ce.vigentes > 0) {
    stage = "SIGNALS_ONLY";
    motivo = descartados > 0 ? `${descartados} foreclosure(s) fuera de criterio` : "violaciones de codigo aisladas";
  }

  if (ORDEN[stage] === undefined) stage = "SIGNALS_ONLY";

  return {
    stage,
    motivo,
    foreclosuresDeInteres: deInteres,
    foreclosuresDescartados: descartados,
    codeEnforcementVigentes: ce.vigentes,
    reoPosible: ce.reoPosible,
  };
}
