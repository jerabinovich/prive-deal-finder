import { ingestArcgisRecords } from "./arcgis.ingest";
import { zipPorCoordenadas } from "./zip";
import { computeDealCompletenessScore, esFuenteDeParcelas } from "../deals/deals.utils";
import { DealsFactsService } from "../deals/deals-facts.service";

// 25-oct-2026 (decision de JR): askingPrice solo existe en listings y brokers. En parcelas queda vacio; la tasacion y
// la venta son referencia en MdpaAssessment y MdpaSale. La completitud se calcula sobre lo que queda guardado.

jest.mock("./zip", () => ({ ...jest.requireActual("./zip"), zipPorCoordenadas: jest.fn() }));
const zipMock = zipPorCoordenadas as jest.MockedFunction<typeof zipPorCoordenadas>;
afterEach(() => zipMock.mockReset());

function prismaIngesta(existente: Record<string, unknown> | null) {
  return {
    deal: {
      findFirst: jest.fn().mockResolvedValue(existente),
      create: jest.fn().mockResolvedValue({ id: "nuevo" }),
      update: jest.fn().mockResolvedValue({ id: "viejo" }),
    },
    owner: { findFirst: jest.fn(), create: jest.fn() },
    dealOwner: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  };
}

const PALM_BEACH = {
  attributes: {
    PARCEL_NUMBER: "74434317060000010", SITUS_ADDRESS: "100 OCEAN AVE", SITUS_CITY: "Lantana", SITUS_ZIP_CODE: "33462",
    USE_CODE: "01", JUST_VALUE: 205000, BLDG_ADJ_SQ_FOOTAGE: 1000, YEAR_BUILT: 1970,
  },
  geometry: { x: -80.05, y: 26.58 },
};

describe("esFuenteDeParcelas", () => {
  it("las fuentes de condado son parcelas; los brokers y listings no", () => {
    for (const s of ["miami-dade-parcels", "broward-parcels", "palm-beach-parcels", "monroe-parcels", "martin-parcels", "mdpa", " Broward-Parcels "])
      expect(esFuenteDeParcelas(s)).toBe(true);
    for (const s of ["broker_email - Max Ballas, Apex Capital Realty", "OpportunityRE_FastScan - Silvina Disla, One Sotheby's", "", null, undefined])
      expect(esFuenteDeParcelas(s)).toBe(false);
  });
});

describe("computeDealCompletenessScore", () => {
  const completo = {
    parcelId: "1", address: "1 MAIN", city: "MIAMI", zip: "33101", propertyUseCode: "01", lotSizeSqft: 5000,
    buildingSizeSqft: 1500, yearBuilt: 1960, zoning: "RS", askingPrice: null, pricePerSqft: null, latitude: 25.7, longitude: -80.2,
  };
  it("una parcela sin precio pedido puede estar completa", () => {
    expect(computeDealCompletenessScore({ ...completo, source: "broward-parcels" })).toBe(100);
  });
  it("un broker sin precio pedido sigue incompleto (11 de 13)", () => {
    expect(computeDealCompletenessScore({ ...completo, source: "broker_email - X" })).toBe(84.6);
    expect(computeDealCompletenessScore(completo)).toBe(84.6);
  });
});

