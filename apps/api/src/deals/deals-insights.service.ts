import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";
import { DealsComparablesService } from "./deals-comparables.service";
import { avg, isReasonableSalePrice, median } from "./deals.utils";

@Injectable()
export class DealsInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comparables: DealsComparablesService,
  ) {}

  async recomputeInsights(dealId: string) {
    const subject = await this.prisma.deal.findUnique({ where: { id: dealId }, include: { metrics: true } });
    if (!subject) throw new NotFoundException("Deal not found");

    let comparableRows = await this.prisma.dealComparable.findMany({ where: { dealId } });
    if (!comparableRows.length) {
      await this.comparables.recomputeComparables(dealId);
      comparableRows = await this.prisma.dealComparable.findMany({ where: { dealId } });
    }

    const sales = await this.prisma.mdpaSale.findMany({
      where: { dealId }, orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }], take: 5,
    });
    const assessments = await this.prisma.mdpaAssessment.findMany({
      where: { dealId }, orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }], take: 5,
    });

    const avgCompPricePerSqft = avg(comparableRows.map((c) => c.pricePerSqft));
    const medianCompPricePerSqft = median(comparableRows.map((c) => c.pricePerSqft));
    const avgCompCapRate = avg(comparableRows.map((c) => c.capRate));
    const comparableSalePrices = comparableRows
      .map((c) => c.salePrice)
      .filter((v): v is number => isReasonableSalePrice(v));
    const medianCompSalePrice = median(comparableSalePrices);
    const trimmedPrices = medianCompSalePrice && medianCompSalePrice > 0
      ? comparableSalePrices.filter((v) => v >= medianCompSalePrice / 3 && v <= medianCompSalePrice * 3)
      : comparableSalePrices;
    const avgSalePrice = avg(trimmedPrices);
    const latestRecordedSale = sales.find((r) => typeof r.salePrice === "number" || r.saleDate !== null) ?? null;
    const latestAssessment = assessments[0] ?? null;
    const usableComparableCount = comparableRows.filter(
      (c) => typeof c.pricePerSqft === "number" || typeof c.capRate === "number" || typeof c.salePrice === "number",
    ).length;

    const estimatedValueFromPpsf =
      avgCompPricePerSqft && subject.buildingSizeSqft && subject.buildingSizeSqft > 0
        ? avgCompPricePerSqft * subject.buildingSizeSqft : null;
    const subjectAskingPrice = isReasonableSalePrice(subject.askingPrice) ? subject.askingPrice : null;
    const latestReasonableAssessment = [latestAssessment?.justValue, latestAssessment?.assessedValue, latestAssessment?.taxableValue]
      .find((v) => isReasonableSalePrice(v));

    const estimatedValue =
      estimatedValueFromPpsf ??
      avgSalePrice ??
      (isReasonableSalePrice(latestRecordedSale?.salePrice) ? latestRecordedSale?.salePrice : null) ??
      subjectAskingPrice ??
      latestReasonableAssessment ?? null;

    const confidence =
      usableComparableCount >= 12 && avgCompPricePerSqft !== null ? "high"
        : usableComparableCount >= 6 && (avgCompPricePerSqft !== null || avgSalePrice !== null ||
            isReasonableSalePrice(latestRecordedSale?.salePrice) ||
            isReasonableSalePrice(latestAssessment?.justValue) ||
            isReasonableSalePrice(latestAssessment?.assessedValue) ||
            isReasonableSalePrice(latestAssessment?.taxableValue))
          ? "medium" : "low";

    const demographic = {
      source: "internal-v1", status: "partial", market: subject.market ?? null,
      city: subject.city ?? null, confidence: "low",
      summary: "Base demographics inferred from current market/city labels.",
    };
    const climateRisk = {
      source: "internal-v1", status: "partial",
      location: { latitude: subject.latitude ?? null, longitude: subject.longitude ?? null },
      riskLevel: "unknown",
      confidence: subject.latitude && subject.longitude ? "medium" : "low",
      summary: "Geospatial coordinates available; external hazard feed pending.",
    };
    const valuation = {
      source: "internal-comps-v1", askingPrice: subject.askingPrice ?? null,
      subjectCapRate: subject.metrics?.capRate ?? null,
      comparableCount: comparableRows.length, usableComparableCount,
      avgCompPricePerSqft, medianCompPricePerSqft, avgCompCapRate,
      avgSalePrice, medianCompSalePrice,
      latestRecordedSaleDate: latestRecordedSale?.saleDate ?? null,
      latestRecordedSalePrice: latestRecordedSale?.salePrice ?? null,
      latestAssessmentYear: latestAssessment?.taxYear ?? null,
      latestAssessmentJustValue: latestAssessment?.justValue ?? null,
      latestAssessmentAssessedValue: latestAssessment?.assessedValue ?? null,
      latestAssessmentTaxableValue: latestAssessment?.taxableValue ?? null,
      estimatedValue, confidence,
      summary: usableComparableCount > 0
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

    return { dealId, updatedAt: insight.updatedAt, demographic, climateRisk, valuation };
  }
}
