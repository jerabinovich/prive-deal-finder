/**
 * La decision operativa de un deal: carril, accion, etapa de distress y ruido (10-oct-2026).
 *
 * POR QUE EXISTE. Habia dos copias de esta funcion: DealsTriageService (la usa el analisis de un
 * deal) y DealsService (la usan el recalculo diario de carriles y la ficha). Se separaron: la de
 * DealsService conservaba el pestillo de ruido (`Boolean(deal.isNoise) || motivo guardado`), y por
 * eso seis terrenos publicos del downtown de Miami, marcados ruido por una regla vieja, no salian
 * nunca de NON_ACQUIRABLE_NOISE. Ahora hay una sola decision y las dos clases la llaman.
 * El ruido se evalua siempre de nuevo con evaluarRuido: no hay marcas manuales de ruido (las
 * acciones "noise" del chat solo filtran la lista).
 */
import { evaluarRuido } from "../scoring/score";
import { DealClassification, DealLane, DistressStage, OperationalDecision, RecommendedAction } from "./deals.types";
import { clamp, inferDistressStage, inferOwnerType, parseEventDate, toCleanText } from "./deals.utils";

export type EntradaDecision = {
    deal: {
      assetType?: string | null; propertyUseCode?: string | null; parcelId?: string | null;
      address?: string | null; mailingAddress?: string | null; nextEventDate?: Date | null;
      contactabilityScore?: number | null; isNoise?: boolean | null; noiseReason?: string | null;
    };
    owners: Array<{ name?: string | null; phone?: string | null; email?: string | null }>;
    distressSignals: Array<{ metadata?: string | null }>;
    events: Array<{ eventType?: string | null; eventDate?: Date | null; source?: string | null }>;
    classification: DealClassification;
    completenessScore: number;
    spreadToAskPct: number | null;
    comparableCount: number;
  };

/**
 * Inmueble de un gobierno (25-oct-2026): tierra P3 por codigo DOR o dueno de gobierno. Es la regla con la que
 * decidirOperacion pone GOVERNMENT_LAND a un deal sin senales; la usa tambien recalcularDistressYPuntaje
 * (rescore-distress.ts), que antes los pasaba a NONE (941 deals medidos el 25-oct).
 */
export function esInmuebleDeGobierno(
  deal: { assetType?: string | null; propertyUseCode?: string | null; mailingAddress?: string | null },
  nombres: Array<string | null | undefined>,
): boolean {
  const ownerNames = nombres.map((n) => toCleanText(n ?? null)).filter((n): n is string => Boolean(n));
  const gates = evaluarRuido({
    assetType: deal.assetType,
    propertyUseCode: deal.propertyUseCode,
    ownerNames,
    mailingAddress: deal.mailingAddress,
  });
  return gates.esTierraP3 || inferOwnerType(ownerNames) === "GOV";
}