describe("ingesta de parcelas sin precio pedido", () => {
  it("un deal nuevo de parcela no copia la tasacion a askingPrice ni calcula precio por sqft", async () => {
    const prisma = prismaIngesta(null);
    await ingestArcgisRecords(prisma as never, "palm-beach-parcels", "Palm Beach", [PALM_BEACH]);
    const data = prisma.deal.create.mock.calls[0][0].data;
    expect(data.askingPrice).toBeUndefined();
    expect(data.pricePerSqft).toBeUndefined();
  });

  it("la resincronizacion vacia el askingPrice viejo de la parcela", async () => {
    const prisma = prismaIngesta({ id: "viejo", source: "palm-beach-parcels", askingPrice: 205000, pricePerSqft: 205, distressStage: "NONE" });
    await ingestArcgisRecords(prisma as never, "palm-beach-parcels", "Palm Beach", [PALM_BEACH]);
    const data = prisma.deal.update.mock.calls[0][0].data;
    expect(data.askingPrice).toBeNull();
    expect(data.pricePerSqft).toBeNull();
  });

  it("la completitud de la resincronizacion cuenta lo ya guardado, como el lote del catastro", async () => {
    zipMock.mockResolvedValue("33462");
    const sinLote = prismaIngesta({ id: "viejo", source: "palm-beach-parcels", lotSizeSqft: null, distressStage: "NONE" });
    const conLote = prismaIngesta({ id: "viejo", source: "palm-beach-parcels", lotSizeSqft: 7500, distressStage: "NONE" });
    await ingestArcgisRecords(sinLote as never, "palm-beach-parcels", "Palm Beach", [PALM_BEACH]);
    await ingestArcgisRecords(conLote as never, "palm-beach-parcels", "Palm Beach", [PALM_BEACH]);
    const a = sinLote.deal.update.mock.calls[0][0].data.dataCompletenessScore;
    const b = conLote.deal.update.mock.calls[0][0].data.dataCompletenessScore;
    expect(b).toBeGreaterThan(a);
    expect(Number((b - a).toFixed(1))).toBe(Number((100 / 11).toFixed(1)));
  });
});

describe("DealsFactsService con parcelas", () => {
  const base = {
    id: "d1", parcelId: null, address: "1 MAIN", mailingAddress: null, city: "MIAMI", municipality: "MIAMI", state: "FL",
    zip: "33101", assetType: "Residential", propertyUseCode: "01", lotSizeSqft: 5000, buildingSizeSqft: 1000,
    yearBuilt: 1960, zoning: "RS", pricePerSqft: null, dataCompletenessScore: 0, latitude: 25.7, longitude: -80.2,
  };
  function prismaFacts() {
    return {
      dealMetric: { findUnique: jest.fn().mockResolvedValue(null) },
      mdpaSale: { findFirst: jest.fn().mockResolvedValue({ salePrice: 300000 }) },
      mdpaAssessment: { findFirst: jest.fn().mockResolvedValue({ justValue: 250000, assessedValue: 240000, taxableValue: 230000 }) },
      deal: { update: jest.fn().mockResolvedValue({}) },
    };
  }

  it("a una parcela no le pone la venta como askingPrice, y le vacia el viejo", async () => {
    const prisma = prismaFacts();
    await new DealsFactsService(prisma as never).refreshFactsForDeal({ ...base, source: "palm-beach-parcels", askingPrice: 205000 });
    const data = prisma.deal.update.mock.calls[0][0].data;
    expect(data.askingPrice).toBeNull();
    expect(data.pricePerSqft).toBeUndefined();
  });

  it("a un broker sin precio le sigue poniendo la ultima venta", async () => {
    const prisma = prismaFacts();
    await new DealsFactsService(prisma as never).refreshFactsForDeal({ ...base, source: "broker_email - X", askingPrice: null });
    expect(prisma.deal.update.mock.calls[0][0].data.askingPrice).toBe(300000);
  });

  it("en una parcela el precio no cuenta como dato faltante", () => {
    const f = new DealsFactsService(null as never);
    const deal = { ...base, parcelId: "1", askingPrice: null, pricePerSqft: null };
    expect(f.hasMissingFacts({ ...deal, source: "monroe-parcels" })).toBe(false);
    expect(f.hasMissingFacts({ ...deal, source: "broker_email - X" })).toBe(true);
    expect(f.missingFactFields({ ...deal, source: "monroe-parcels" })).toEqual([]);
    expect(f.missingFactFields({ ...deal, source: "broker_email - X" })).toEqual(["askingPrice", "pricePerSqft"]);
  });
});
