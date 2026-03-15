import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";
import { distanceMiles, formatAddress, isReasonableSalePrice, toCleanText } from "./deals.utils";

@Injectable()
export class DealsComparablesService {
  constructor(private readonly prisma: PrismaService) {}

  async recomputeComparables(dealId: string) {
    const subject = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { metrics: true },
    });
    if (!subject) throw new NotFoundException("Deal not found");

    const candidates = await this.prisma.deal.findMany({
      where: { id: { not: dealId } },
      include: { metrics: true },
      orderBy: { updatedAt: "desc" },
      take: 1200,
    });

    const candidateIds = candidates.map((c) => c.id);
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
      if (!latestSaleByDealId.has(sale.dealId) && typeof sale.salePrice === "number" && sale.salePrice > 0)
        latestSaleByDealId.set(sale.dealId, sale.salePrice);
    }

    const latestAssessmentByDealId = new Map<string, number>();
    for (const assessment of candidateAssessments) {
      if (latestAssessmentByDealId.has(assessment.dealId)) continue;
      const v = [assessment.justValue, assessment.assessedValue, assessment.taxableValue].find(
        (val) => typeof val === "number" && val > 0,
      );
      if (typeof v === "number") latestAssessmentByDealId.set(assessment.dealId, v);
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

        const salePrice =
          [candidate.askingPrice, candidate.metrics?.price, latestSaleByDealId.get(candidate.id), latestAssessmentByDealId.get(candidate.id)]
            .find((v) => isReasonableSalePrice(v)) ?? null;
        const derivedPricePerSqft =
          candidate.pricePerSqft ?? (salePrice && candidate.buildingSizeSqft && candidate.buildingSizeSqft > 0
            ? salePrice / candidate.buildingSizeSqft : null);
        const capRate = candidate.metrics?.capRate ?? null;

        if (salePrice === null && derivedPricePerSqft === null && capRate === null) return null;

        const dedupeKey = `${normalizedAddress.toLowerCase()}|${salePrice ?? ""}|${derivedPricePerSqft ?? ""}|${capRate ?? ""}`;
        if (seenKeys.has(dedupeKey)) return null;
        seenKeys.add(dedupeKey);

        return {
          address: normalizedAddress, comparableDealId: candidate.id, resolvedAddressConfidence,
          marketMatch: subject.market && candidate.market ? subject.market === candidate.market : false,
          assetTypeMatch: subject.assetType && candidate.assetType ? subject.assetType === candidate.assetType : false,
          hasPricePerSqft: typeof derivedPricePerSqft === "number",
          hasCapRate: typeof capRate === "number",
          distanceMiles: distanceMiles(subject.latitude, subject.longitude, candidate.latitude, candidate.longitude),
          salePrice, pricePerSqft: derivedPricePerSqft, capRate,
          source: `internal:${candidate.id}`,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => {
        if (a.marketMatch !== b.marketMatch) return a.marketMatch ? -1 : 1;
        if (a.assetTypeMatch !== b.assetTypeMatch) return a.assetTypeMatch ? -1 : 1;
        if (a.hasPricePerSqft !== b.hasPricePerSqft) return a.hasPricePerSqft ? -1 : 1;
        if (a.hasCapRate !== b.hasCapRate) return a.hasCapRate ? -1 : 1;
        return (a.distanceMiles ?? Number.MAX_SAFE_INTEGER) - (b.distanceMiles ?? Number.MAX_SAFE_INTEGER);
      })
      .slice(0, 20);

    await this.prisma.dealComparable.deleteMany({ where: { dealId } });
    if (rows.length) {
      await this.prisma.dealComparable.createMany({
        data: rows.map((row) => ({
          address: row.address, comparableDealId: row.comparableDealId,
          resolvedAddressConfidence: row.resolvedAddressConfidence,
          distanceMiles: row.distanceMiles, salePrice: row.salePrice,
          pricePerSqft: row.pricePerSqft, capRate: row.capRate,
          source: row.source, dealId,
        })),
      });
    }

    return { count: rows.length, dealId, message: rows.length ? "Comparables recomputed" : "No comparable records available" };
  }
}
