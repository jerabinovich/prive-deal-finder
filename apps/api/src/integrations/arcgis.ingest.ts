import { PrismaService } from "../shared/prisma.service";
import { computeScore } from "../scoring/score";
import { geocodeAddress } from "./geocoding";

const HEADER_MAP: Record<string, string[]> = {
  parcelId: ["PARCEL_ID", "PARCELID", "FOLIO", "PARID", "PARCELNO", "PARCEL_NO", "LOWPARCELI", "PARCEL_NUMBER"],
  address: [
    "SITUS_ADDRESS",
    "SITE_ADDR",
    "SITE_ADDRESS",
    "SITE_ADDR_STR",
    "SITEADDRES",
    "TRUE_SITE_ADDR",
    "ADDRESS",
    "PROP_ADDRESS",
  ],
  city: ["SITUS_CITY", "CITY", "MUNICIPALITY", "TRUE_SITE_CITY", "CITYNAME", "PSTLCITY"],
  mailingAddress: ["MAIL_ADDR", "MAILING_ADDRESS", "OWNER_MAILING_ADDRESS", "PSTLADDRESS"],
  state: ["SITUS_STATE", "STATE", "PSTLSTATE"],
  zip: ["SITUS_ZIP", "ZIP", "ZIPCODE", "TRUE_SITE_ZIP_CODE", "ZIP1", "PSTLZIP5"],
  owner: ["OWNER_NAME1", "OWNER_NAME2", "OWNER_NAME", "OWNERNME1", "OWNERNME2", "OWNER", "OWN_NAME", "NAME", "CNVYNAME"],
  assetType: ["PROPERTY_USE", "USEDSCRP", "PRPRTYDSCR", "CLASSDSCRP", "DOR_DESC"],
  lotSizeSqft: ["LOT_SIZE_SQFT", "LOT_SQFT", "LOTSQFT", "LAND_SQFT", "LANDSQFT", "LOTSIZE", "LOT_SIZE"],
  lotSizeAcres: ["ACRES"],
  buildingSizeSqft: [
    "BUILDING_SQFT",
    "BLDG_SQFT",
    "TOT_BUILDING_SQFT",
    "TOTBLDGAREA",
    "BLDGAREA",
    "RESFLRAREA",
    "BUILDINGAREA",
    "LIVING_AREA",
    "BLDG_SF",
    "STATEDAREA",
    "AREA",
    "FLOOR_AREA",
    "GROSS_AREA",
    "GROSS_LIVING_AREA",
    "TOT_LVG_AREA",
  ],
  yearBuilt: [
    "YEAR_BUILT",
    "YR_BUILT",
    "YRBLT",
    "RESYRBLT",
    "BUILT_YEAR",
    "ACT_YR_BLT",
    "STRUCT_YR_BLT",
    "EFF_YEAR_BUILT",
    "EFF_YR_BLT",
    "YEAR_ADDED",
  ],
  zoning: ["ZONING", "ZONING_DESC", "ZONINGCODE", "ZONING_CODE", "CVTTXDSCRP", "CLASSDSCRP"],
  askingPrice: [
    "MARKET_VALUE",
    "JUST_VALUE",
    "ASSESSED_VALUE",
    "ASSESSED_VAL",
    "TOTAL_VALUE",
    "TOTAL_MARKET",
    "CNTASSDVAL",
    "ASSDVALYRC",
    "TXBLVALYRC",
    "LAND_VALUE",
    "LAND_MARKET",
    "IMPRV_MRKT",
    "APPRAISED_VALUE",
    "PRICE",
  ],
  pricePerSqft: ["PRICE_PER_SQFT", "PPSF", "MARKET_VALUE_PER_SQFT"],
  latitude: ["LATITUDE", "LAT", "YCOORD", "Y_COORD"],
  longitude: ["LONGITUDE", "LON", "LNG", "XCOORD", "X_COORD"],
};

function pickField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return undefined;
}

