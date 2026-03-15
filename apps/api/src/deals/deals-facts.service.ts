import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma.service";
import { fetchArcgisWhere } from "../integrations/connectors/arcgis";
import {
  computeDealCompletenessScore,
  extractGeometryPoint,
  inferAssetTypeFromUse,
  isReasonableSalePrice,
  pickField,
  toNumber,
} from "./deals.utils";
import { MIAMI_DADE_FALLBACK_LAYER } from "./deals.types";

type ExtractedFacts = {
  address?: string; mailingAddress?: string; city?: string; municipality?: string;
  state?: string; zip?: string; propertyUseCode?: string; assetType?: string;
  lotSizeSqft?: number; buildingSizeSqft?: number; yearBuilt?: number; zoning?: string;
  askingPrice?: number; pricePerSqft?: number; latitude?: number; longitude?: number;
};

@Injectable()
export class DealsFactsService {
  constructor(private readonly prisma: PrismaService) {}

  hasMissingFacts(deal: {
    lotSizeSqft: number | null; buildingSizeSqft: number | null; yearBuilt: number | null;
    zoning: string | null; askingPrice: number | null; pricePerSqft: number | null;
  }) {
    return deal.lotSizeSqft === null || deal.buildingSizeSqft === null || deal.yearBuilt === null ||
      deal.zoning === null || deal.askingPrice === null || deal.pricePerSqft === null;
  }

  missingFactFields(deal: {
    parcelId: string | null; address: string | null; city: string | null; zip: string | null;
    propertyUseCode: string | null; lotSizeSqft: number | null; buildingSizeSqft: number | null;
    yearBuilt: number | null; zoning: string | null; askingPrice: number | null;
    pricePerSqft: number | null; latitude: number | null; longitude: number | null;
  }) {
    return [
      deal.parcelId ? null : "parcelId", deal.address ? null : "address",
      deal.city ? null : "city", deal.zip ? null : "zip",
      deal.propertyUseCode ? null : "propertyUseCode",
      deal.lotSizeSqft ? null : "lotSizeSqft", deal.buildingSizeSqft ? null : "buildingSizeSqft",
      deal.yearBuilt ? null : "yearBuilt", deal.zoning ? null : "zoning",
      deal.askingPrice ? null : "askingPrice", deal.pricePerSqft ? null : "pricePerSqft",
      deal.latitude ? null : "latitude", deal.longitude ? null : "longitude",
    ].filter((f): f is string => Boolean(f));
  }