export function decidirOperacion(input: EntradaDecision): OperationalDecision {
    const ownerNames = input.owners.map((o) => toCleanText(o.name ?? null)).filter((n): n is string => Boolean(n));
    const ownerType = inferOwnerType(ownerNames);
    // 28-sep-2026: el ruido se pregunta UNA vez, a evaluarRuido, en vez de
    // heredar el valor guardado con un OR, que era un pestillo del que un deal
    // no podia salir aunque la regla cambiara. Y P3 se decide por codigo DOR:
    // "Counties, including non-municipal government" no contiene "GOVERNMENTAL"
    // ni "COUNTY" en singular, asi que la busqueda de palabras lo perdia.
    const gates = evaluarRuido({
      assetType: input.deal.assetType,
      propertyUseCode: input.deal.propertyUseCode,
      ownerNames,
      mailingAddress: input.deal.mailingAddress,
    });
    const noiseReason = gates.noiseReason as import("./deals.types").NoiseReason | null;
    const isNoise = gates.isNoise;
    const isGov = esInmuebleDeGobierno(input.deal, input.owners.map((o) => o.name));

    const distressStage = input.distressSignals.length
      ? inferDistressStage(input.distressSignals, input.deal.propertyUseCode)
      : isGov ? "GOVERNMENT_LAND" : "NONE";

    const todayMs = Date.now();
    const nextEventFromEvents = input.events
      .map((e) => parseEventDate(e.eventDate))
      .filter((d): d is Date => Boolean(d))
      .filter((d) => d.getTime() >= todayMs)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const nextEventDate = nextEventFromEvents ?? input.deal.nextEventDate ?? null;

    const hasDispositionEvidence = input.events.some((e) => {
      const t = (e.eventType ?? "").toUpperCase();
      const s = (e.source ?? "").toUpperCase();
      return t.includes("RFP") || t.includes("RFQ") || t.includes("IFB") || t.includes("SURPLUS") ||
        t.includes("PUBLIC_AUCTION") || s.includes("GOVDEALS") || s.includes("SAM.GOV");
    });

    // 29-sep-2026. Antes: hasDistress = hay al menos UNA senal, sin mirar cual.
    // Medido sobre los 360 deals reales, eso mandaba 237 a DISTRESS_OWNER con
    // accion CONTACT_NOW, e incluia las 40 ejecuciones de expensas de consorcios
    // y los 175 deals cuya unica senal es pasto alto, una casa rodante mal
    // estacionada o un alquiler temporario sin registrar. El carril ahora
    // pregunta QUE distress es. SIGNALS_ONLY y CODE_ENFORCEMENT son contactos,
    // no urgencias: caen a OFF_MARKET_STANDARD, que es lo que corresponde.
    const ETAPAS_ACCIONABLES = new Set([
      "PRE_FORECLOSURE", "AUCTION_SCHEDULED", "AUCTION_POSTPONED_OR_CANCELLED",
      "TAX_SALE_PROCESS", "BANKRUPTCY", "PROBATE_ESTATE",
      "REO_BANK_OWNED", "SHORT_SALE_ACTIVE",
    ]);
    const hasDistress = ETAPAS_ACCIONABLES.has(String(distressStage));
    const hasPhone = input.owners.some((o) => Boolean(toCleanText(o.phone ?? null)));
    const hasEmail = input.owners.some((o) => Boolean(toCleanText(o.email ?? null)));
    // 13-oct-2026: siempre desde los datos de hoy. Antes el primer valor calculado quedaba para siempre
    // (nadie lo carga a mano), y un domicilio postal, un telefono o un correo nuevos no cambiaban nada.
    const rawContactability =
      clamp((input.deal.mailingAddress ? 35 : 0) + (input.deal.address ? 15 : 0) + (hasPhone ? 30 : 0) + (hasEmail ? 20 : 0), 0, 100);
    const contactabilityScore = Number(rawContactability.toFixed(1));

    const why: string[] = [], blockers: string[] = [];
    let lane: DealLane, recommendedAction: RecommendedAction;

    if (isNoise) {
      lane = "NON_ACQUIRABLE_NOISE"; recommendedAction = "ARCHIVE";
      why.push(noiseReason === "CONSERVATION"
        ? "Conservation land (wildlife refuge or conservancy owner): not acquirable."
        : "Use category matches non-acquirable pattern.");
      blockers.push("Non-acquirable asset category by policy.");
    } else if (!input.deal.parcelId && !input.deal.address) {
      lane = "RESEARCH_REQUIRED"; recommendedAction = "RESEARCH";
      why.push("Missing property identifier for reliable actioning.");
      blockers.push("Need parcel ID or confirmed situs address.");
    } else if (isGov) {
      lane = "GOV_LAND_P3"; recommendedAction = hasDispositionEvidence ? "GOV_PURSUE" : "MONITOR";
      why.push("Government-owned/use parcel routed to Gov/P3 lane.");
      if (!hasDispositionEvidence) blockers.push("No official disposition evidence yet (RFP/surplus/auction).");
    } else if (hasDistress) {
      if (distressStage === "AUCTION_SCHEDULED" || distressStage === "AUCTION_POSTPONED_OR_CANCELLED") {
        lane = "AUCTION_MONITOR"; recommendedAction = "AUCTION_PREP";
        why.push("Distress evidence indicates auction-stage workflow.");
      } else {
        lane = "DISTRESS_OWNER"; recommendedAction = "CONTACT_NOW";
        why.push("Official distress evidence supports direct owner/trustee action.");
      }
    } else {
      lane = "OFF_MARKET_STANDARD";
      recommendedAction = input.classification === "TRUE_OPPORTUNITY" ? "CONTACT_NOW"
        : input.classification === "WATCHLIST" ? "MONITOR"
          : input.completenessScore < 40 ? "RESEARCH" : "MONITOR";
      why.push("Off-market workflow selected from current data quality and opportunity gates.");
    }

    if (typeof input.spreadToAskPct === "number" && input.spreadToAskPct < 10) blockers.push("Spread below strict threshold (10%).");
    if (input.comparableCount < 8) blockers.push("Comparable coverage below strict threshold (8).");
    if (input.completenessScore < 70) blockers.push("Data completeness below strict threshold (70%).");
    if (contactabilityScore < 50) blockers.push("Low contactability; enrich owner phone/email first.");

    return {
      lane, recommendedAction, distressStage: distressStage as DistressStage,
      nextEventDate, contactabilityScore, isNoise, noiseReason, ownerType,
      why: why.slice(0, 3), blockers: blockers.slice(0, 6),
    };
  }