function computeCompletenessScore(input: {
  parcelId?: string;
  address?: string;
  city?: string;
  zip?: string;
  propertyUseCode?: string;
  lotSizeSqft?: number;
  buildingSizeSqft?: number;
  yearBuilt?: number;
  zoning?: string;
  askingPrice?: number;
  pricePerSqft?: number;
  latitude?: number;
  longitude?: number;
}) {
  const checks = [
    Boolean(input.parcelId),
    Boolean(input.address),
    Boolean(input.city),
    Boolean(input.zip),
    Boolean(input.propertyUseCode),
    typeof input.lotSizeSqft === "number" && input.lotSizeSqft > 0,
    typeof input.buildingSizeSqft === "number" && input.buildingSizeSqft > 0,
    typeof input.yearBuilt === "number" && input.yearBuilt >= 1700,
    Boolean(input.zoning),
    typeof input.askingPrice === "number" && input.askingPrice > 0,
    typeof input.pricePerSqft === "number" && input.pricePerSqft > 0,
    typeof input.latitude === "number",
    typeof input.longitude === "number",
  ];
  const completed = checks.filter(Boolean).length;
  return Number(((completed / checks.length) * 100).toFixed(1));
}

function composeAddress(record: Record<string, unknown>) {
  const parts = [
    pickField(record, ["STREET_NUMBER"]),
    pickField(record, ["STREET_FRACTION"]),
    pickField(record, ["PRE_DIR"]),
    pickField(record, ["STREET_NAME"]),
    pickField(record, ["STREET_SUFFIX_ABBR"]),
    pickField(record, ["POST_DIR"]),
    pickField(record, ["BUILDING"]),
    pickField(record, ["UNIT"]),
  ].filter(Boolean);

  if (!parts.length) return undefined;
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[$,]/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickBestPrice(record: Record<string, unknown>) {
  const candidates = HEADER_MAP.askingPrice
    .map((field) => toNumber(record[field]))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!candidates.length) return undefined;
  const positive = candidates.filter((value) => value > 0);
  if (positive.length) {
    return Math.max(...positive);
  }
  return Math.max(...candidates);
}

function extractGeometryPoint(feature: { geometry?: Record<string, unknown> }) {
  const geometry = feature.geometry;
  if (!geometry || typeof geometry !== "object") return undefined;

  const x = geometry.x;
  const y = geometry.y;
  if (typeof x === "number" && typeof y === "number") {
    return { latitude: y, longitude: x };
  }

  const rings = geometry.rings as unknown;
  if (!Array.isArray(rings) || !Array.isArray(rings[0]) || !rings[0].length) {
    return undefined;
  }

  const points = rings[0] as Array<[number, number]>;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    if (typeof point[0] !== "number" || typeof point[1] !== "number") continue;
    sumX += point[0];
    sumY += point[1];
    count += 1;
  }

  if (!count) return undefined;
  return {
    latitude: sumY / count,
    longitude: sumX / count,
  };
}