  private async fetchSourceFeaturesByParcel(parcelId: string, source: string) {
    const escaped = parcelId.replace(/'/g, "''");
    const maxRows = Number(process.env.ARCGIS_MAX_ROWS || 50);
    const attempts: Array<{ url: string; where: string }> = [];

    if (source === "palm-beach-parcels") {
      const url = process.env.PALM_BEACH_PARCELS_URL;
      if (url) { attempts.push({ url, where: `PARID = '${escaped}'` }); attempts.push({ url, where: `PARCEL_NUMBER = '${escaped}'` }); }
    } else if (source === "broward-parcels") {
      const url = process.env.BROWARD_PARCELS_URL;
      if (url) { attempts.push({ url, where: `PARCELID = '${escaped}'` }); attempts.push({ url, where: `LOWPARCELI = '${escaped}'` }); }
    } else if (source === "miami-dade-parcels") {
      const configuredUrl = process.env.MIAMI_DADE_PARCELS_URL;
      if (configuredUrl) {
        attempts.push({ url: configuredUrl, where: `FOLIO = '${escaped}'` });
        attempts.push({ url: configuredUrl, where: `PARID = '${escaped}'` });
        attempts.push({ url: configuredUrl, where: `PARCEL_ID = '${escaped}'` });
      }
      attempts.push({ url: MIAMI_DADE_FALLBACK_LAYER, where: `FOLIO = '${escaped}'` });
    } else { return []; }

    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const features = await fetchArcgisWhere(attempt.url, attempt.where, maxRows);
        if (features.length) return features;
      } catch (error) {
        errors.push(`${attempt.url} (${attempt.where}): ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    if (errors.length) throw new Error(`Fact refresh failed for ${source}: ${errors.join(" | ")}`);
    return [];
  }

  private async derivePricingFallbackFacts(dealId: string, buildingSizeSqft: number | null) {
    const [metric, latestSale, latestAssessment] = await Promise.all([
      this.prisma.dealMetric.findUnique({ where: { dealId } }),
      this.prisma.mdpaSale.findFirst({ where: { dealId, salePrice: { not: null } }, orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }] }),
      this.prisma.mdpaAssessment.findFirst({
        where: { dealId, OR: [{ justValue: { not: null } }, { assessedValue: { not: null } }, { taxableValue: { not: null } }] },
        orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    const metricPrice = isReasonableSalePrice(metric?.price) ? metric?.price ?? null : null;
    const latestSalePrice = isReasonableSalePrice(latestSale?.salePrice) ? latestSale?.salePrice ?? null : null;
    const assessmentValue = [latestAssessment?.justValue, latestAssessment?.assessedValue, latestAssessment?.taxableValue]
      .find((v) => isReasonableSalePrice(v)) ?? null;
    const askingPrice = metricPrice ?? latestSalePrice ?? assessmentValue;
    const pricePerSqft = askingPrice !== null && typeof buildingSizeSqft === "number" && buildingSizeSqft > 0
      ? askingPrice / buildingSizeSqft : null;

    return { askingPrice, pricePerSqft, pricingSource: metricPrice ? "deal-metric" : latestSalePrice ? "latest-sale" : assessmentValue ? "latest-assessment" : null };
  }

  extractFactsFromFeatures(features: unknown[]): ExtractedFacts {
    const lotChunks: number[] = [], buildingChunks: number[] = [], yearChunks: number[] = [];
    const askingChunks: number[] = [], pricePerSqftChunks: number[] = [];
    const latitudes: number[] = [], longitudes: number[] = [];
    let address: string | undefined, mailingAddress: string | undefined, city: string | undefined;
    let municipality: string | undefined, state: string | undefined, zip: string | undefined;
    let propertyUseCode: string | undefined, assetType: string | undefined, zoning: string | undefined;

    for (const item of features) {
      const feature = item as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> };
      const attrs = feature.attributes ?? (item as Record<string, unknown>);
      if (!attrs || typeof attrs !== "object") continue;

      address = address ?? pickField(attrs, ["SITUS_ADDRESS","SITE_ADDR","SITE_ADDRESS","SITE_ADDR_STR","SITEADDRES","TRUE_SITE_ADDR","ADDRESS","PROP_ADDRESS"]);
      mailingAddress = mailingAddress ?? pickField(attrs, ["MAIL_ADDR","MAILING_ADDRESS","OWNER_MAILING_ADDRESS","OWNER_ADDRESS","PSTLADDRESS"]);
      city = city ?? pickField(attrs, ["SITUS_CITY","CITY","MUNICIPALITY","TRUE_SITE_CITY","CITYNAME","PSTLCITY"]);
      municipality = municipality ?? pickField(attrs, ["MUNICIPALITY","CITY","SITUS_CITY","CITYNAME"]);
      state = state ?? pickField(attrs, ["SITUS_STATE","STATE","PSTLSTATE"]);
      zip = zip ?? pickField(attrs, ["SITUS_ZIP","ZIP","ZIPCODE","TRUE_SITE_ZIP_CODE","ZIP1","PSTLZIP5"]);
      propertyUseCode = propertyUseCode ?? pickField(attrs, ["USE_CODE","PROPERTY_USE","DOR_UC","CLASS_CODE","PROPERTY_TYPE"]);
      assetType = assetType ?? pickField(attrs, ["PROPERTY_USE","USEDSCRP","PRPRTYDSCR","CLASSDSCRP","DOR_DESC"]);
      zoning = zoning ?? pickField(attrs, ["ZONING","ZONING_DESC","ZONINGCODE","CVTTXDSCRP","CLASSDSCRP","DOR_DESC"]);

      const lotSqft = toNumber(pickField(attrs, ["LOT_SIZE_SQFT","LOT_SQFT","LOTSQFT","LAND_SQFT","LANDSQFT","LOTSIZE","LOT_SIZE"]));
      const acres = toNumber(pickField(attrs, ["ACRES"]));
      if (typeof lotSqft === "number" && lotSqft > 0) lotChunks.push(lotSqft);
      if (typeof acres === "number" && acres > 0) lotChunks.push(acres * 43560);

      const buildingSqft = toNumber(pickField(attrs, ["BUILDING_SQFT","BLDG_SQFT","TOT_BUILDING_SQFT","TOTBLDGAREA","BLDGAREA","RESFLRAREA","BUILDINGAREA","LIVING_AREA","STATEDAREA","AREA","FLOOR_AREA","GROSS_AREA","GROSS_LIVING_AREA","TOT_LVG_AREA"]));
      if (typeof buildingSqft === "number" && buildingSqft > 0) buildingChunks.push(buildingSqft);

      const yearBuilt = toNumber(pickField(attrs, ["YEAR_BUILT","YR_BUILT","YRBLT","RESYRBLT","BUILT_YEAR","ACT_YR_BLT","STRUCT_YR_BLT","EFF_YEAR_BUILT","EFF_YR_BLT","YEAR_ADDED"]));
      if (typeof yearBuilt === "number" && yearBuilt >= 1700 && yearBuilt <= 2100) yearChunks.push(Math.round(yearBuilt));

      const askingCandidates = ["MARKET_VALUE","JUST_VALUE","ASSESSED_VALUE","ASSESSED_VAL","TOTAL_VALUE","TOTAL_MARKET","CNTASSDVAL","ASSDVALYRC","TXBLVALYRC","LAND_VALUE","LAND_MARKET","IMPRV_MRKT","APPRAISED_VALUE","PRICE"]
        .map((f) => toNumber(attrs[f])).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      askingChunks.push(...askingCandidates);

      const ppsf = toNumber(pickField(attrs, ["PRICE_PER_SQFT","PPSF","MARKET_VALUE_PER_SQFT"]));
      if (typeof ppsf === "number" && ppsf > 0) pricePerSqftChunks.push(ppsf);

      const attrLat = toNumber(pickField(attrs, ["LATITUDE","LAT","YCOORD","Y_COORD"]));
      const attrLng = toNumber(pickField(attrs, ["LONGITUDE","LON","LNG","XCOORD","X_COORD"]));
      const gp = extractGeometryPoint(feature);
      const lat = gp?.latitude ?? attrLat;
      const lng = gp?.longitude ?? attrLng;
      if (typeof lat === "number" && typeof lng === "number") { latitudes.push(lat); longitudes.push(lng); }
    }

    const lotSizeSqft = lotChunks.length ? lotChunks.reduce((s, v) => s + v, 0) : undefined;
    const buildingSizeSqft = buildingChunks.length ? Math.max(...buildingChunks) : undefined;
    const yearBuilt = yearChunks.length ? Math.max(...yearChunks) : undefined;
    const positiveAsking = askingChunks.filter((v) => v > 0);
    const askingPrice = positiveAsking.length ? Math.max(...positiveAsking) : askingChunks.length ? Math.max(...askingChunks) : undefined;
    const pricePerSqft = pricePerSqftChunks.length
      ? pricePerSqftChunks.reduce((s, v) => s + v, 0) / pricePerSqftChunks.length
      : askingPrice && buildingSizeSqft && buildingSizeSqft > 0 ? askingPrice / buildingSizeSqft : undefined;
    const latitude = latitudes.length ? latitudes.reduce((s, v) => s + v, 0) / latitudes.length : undefined;
    const longitude = longitudes.length ? longitudes.reduce((s, v) => s + v, 0) / longitudes.length : undefined;

    return { address, mailingAddress, city, municipality, state, zip, propertyUseCode, assetType, lotSizeSqft, buildingSizeSqft, yearBuilt, zoning, askingPrice, pricePerSqft, latitude, longitude };
  }

  async refreshFactsForDeal(deal: {
    id: string; source: string | null; parcelId: string | null; address: string | null;
    mailingAddress: string | null; city: string | null; municipality: string | null;
    state: string | null; zip: string | null; assetType: string | null;
    propertyUseCode: string | null; lotSizeSqft: number | null; buildingSizeSqft: number | null;
    yearBuilt: number | null; zoning: string | null; askingPrice: number | null;
    pricePerSqft: number | null; dataCompletenessScore: number | null;
    latitude: number | null; longitude: number | null;
  }) {
    const localUpdateData: Prisma.DealUpdateInput = {};
    const inferredAssetType = inferAssetTypeFromUse(deal.propertyUseCode ?? deal.assetType);
    if (!deal.assetType && inferredAssetType) localUpdateData.assetType = inferredAssetType;
    if (!deal.municipality && deal.city) localUpdateData.municipality = deal.city;

    if (!deal.parcelId || !deal.source) {
      const fallback = await this.derivePricingFallbackFacts(deal.id, deal.buildingSizeSqft);
      if ((deal.askingPrice === null || deal.askingPrice <= 0) && typeof fallback.askingPrice === "number" && fallback.askingPrice > 0)
        localUpdateData.askingPrice = fallback.askingPrice;
      if ((deal.pricePerSqft === null || deal.pricePerSqft <= 0) && typeof fallback.pricePerSqft === "number" && fallback.pricePerSqft > 0)
        localUpdateData.pricePerSqft = fallback.pricePerSqft;

      const completenessScore = computeDealCompletenessScore({
        parcelId: deal.parcelId, address: deal.address,
        city: (localUpdateData.municipality as string | undefined) ?? deal.city,
        zip: deal.zip, propertyUseCode: deal.propertyUseCode,
        lotSizeSqft: deal.lotSizeSqft, buildingSizeSqft: deal.buildingSizeSqft,
        yearBuilt: deal.yearBuilt, zoning: deal.zoning,
        askingPrice: deal.askingPrice, pricePerSqft: deal.pricePerSqft,
        latitude: deal.latitude, longitude: deal.longitude,
      });
      if (deal.dataCompletenessScore === null || Number.isNaN(deal.dataCompletenessScore) ||
          Math.abs(completenessScore - deal.dataCompletenessScore) >= 0.1)
        localUpdateData.dataCompletenessScore = completenessScore;

      if (Object.keys(localUpdateData).length) {
        await this.prisma.deal.update({ where: { id: deal.id }, data: localUpdateData });
        return { updated: true, fieldsUpdated: Object.keys(localUpdateData) };
      }
      return { updated: false, reason: "Deal missing parcel/source" };
    }

    const features = await this.fetchSourceFeaturesByParcel(deal.parcelId, deal.source);
    const facts = features.length ? this.extractFactsFromFeatures(features) : {} as ExtractedFacts;
    const updateData: Prisma.DealUpdateInput = { ...localUpdateData };

    if (!deal.address && facts.address) updateData.address = facts.address;
    if (!deal.mailingAddress && facts.mailingAddress) updateData.mailingAddress = facts.mailingAddress;
    if (!deal.city && facts.city) updateData.city = facts.city;
    if (!deal.municipality && (facts.municipality || facts.city)) updateData.municipality = facts.municipality ?? facts.city;
    if (!deal.state && facts.state) updateData.state = facts.state;
    if (!deal.zip && facts.zip) updateData.zip = facts.zip;
    if (!deal.propertyUseCode && facts.propertyUseCode) updateData.propertyUseCode = facts.propertyUseCode;
    if (!deal.assetType) {
      const inferred = inferAssetTypeFromUse(facts.assetType ?? facts.propertyUseCode ?? deal.propertyUseCode);
      if (inferred) updateData.assetType = inferred;
    }
    if (typeof facts.lotSizeSqft === "number" && facts.lotSizeSqft > 0 &&
        (deal.lotSizeSqft === null || deal.lotSizeSqft <= 0 || facts.lotSizeSqft > deal.lotSizeSqft * 1.2))
      updateData.lotSizeSqft = facts.lotSizeSqft;
    if ((deal.buildingSizeSqft === null || deal.buildingSizeSqft <= 0) && typeof facts.buildingSizeSqft === "number" && facts.buildingSizeSqft > 0)
      updateData.buildingSizeSqft = facts.buildingSizeSqft;
    if ((deal.yearBuilt === null || deal.yearBuilt < 1700) && typeof facts.yearBuilt === "number")
      updateData.yearBuilt = facts.yearBuilt;
    if (!deal.zoning && facts.zoning) updateData.zoning = facts.zoning;
    if ((deal.askingPrice === null || deal.askingPrice <= 0) && typeof facts.askingPrice === "number")
      updateData.askingPrice = facts.askingPrice;
    if ((deal.pricePerSqft === null || deal.pricePerSqft <= 0) && typeof facts.pricePerSqft === "number")
      updateData.pricePerSqft = facts.pricePerSqft;

    const projectedBuildingSize = (updateData.buildingSizeSqft as number | undefined) ?? deal.buildingSizeSqft;
    const pricingFallback = await this.derivePricingFallbackFacts(deal.id, projectedBuildingSize ?? null);
    if ((deal.askingPrice === null || deal.askingPrice <= 0) && updateData.askingPrice === undefined &&
        typeof pricingFallback.askingPrice === "number" && pricingFallback.askingPrice > 0)
      updateData.askingPrice = pricingFallback.askingPrice;
    if ((deal.pricePerSqft === null || deal.pricePerSqft <= 0) && updateData.pricePerSqft === undefined &&
        typeof pricingFallback.pricePerSqft === "number" && pricingFallback.pricePerSqft > 0)
      updateData.pricePerSqft = pricingFallback.pricePerSqft;

    if (deal.latitude === null && typeof facts.latitude === "number") updateData.latitude = facts.latitude;
    if (deal.longitude === null && typeof facts.longitude === "number") updateData.longitude = facts.longitude;

    const completenessScore = computeDealCompletenessScore({
      parcelId: deal.parcelId,
      address: (updateData.address as string | undefined) ?? deal.address,
      city: (updateData.city as string | undefined) ?? deal.city,
      zip: (updateData.zip as string | undefined) ?? deal.zip,
      propertyUseCode: (updateData.propertyUseCode as string | undefined) ?? deal.propertyUseCode,
      lotSizeSqft: (updateData.lotSizeSqft as number | undefined) ?? deal.lotSizeSqft,
      buildingSizeSqft: (updateData.buildingSizeSqft as number | undefined) ?? deal.buildingSizeSqft,
      yearBuilt: (updateData.yearBuilt as number | undefined) ?? deal.yearBuilt,
      zoning: (updateData.zoning as string | undefined) ?? deal.zoning,
      askingPrice: (updateData.askingPrice as number | undefined) ?? deal.askingPrice,
      pricePerSqft: (updateData.pricePerSqft as number | undefined) ?? deal.pricePerSqft,
      latitude: (updateData.latitude as number | undefined) ?? deal.latitude,
      longitude: (updateData.longitude as number | undefined) ?? deal.longitude,
    });
    if (deal.dataCompletenessScore === null || Number.isNaN(deal.dataCompletenessScore) ||
        Math.abs(completenessScore - deal.dataCompletenessScore) >= 0.1)
      updateData.dataCompletenessScore = completenessScore;

    if (!Object.keys(updateData).length)
      return { updated: false, reason: features.length ? "No new facts available" : "No source features found" };

    await this.prisma.deal.update({ where: { id: deal.id }, data: updateData });
    return { updated: true, fieldsUpdated: Object.keys(updateData) };
  }

  async refreshFacts(dealId: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) throw new NotFoundException("Deal not found");
    return this.refreshFactsForDeal(deal);
  }
}
