import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";
import { ProjectionScenarioDto } from "./dto/projection-scenario.dto";
import { DealsFactsService } from "./deals-facts.service";
import { DealsTriageService } from "./deals-triage.service";
import { clamp, isReasonableSalePrice, parseJson, safePercent, isSpreadOutlier, classifyOpportunity } from "./deals.utils";

@Injectable()
export class DealsAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: DealsFactsService,
    private readonly triage: DealsTriageService,
  ) {}

  async getDataQuality(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal) throw new NotFoundException("Deal not found");
    const missingFields = this.facts.missingFactFields(deal);
    return {
      dealId: deal.id, completenessScore: deal.dataCompletenessScore ?? 0, missingFields,
      source: deal.source ?? "unknown",
      hasGeo: typeof deal.latitude === "number" && typeof deal.longitude === "number",
      hasPricing: typeof deal.askingPrice === "number" || typeof deal.pricePerSqft === "number",
      hasBuildingFacts: typeof deal.buildingSizeSqft === "number" || typeof deal.yearBuilt === "number" || Boolean(deal.zoning),
      lastUpdatedAt: deal.updatedAt,
    };
  }

  async getOpportunitySummary(id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        comparables: true, insight: true,
        owners: { include: { owner: true } },
        events: { orderBy: { eventDate: "asc" }, take: 25 },
        distressSignals: { where: { status: "CONFIRMED" }, orderBy: { observedAt: "desc" }, take: 1 },
        sales: { orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }], take: 15 },
        assessments: { orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }], take: 5 },
      },
    });
    if (!deal) throw new NotFoundException("Deal not found");

    const usableComparables = deal.comparables.filter(
      (r) => (typeof r.salePrice === "number" && r.salePrice > 0) ||
        (typeof r.pricePerSqft === "number" && r.pricePerSqft > 0) ||
        (typeof r.capRate === "number" && r.capRate > 0),
    );
    const usableComparableCount = usableComparables.length;
    const completeness = deal.dataCompletenessScore ?? 0;
    const completenessWeighted = (completeness / 100) * 35;
    const coverageWeighted = clamp(usableComparableCount * 1.25, 0, 25);

    const valuation = parseJson<Record<string, unknown>>(deal.insight?.valuationJson) ?? {};
    const estimatedValueCandidate = valuation.estimatedValue;
    const estimatedValue = typeof estimatedValueCandidate === "number" && Number.isFinite(estimatedValueCandidate) ? estimatedValueCandidate : null;
    const askingPrice = isReasonableSalePrice(deal.askingPrice) ? deal.askingPrice : null;
    const spreadToAskPct = estimatedValue !== null && askingPrice !== null ? safePercent(estimatedValue - askingPrice, askingPrice) : null;
    const spreadOutlier = isSpreadOutlier(spreadToAskPct);

    const spreadWeighted = spreadToAskPct === null ? 0
      : spreadToAskPct >= 25 ? 25 : spreadToAskPct >= 10 ? 18 : spreadToAskPct >= 0 ? 12 : spreadToAskPct >= -10 ? 6 : 0;
    const qualityBonus = deal.source === "mdpa" ? 8 : 4;
    const missingPenalty = clamp(this.facts.missingFactFields(deal).length * 1.5, 0, 18);
    const score = clamp(Math.round(completenessWeighted + coverageWeighted + spreadWeighted + qualityBonus - missingPenalty), 0, 100);

    const verdict = score >= 75 ? "STRONG_BUY" : score >= 45 ? "WATCHLIST" : "HIGH_RISK";
    const confidence = usableComparableCount >= 12 && completeness >= 70 ? "high"
      : usableComparableCount >= 6 && completeness >= 45 ? "medium" : "low";

    const topDrivers: string[] = [];
    if (usableComparableCount >= 10) topDrivers.push(`Strong comparable coverage (${usableComparableCount} usable comps).`);
    if (spreadToAskPct !== null && !spreadOutlier && spreadToAskPct >= 10)
      topDrivers.push(`Estimated value is ${spreadToAskPct.toFixed(1)}% above asking price.`);
    if (completeness >= 70) topDrivers.push(`High data completeness (${completeness.toFixed(1)}%).`);
    else if (completeness >= 50) topDrivers.push(`Moderate data completeness (${completeness.toFixed(1)}%).`);
    if (!topDrivers.length) topDrivers.push("Opportunity score is mostly driven by available comparables and current asking data.");

    const riskFlags: string[] = [];
    const missingFields = this.facts.missingFactFields(deal);
    if (missingFields.length > 0) riskFlags.push(`Missing critical facts: ${missingFields.join(", ")}.`);
    if (askingPrice === null) riskFlags.push("No reliable asking price available; spread signal is disabled.");
    if (spreadToAskPct !== null && spreadToAskPct < 0) riskFlags.push("Estimated value is below current asking price.");
    if (spreadOutlier) riskFlags.push(`Spread signal outlier (${spreadToAskPct?.toFixed(1)}%). Validate asking price and valuation assumptions.`);
    if (usableComparableCount < 6) riskFlags.push("Low comparable depth may reduce valuation reliability.");
    if (!riskFlags.length) riskFlags.push("No critical risk flags from current internal signals.");

    const distressConfirmed = deal.distressSignals.length > 0;
    const classification = classifyOpportunity({
      spreadToAskPct, spreadOutlier, comparableCount: usableComparableCount, completenessScore: completeness,
      confidence: confidence as "high" | "medium" | "low", distressConfirmed, topDrivers, riskFlags,
    });
    const decision = this.triage.computeOperationalDecision({
      deal,
      owners: deal.owners.map((e) => ({ name: e.owner.name, phone: e.owner.phone, email: e.owner.email })),
      distressSignals: deal.distressSignals, events: deal.events,
      classification: classification.classification, completenessScore: completeness,
      spreadToAskPct, comparableCount: usableComparableCount,
    });

    return {
      dealId: deal.id, score, pipelineScore: score, verdict, confidence,
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
      gates: classification.gates, nextBestAction: classification.nextBestAction,
      foreclosureStatus: classification.foreclosureStatus,
      topDrivers: topDrivers.slice(0, 3), riskFlags: riskFlags.slice(0, 3),
      blockers: decision.blockers, why: decision.why,
      estimatedValue, spreadToAskPct, spreadOutlier, comparableCount: usableComparableCount,
    };
  }

  async buildProjection(id: string, input: ProjectionScenarioDto = {}) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { insight: true } });
    if (!deal) throw new NotFoundException("Deal not found");

    const scenario = input.scenario ?? "base";
    const valuation = parseJson<Record<string, unknown>>(deal.insight?.valuationJson) ?? {};
    const estimatedValueFromInsights = typeof valuation.estimatedValue === "number" && Number.isFinite(valuation.estimatedValue)
      ? valuation.estimatedValue : null;
    const inferredAskingPrice = isReasonableSalePrice(deal.askingPrice) ? deal.askingPrice : null;
    const purchasePrice = input.purchasePrice ?? inferredAskingPrice ?? estimatedValueFromInsights ?? 0;
    const rehabCost = input.rehabCost ?? (scenario === "aggressive" ? purchasePrice * 0.12 : purchasePrice * 0.07);
    const monthlyRent = input.monthlyRent ?? (scenario === "conservative" ? purchasePrice * 0.005
      : scenario === "aggressive" ? purchasePrice * 0.0085 : purchasePrice * 0.0068);
    const monthlyExpenses = input.monthlyExpenses ?? (scenario === "conservative" ? monthlyRent * 0.42
      : scenario === "aggressive" ? monthlyRent * 0.33 : monthlyRent * 0.38);
    const exitCapRate = input.exitCapRate ?? (scenario === "conservative" ? 7.8 : scenario === "aggressive" ? 5.9 : 6.8);
    const holdingMonths = input.holdingMonths ?? (scenario === "aggressive" ? 18 : 24);

    const annualNOI = Math.max(0, (monthlyRent - monthlyExpenses) * 12);
    const estimatedExitValue = exitCapRate > 0 ? annualNOI / (exitCapRate / 100) : 0;
    const totalInvested = purchasePrice + rehabCost;
    const profit = estimatedExitValue - totalInvested;
    const cashOnCashPct = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;

    return {
      dealId: id, scenario,
      warnings: purchasePrice > 0 ? [] : ["Insufficient pricing data for a reliable projection."],
      assumptions: { purchasePrice, rehabCost, monthlyRent, monthlyExpenses, exitCapRate, holdingMonths },
      metrics: { annualNOI, estimatedExitValue, totalInvested, profit, cashOnCashPct },
    };
  }

  async getOverview(id: string) {
    let deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { metrics: true, painPoints: true, owners: { include: { owner: true } } },
    });
    if (!deal) return null;

    if (this.facts.hasMissingFacts(deal)) {
      try {
        const refreshResult = await this.facts.refreshFactsForDeal(deal);
        if (refreshResult.updated) {
          deal = await this.prisma.deal.findUnique({
            where: { id },
            include: { metrics: true, painPoints: true, owners: { include: { owner: true } } },
          });
          if (!deal) return null;
        }
      } catch { /* Best-effort enrichment */ }
    }
    if (!deal) return null;
    const currentDeal = deal;

    const [media, documents, comparables, insight, sales, assessments] = await this.prisma.$transaction([
      this.prisma.dealMedia.findMany({ where: { dealId: id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      this.prisma.dealDocument.findMany({ where: { dealId: id }, orderBy: { createdAt: "desc" } }),
      this.prisma.dealComparable.findMany({ where: { dealId: id }, orderBy: [{ distanceMiles: "asc" }, { createdAt: "desc" }] }),
      this.prisma.dealInsight.findUnique({ where: { dealId: id } }),
      this.prisma.mdpaSale.findMany({ where: { dealId: id }, orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }], take: 25 }),
      this.prisma.mdpaAssessment.findMany({ where: { dealId: id }, orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }], take: 15 }),
    ]);

    const cleanComparables = comparables.filter((c) => Boolean(c.address?.trim())).map((c) => ({
      ...c,
      quality: typeof c.resolvedAddressConfidence === "number" && c.resolvedAddressConfidence >= 0.85 ? "high"
        : typeof c.resolvedAddressConfidence === "number" && c.resolvedAddressConfidence >= 0.6 ? "medium" : "low",
    }));

    const missingFields = this.facts.missingFactFields(currentDeal);
    const [opportunitySummary, dataQuality] = await Promise.all([
      this.getOpportunitySummary(id),
      this.getDataQuality(id),
    ]);

    const operationalDecision = {
      lane: opportunitySummary.lane, recommendedAction: opportunitySummary.recommendedAction,
      distressStage: opportunitySummary.distressStage, nextEventDate: opportunitySummary.nextEvent,
      contactabilityScore: opportunitySummary.contactability, isNoise: opportunitySummary.isNoise,
      noiseReason: opportunitySummary.noiseReason, ownerType: opportunitySummary.ownerType,
      why: opportunitySummary.why ?? [], blockers: opportunitySummary.blockers ?? [],
    };
    const investmentThesis = {
      classification: opportunitySummary.classification, lane: opportunitySummary.lane,
      recommendedAction: opportunitySummary.recommendedAction,
      headline: opportunitySummary.classification === "TRUE_OPPORTUNITY" ? "Meets strict opportunity gates."
        : opportunitySummary.classification === "DISTRESS_CANDIDATE" ? "Special-situation candidate with confirmed distress signal."
        : opportunitySummary.classification === "WATCHLIST" ? "Partial opportunity signal. Keep under active review."
        : "Pipeline listing. No strict edge yet.",
      reason: opportunitySummary.classificationReason,
      spreadToAskPct: opportunitySummary.spreadToAskPct ?? null,
      comparableCount: opportunitySummary.comparableCount ?? 0,
      completenessScore: dataQuality.completenessScore ?? 0,
      confidence: opportunitySummary.confidence, foreclosureStatus: opportunitySummary.foreclosureStatus,
      gates: opportunitySummary.gates, nextBestAction: opportunitySummary.nextBestAction,
      drivers: opportunitySummary.topDrivers.slice(0, 3), risks: opportunitySummary.riskFlags.slice(0, 3),
    };
    const investmentThesisV2 = {
      verdict: operationalDecision.recommendedAction === "CONTACT_NOW" || operationalDecision.recommendedAction === "AUCTION_PREP"
        ? "Yes: operationally actionable" : operationalDecision.recommendedAction === "GOV_PURSUE"
        ? "Gov/P3: pursue procurement workflow" : operationalDecision.recommendedAction === "ARCHIVE"
        ? "No: non-acquirable noise" : "Not yet: keep in monitor/research",
      lane: operationalDecision.lane, action: operationalDecision.recommendedAction,
      reasons: operationalDecision.why.slice(0, 3), risks: operationalDecision.blockers.slice(0, 3),
      nextAction: opportunitySummary.nextBestAction,
    };

    return {
      deal: {
        ...currentDeal, pipelineScore: currentDeal.score ?? null,
        classification: opportunitySummary.classification,
        lane: currentDeal.lane ?? opportunitySummary.lane,
        recommendedAction: currentDeal.recommendedAction ?? opportunitySummary.recommendedAction,
        distressStage: currentDeal.distressStage ?? opportunitySummary.distressStage,
        nextEventDate: currentDeal.nextEventDate ?? (opportunitySummary.nextEvent ? new Date(opportunitySummary.nextEvent) : null),
        contactabilityScore: currentDeal.contactabilityScore ?? opportunitySummary.contactability,
        isNoise: currentDeal.isNoise || opportunitySummary.isNoise,
        noiseReason: currentDeal.noiseReason ?? opportunitySummary.noiseReason,
      },
      ownership: { owners: currentDeal.owners.map((e) => ({ id: e.owner.id, name: e.owner.name, mailingAddress: currentDeal.mailingAddress })) },
      facts: {
        lotSizeSqft: currentDeal.lotSizeSqft, buildingSizeSqft: currentDeal.buildingSizeSqft,
        yearBuilt: currentDeal.yearBuilt, zoning: currentDeal.zoning,
        askingPrice: currentDeal.askingPrice, pricePerSqft: currentDeal.pricePerSqft,
        propertyUseCode: currentDeal.propertyUseCode, municipality: currentDeal.municipality ?? currentDeal.city,
      },
      assessments, sales, media, documents, comparables: cleanComparables,
      insights: insight ? {
        demographic: parseJson<Record<string, unknown>>(insight.demographicJson),
        climateRisk: parseJson<Record<string, unknown>>(insight.climateRiskJson),
        valuation: parseJson<Record<string, unknown>>(insight.valuationJson),
        updatedAt: insight.updatedAt,
      } : null,
      completeness: { score: currentDeal.dataCompletenessScore ?? 0, missingFields },
      opportunitySummary, operationalDecision, dataQuality, investmentThesis, investmentThesisV2,
    };
  }
}
