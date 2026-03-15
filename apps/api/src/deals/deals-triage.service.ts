import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";
import {
  DealClassification,
  DealLane,
  DistressStage,
  ENGINE_VERSION,
  OperationalDecision,
  RecommendedAction,
} from "./deals.types";
import {
  classifyOpportunity,
  clamp,
  detectNoiseReason,
  inferDistressStage,
  inferOwnerType,
  isReasonableSalePrice,
  isSpreadOutlier,
  normalizeConfidence,
  parseEventDate,
  parseJson,
  safePercent,
  toCleanText,
} from "./deals.utils";

@Injectable()
export class DealsTriageService {
  constructor(private readonly prisma: PrismaService) {}

  computeOperationalDecision(input: {
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
  }): OperationalDecision {
    const ownerNames = input.owners.map((o) => toCleanText(o.name ?? null)).filter((n): n is string => Boolean(n));
    const ownerType = inferOwnerType(ownerNames);
    const noiseReason = (input.deal.noiseReason as import("./deals.types").NoiseReason | null) ?? detectNoiseReason(input.deal.assetType, input.deal.propertyUseCode);
    const isNoise = Boolean(input.deal.isNoise) || Boolean(noiseReason);

    const haystack = `${input.deal.assetType ?? ""} ${input.deal.propertyUseCode ?? ""}`.toUpperCase();
    const isGov = ownerType === "GOV" || haystack.includes("GOVERNMENTAL") || haystack.includes("COUNTY") || haystack.includes("CITY") || haystack.includes("STATE");

    const distressStage = input.distressSignals.length
      ? inferDistressStage(input.distressSignals)
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

    const hasDistress = input.distressSignals.length > 0;
    const hasPhone = input.owners.some((o) => Boolean(toCleanText(o.phone ?? null)));
    const hasEmail = input.owners.some((o) => Boolean(toCleanText(o.email ?? null)));
    const rawContactability = (input.deal.contactabilityScore ?? 0) > 0
      ? Number(input.deal.contactabilityScore)
      : clamp((input.deal.mailingAddress ? 35 : 0) + (input.deal.address ? 15 : 0) + (hasPhone ? 30 : 0) + (hasEmail ? 20 : 0), 0, 100);
    const contactabilityScore = Number(rawContactability.toFixed(1));

    const why: string[] = [], blockers: string[] = [];
    let lane: DealLane, recommendedAction: RecommendedAction;

    if (isNoise) {
      lane = "NON_ACQUIRABLE_NOISE"; recommendedAction = "ARCHIVE";
      why.push("Use category matches non-acquirable pattern.");
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

  deriveOpportunitySignals(input: {
    askingPrice: number | null; completenessScore: number | null; valuationJson: string | null;
    fallbackComparableCount: number; topDrivers?: string[]; riskFlags?: string[];
    distressConfirmed: boolean;
  }) {
    const valuation = parseJson<Record<string, unknown>>(input.valuationJson) ?? {};
    const estimatedValueCandidate = valuation.estimatedValue;
    const estimatedValue = typeof estimatedValueCandidate === "number" && Number.isFinite(estimatedValueCandidate) ? estimatedValueCandidate : null;
    const askingPrice = isReasonableSalePrice(input.askingPrice) ? input.askingPrice : null;
    const spreadToAskPct = estimatedValue !== null && askingPrice !== null ? safePercent(estimatedValue - askingPrice, askingPrice) : null;
    const spreadOutlier = isSpreadOutlier(spreadToAskPct);

    const valuationComparableCount = valuation.comparableCount;
    const comparableCount = typeof valuationComparableCount === "number" && Number.isFinite(valuationComparableCount)
      ? Math.max(0, Math.round(valuationComparableCount)) : input.fallbackComparableCount;
    const confidence = normalizeConfidence(valuation.confidence);
    const completenessScore = Number.isFinite(input.completenessScore) ? Number(input.completenessScore) : 0;

    const classification = classifyOpportunity({
      spreadToAskPct, spreadOutlier, comparableCount, completenessScore, confidence,
      distressConfirmed: input.distressConfirmed,
      topDrivers: (input.topDrivers ?? []).slice(0, 3),
      riskFlags: (input.riskFlags ?? []).slice(0, 3),
    });

    return { spreadToAskPct, spreadOutlier, comparableCount, confidence, completenessScore, estimatedValue, classification };
  }

  async recomputeOperationalTriage(input: { limit?: number; onlyMissingLane?: boolean } = {}) {
    const limit = Number.isFinite(input.limit) ? Math.min(Math.max(Math.round(input.limit ?? 500), 1), 5000) : 500;
    const where = input.onlyMissingLane
      ? { OR: [{ lane: null }, { recommendedAction: null }, { laneUpdatedAt: null }] } : {};

    const deals = await this.prisma.deal.findMany({
      where, orderBy: { updatedAt: "desc" }, take: limit,
      include: {
        insight: true,
        owners: { include: { owner: true } },
        distressSignals: { where: { status: "CONFIRMED" }, orderBy: { observedAt: "desc" }, take: 10 },
        events: { orderBy: { eventDate: "asc" }, take: 25 },
        _count: { select: { comparables: true } },
      },
    });

    const summary = { processed: deals.length, updated: 0, skipped: 0, errors: 0 };
    for (const deal of deals) {
      try {
        const derived = this.deriveOpportunitySignals({
          askingPrice: deal.askingPrice, completenessScore: deal.dataCompletenessScore,
          valuationJson: deal.insight?.valuationJson ?? null,
          fallbackComparableCount: deal._count.comparables,
          distressConfirmed: deal.distressSignals.length > 0,
        });
        const decision = this.computeOperationalDecision({
          deal,
          owners: deal.owners.map((e) => ({ name: e.owner.name, phone: e.owner.phone, email: e.owner.email })),
          distressSignals: deal.distressSignals, events: deal.events,
          classification: derived.classification.classification,
          completenessScore: derived.completenessScore,
          spreadToAskPct: derived.spreadToAskPct,
          comparableCount: derived.comparableCount,
        });

        const changed = deal.lane !== decision.lane || deal.recommendedAction !== decision.recommendedAction ||
          deal.distressStage !== decision.distressStage || deal.isNoise !== decision.isNoise ||
          deal.noiseReason !== decision.noiseReason ||
          Math.abs((deal.contactabilityScore ?? -1) - decision.contactabilityScore) >= 0.1 ||
          (deal.nextEventDate?.getTime() ?? 0) !== (decision.nextEventDate?.getTime() ?? 0);

        if (!changed) { summary.skipped += 1; continue; }

        await this.prisma.$transaction([
          this.prisma.deal.update({
            where: { id: deal.id },
            data: {
              lane: decision.lane, recommendedAction: decision.recommendedAction,
              distressStage: decision.distressStage, nextEventDate: decision.nextEventDate,
              contactabilityScore: decision.contactabilityScore, isNoise: decision.isNoise,
              noiseReason: decision.noiseReason, laneUpdatedAt: new Date(),
            },
          }),
          this.prisma.dealDecisionAudit.create({
            data: {
              dealId: deal.id, classification: derived.classification.classification,
              lane: decision.lane, recommendedAction: decision.recommendedAction,
              reasoningJson: JSON.stringify({
                why: decision.why, blockers: decision.blockers, gates: derived.classification.gates,
                spreadToAskPct: derived.spreadToAskPct, comparableCount: derived.comparableCount,
                completenessScore: derived.completenessScore,
              }),
              engineVersion: ENGINE_VERSION,
            },
          }),
        ]);
        summary.updated += 1;
      } catch { summary.errors += 1; }
    }
    return summary;
  }
}
