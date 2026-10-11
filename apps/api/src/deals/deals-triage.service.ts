import { decidirOperacion } from "./operational-decision";
import type { EntradaDecision } from "./operational-decision";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";
import { ENGINE_VERSION, OperationalDecision } from "./deals.types";
import { classifyOpportunity, isReasonableSalePrice, isSpreadOutlier, normalizeConfidence, parseJson, safePercent } from "./deals.utils";

@Injectable()
export class DealsTriageService {
  constructor(private readonly prisma: PrismaService) {}

  computeOperationalDecision(input: EntradaDecision): OperationalDecision {
    return decidirOperacion(input);
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
