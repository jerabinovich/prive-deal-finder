import { PrismaService } from "../shared/prisma.service";
import { computeTriageScore } from "../scoring/score";
import { geocodeAddress } from "./geocoding";
import { resolveDorUseCode } from "./dor-use-codes";
import { CAMPOS_CIUDAD_DEL_SITIO, CAMPOS_ZIP_DEL_SITIO, normalizarZip, zipGuardado, zipPorCoordenadas } from "./zip";
import { domicilioDeLaCapa } from "./domicilio-postal";
import { foliosDescartados } from "./descartados";
import { CAMPOS_ZONING } from "./zoning";
import { computeDealCompletenessScore, esFuenteDeParcelas } from "../deals/deals.utils";

const HEADER_MAP: Record<string, string[]> = {
  parcelId: ["PARCEL_ID", "PARCELID", "FOLIO", "PARID", "PARCELNO", "PARCEL_NO", "LOWPARCELI", "PARCEL_NUMBER", "FOLIO_NUMBER"],
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
  city: CAMPOS_CIUDAD_DEL_SITIO,
  mailingAddress: ["MAIL_ADDR", "MAILING_ADDRESS", "OWNER_MAILING_ADDRESS", "PSTLADDRESS"],
  // 14-oct-2026: STATE y PSTLSTATE son el estado del domicilio postal del dueno (Palm Beach los trae asi), y un
  // dueno de Michigan dejaba el deal en "MI". Las fuentes son condados de Florida: sin estado del sitio, queda FL.
  state: ["SITUS_STATE"],
  zip: CAMPOS_ZIP_DEL_SITIO,
  owner: ["OWNER_NAME1", "OWNER_NAME2", "OWNER_NAME", "OWNERNME1", "OWNERNME2", "OWNER", "OWN_NAME", "NAME", "CNVYNAME", "NAME_LINE_1"],
  assetType: ["PROPERTY_USE", "USEDSCRP", "PRPRTYDSCR", "CLASSDSCRP", "DOR_DESC"],
  // 23-oct-2026: fuera LAND_GROSS. En Broward (BCPA capa 36) es un monto en dolares ("$163"), y se
  // guardaba como superficie: el lote mediano de Broward daba 101 sqft. Esa capa no trae superficie.
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
    "BLDG_ADJ_SQ_FOOTAGE",
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
  zoning: CAMPOS_ZONING,
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

function composeAddress(record: Record<string, unknown>) {
  const parts = [
    // Broward (BCPA) parte la direccion en 5 campos SITUS_*; el resto de los
    // condados usa los nombres cortos. Se aceptan los dos.
    pickField(record, ["STREET_NUMBER", "SITUS_STREET_NUMBER"]),
    pickField(record, ["STREET_FRACTION"]),
    pickField(record, ["PRE_DIR", "SITUS_STREET_DIRECTION"]),
    pickField(record, ["STREET_NAME", "SITUS_STREET_NAME"]),
    pickField(record, ["STREET_SUFFIX_ABBR", "SITUS_STREET_TYPE"]),
    pickField(record, ["POST_DIR", "SITUS_STREET_POST_DIR"]),
    pickField(record, ["BUILDING"]),
    pickField(record, ["UNIT", "SITUS_UNIT_NUMBER"]),
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
  // 14-oct-2026: los folios que JR pidio sacar no se crean ni se actualizan (descartados.ts).
  const descartados = await foliosDescartados(
    prisma,
    features.map((f) => {
      const o = (f || {}) as { attributes?: Record<string, unknown> };
      const a = (o.attributes ?? f) as Record<string, unknown> | null;
      return a && typeof a === "object" ? pickField(a, HEADER_MAP.parcelId) : undefined;
    }),
  );
  let saltados = 0;

  for (const feature of features) {
    const featureObj = (feature || {}) as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> };
    const attrs = featureObj.attributes ?? (feature as Record<string, unknown>);
    if (!attrs || typeof attrs !== "object") continue;

    const parcelId = pickField(attrs, HEADER_MAP.parcelId);
    if (parcelId && descartados.has(parcelId)) {
      saltados += 1;
      continue;
    }
    const address = pickField(attrs, HEADER_MAP.address) || composeAddress(attrs);
    const city = pickField(attrs, HEADER_MAP.city);
    const municipality = pickField(attrs, ["MUNICIPALITY", "CITY"]) ?? city;
    // 13-oct-2026: Palm Beach trae el domicilio postal del dueno en PADDR1 a PADDR3 (domicilio-postal.ts).
    const mailingAddress = pickField(attrs, HEADER_MAP.mailingAddress) ?? domicilioDeLaCapa(attrs);
    const state = pickField(attrs, HEADER_MAP.state) || "FL";
    const zipDeLaCapa = normalizarZip(pickField(attrs, HEADER_MAP.zip)) ?? undefined;
    const ownerName = pickField(attrs, HEADER_MAP.owner);
    // 13-sep-2026: Broward manda USE_CODE numerico (codigo DOR de Florida) en vez
    // de descripcion; el resto de los condados manda texto. resolveDorUseCode
    // traduce solo si es un codigo pelado y deja pasar el texto tal cual.
    const rawUseCode = pickField(attrs, ["USE_CODE", "PROPERTY_USE", "DOR_UC", "CLASS_CODE"]);
    const useCodeLabel = resolveDorUseCode(rawUseCode);
    const assetType = pickField(attrs, HEADER_MAP.assetType) ?? useCodeLabel;
    const propertyUseCode = useCodeLabel ?? assetType;
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
      const geocoded = await geocodeAddress(address, city, state, zipDeLaCapa);
      if (geocoded) {
        latitude = geocoded.latitude;
        longitude = geocoded.longitude;
      }
    }

    const name = address || (parcelId ? `Parcel ${parcelId}` : "Parcel Record");

    let deal = parcelId ? await prisma.deal.findFirst({ where: { parcelId } }) : null;

    // 13-oct-2026: si la capa no trae el zip del sitio (Palm Beach nunca, Broward a veces "0"), sale de las
    // coordenadas de la parcela contra las ZCTA del Census. Sin coordenadas queda vacio: no se adivina.
    // 31-oct-2026: si la parcela ya tiene zip y no se movio, ese es el zip: el Census daria el mismo. Antes cada
    // resincronizacion de Palm Beach consultaba al Census una vez por parcela, con 8 s de espera; el 29 y el 30 oct
    // el Census no contesto y la corrida de 500 parcelas tardo 67 y 45 minutos en vez de uno.
    const zip = zipDeLaCapa ?? zipGuardado(deal, latitude, longitude) ?? (await zipPorCoordenadas(latitude, longitude)) ?? undefined;

    if (!deal && !parcelId && address) {
      deal = await prisma.deal.findFirst({ where: { address, city, zip } });
    }

    // 12-sep-2026: el ingest NUNCA llamaba a detectNoiseReason, por eso isNoise
    // quedaba en false para los 72 deals (default del schema) y parcelas de
    // ferrocarril / baldios del condado pasaban el filtro con nota alta.
    // 25-oct-2026: si la capa no trae dueno (la de parcelas de Miami-Dade no lo trae), el score usa los duenos que el
    // deal ya tiene guardados, como recalcularPuntaje y recalcularDistressYPuntaje. Antes la ingesta le sacaba el
    // bono de dueno (+10 corporativo, +6 particular) en cada pasada: medido el 25-oct, 4.193 deals de Miami-Dade.
    const ownerNames = ownerName
      ? [ownerName]
      : deal
        ? (await prisma.dealOwner.findMany({ where: { dealId: deal.id }, select: { owner: { select: { name: true } } } }))
            .map((item) => item.owner?.name)
            .filter((name): name is string => Boolean(name))
        : [];
    const triage = computeTriageScore({
      assetType,
      propertyUseCode,
      ownerNames,
      mailingAddress,
      source,
      city,
      municipality,
      state,
      yearBuilt: typeof yearBuilt === "number" ? Math.round(yearBuilt) : undefined,
      // 23-oct-2026: Broward no trae lote en su capa; el que cargo el catastro estatal (catastro-valores.ts) cuenta.
      lotSizeSqft: lotSizeSqft ?? deal?.lotSizeSqft ?? undefined,
      // 13-oct-2026: un deal que ya existe conserva su etapa de distress. Sin esto, la resincronizacion
      // diaria de parcelas le borraba el premio de distress del score hasta la proxima corrida judicial.
      distressStage: deal?.distressStage,
    });
    const score = triage.score;
    // 25-oct-2026: la completitud se calcula sobre lo que queda guardado (lo de la capa y, si falta, lo que el deal ya
    // tenia, como el lote que cargo el catastro), no solo sobre la capa. En parcelas no hay precio pedido (esFuenteDeParcelas).
    const fuenteDelDeal = deal?.source ?? source;
    const sinPrecioPedido = esFuenteDeParcelas(fuenteDelDeal);
    const precioPedido = sinPrecioPedido ? null : askingPrice ?? deal?.askingPrice ?? null;
    const precioPorSqft = sinPrecioPedido ? null : pricePerSqft ?? deal?.pricePerSqft ?? null;
    const dataCompletenessScore = computeDealCompletenessScore({
      parcelId: parcelId ?? deal?.parcelId,
      address: address ?? deal?.address,
      city: city ?? deal?.city,
      zip: zip ?? deal?.zip,
      propertyUseCode: propertyUseCode ?? deal?.propertyUseCode,
      lotSizeSqft: lotSizeSqft ?? deal?.lotSizeSqft,
      buildingSizeSqft: buildingSizeSqft ?? deal?.buildingSizeSqft,
      yearBuilt: typeof yearBuilt === "number" ? Math.round(yearBuilt) : deal?.yearBuilt,
      zoning: zoning ?? deal?.zoning,
      askingPrice: precioPedido,
      pricePerSqft: precioPorSqft,
      latitude: latitude ?? deal?.latitude,
      longitude: longitude ?? deal?.longitude,
      source: fuenteDelDeal,
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
          askingPrice: precioPedido ?? undefined,
          pricePerSqft: precioPorSqft ?? undefined,
          source,
          market,
          score,
          dataCompletenessScore,
          isNoise: triage.isNoise,
          noiseReason: triage.noiseReason,
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
          askingPrice: precioPedido,
          pricePerSqft: precioPorSqft,
          source: deal.source ?? source,
          market: deal.market ?? market,
          score,
          dataCompletenessScore,
          isNoise: triage.isNoise,
          noiseReason: triage.noiseReason,
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

  return { createdDeals, updatedDeals, createdOwners, linkedOwners, descartados: saltados };
}