export async function ingestArcgisRecords(
  prisma: PrismaService,
  source: string,
  market: string,
  features: unknown[]
) {
  let createdDeals = 0;
  let updatedDeals = 0;
  let createdOwners = 0;
  let linkedOwners = 0;

  for (const feature of features) {
    const featureObj = (feature || {}) as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> };
    const attrs = featureObj.attributes ?? (feature as Record<string, unknown>);
    if (!attrs || typeof attrs !== "object") continue;

    const parcelId = pickField(attrs, HEADER_MAP.parcelId);
    const address = pickField(attrs, HEADER_MAP.address) || composeAddress(attrs);
    const city = pickField(attrs, HEADER_MAP.city);
    const municipality = pickField(attrs, ["MUNICIPALITY", "CITY"]) ?? city;
    const mailingAddress = pickField(attrs, HEADER_MAP.mailingAddress);
    const state = pickField(attrs, HEADER_MAP.state) || "FL";
    const zip = pickField(attrs, HEADER_MAP.zip);
    const ownerName = pickField(attrs, HEADER_MAP.owner);
    const assetType = pickField(attrs, HEADER_MAP.assetType);
    const propertyUseCode = pickField(attrs, ["USE_CODE", "PROPERTY_USE", "DOR_UC", "CLASS_CODE"]) ?? assetType;
    const lotSizeSqftRaw = toNumber(pickField(attrs, HEADER_MAP.lotSizeSqft));
    const lotSizeAcres = toNumber(pickField(attrs, HEADER_MAP.lotSizeAcres));
    const lotSizeSqft = typeof lotSizeAcres === "number" && lotSizeAcres > 0 ? lotSizeAcres * 43560 : lotSizeSqftRaw;
    const buildingSizeSqft = toNumber(pickField(attrs, HEADER_MAP.buildingSizeSqft));
    const yearBuilt = toNumber(pickField(attrs, HEADER_MAP.yearBuilt));
    const zoning = pickField(attrs, HEADER_MAP.zoning);
    const askingPrice = pickBestPrice(attrs);
    const explicitPricePerSqft = toNumber(pickField(attrs, HEADER_MAP.pricePerSqft));
    const fallbackPricePerSqft =
      askingPrice && buildingSizeSqft && buildingSizeSqft > 0 ? askingPrice / buildingSizeSqft : undefined;
    const pricePerSqft = explicitPricePerSqft ?? fallbackPricePerSqft;

    const attributeLatitude = toNumber(pickField(attrs, HEADER_MAP.latitude));
    const attributeLongitude = toNumber(pickField(attrs, HEADER_MAP.longitude));
    const geometryPoint = extractGeometryPoint(featureObj);
    let latitude = geometryPoint?.latitude ?? attributeLatitude;
    let longitude = geometryPoint?.longitude ?? attributeLongitude;

    if ((latitude === undefined || longitude === undefined) && address) {
      const geocoded = await geocodeAddress(address, city, state, zip);
      if (geocoded) {
        latitude = geocoded.latitude;
        longitude = geocoded.longitude;
      }
    }

    const name = address || (parcelId ? `Parcel ${parcelId}` : "Parcel Record");

    let deal = null;
    if (parcelId) {
      deal = await prisma.deal.findFirst({ where: { parcelId } });
    } else if (address) {
      deal = await prisma.deal.findFirst({ where: { address, city, zip } });
    }

    const score = computeScore({
      parcelId,
      address,
      city,
      zip,
      source,
      hasOwner: Boolean(ownerName),
    });
    const dataCompletenessScore = computeCompletenessScore({
      parcelId,
      address,
      city,
      zip,
      propertyUseCode,
      lotSizeSqft,
      buildingSizeSqft,
      yearBuilt: typeof yearBuilt === "number" ? Math.round(yearBuilt) : undefined,
      zoning,
      askingPrice,
      pricePerSqft,
      latitude,
      longitude,
    });

    if (!deal) {
      deal = await prisma.deal.create({
        data: {
          name,
          parcelId,
          address,
          mailingAddress,
          city,
          municipality,
          state,
          zip,
          assetType,
          propertyUseCode,
          latitude,
          longitude,
          lotSizeSqft,
          buildingSizeSqft,
          yearBuilt: typeof yearBuilt === "number" ? Math.round(yearBuilt) : undefined,
          zoning,
          askingPrice,
          pricePerSqft,
          source,
          market,
          score,
          dataCompletenessScore,
        },
      });
      createdDeals += 1;
    } else {
      await prisma.deal.update({
        where: { id: deal.id },
        data: {
          name,
          parcelId: parcelId ?? deal.parcelId,
          address: address ?? deal.address,
          mailingAddress: mailingAddress ?? deal.mailingAddress,
          city: city ?? deal.city,
          municipality: municipality ?? deal.municipality,
          state: state ?? deal.state,
          zip: zip ?? deal.zip,
          assetType: assetType ?? deal.assetType,
          propertyUseCode: propertyUseCode ?? deal.propertyUseCode,
          latitude: latitude ?? deal.latitude,
          longitude: longitude ?? deal.longitude,
          lotSizeSqft: lotSizeSqft ?? deal.lotSizeSqft,
          buildingSizeSqft: buildingSizeSqft ?? deal.buildingSizeSqft,
          yearBuilt: typeof yearBuilt === "number" ? Math.round(yearBuilt) : deal.yearBuilt,
          zoning: zoning ?? deal.zoning,
          askingPrice: askingPrice ?? deal.askingPrice,
          pricePerSqft: pricePerSqft ?? deal.pricePerSqft,
          source: deal.source ?? source,
          market: deal.market ?? market,
          score,
          dataCompletenessScore,
        },
      });
      updatedDeals += 1;
    }

    if (ownerName && deal) {
      let owner = await prisma.owner.findFirst({ where: { name: ownerName } });
      if (!owner) {
        owner = await prisma.owner.create({ data: { name: ownerName } });
        createdOwners += 1;
      }

      await prisma.dealOwner.upsert({
        where: {
          dealId_ownerId: {
            dealId: deal.id,
            ownerId: owner.id,
          },
        },
        update: {},
        create: { dealId: deal.id, ownerId: owner.id },
      });
      linkedOwners += 1;
    }
  }

  return { createdDeals, updatedDeals, createdOwners, linkedOwners };
}
