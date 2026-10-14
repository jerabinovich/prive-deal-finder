import { ingestArcgisRecords } from "./arcgis.ingest";
import { zipPorCoordenadas } from "./zip";

jest.mock("./zip", () => ({ ...jest.requireActual("./zip"), zipPorCoordenadas: jest.fn() }));
const zipMock = zipPorCoordenadas as jest.MockedFunction<typeof zipPorCoordenadas>;

function prismaFalso(existente: Record<string, unknown> | null) {
  return {
    deal: {
      findFirst: jest.fn().mockResolvedValue(existente),
      create: jest.fn().mockResolvedValue({ id: "nuevo" }),
      update: jest.fn().mockResolvedValue({ id: "viejo" }),
    },
    owner: { findFirst: jest.fn(), create: jest.fn() },
    dealOwner: { upsert: jest.fn() },
  };
}

const LOCAL = {
  attributes: {
    FOLIO_NUMBER: "494227000171",
    SITUS_ADDRESS: "2701 N ANDREWS AVE",
    SITUS_CITY: "Wilton Manors",
    SITUS_ZIP_CODE: "0",
    USE_CODE: "11",
  },
  geometry: { x: -80.1464, y: 26.1606 },
};

afterEach(() => zipMock.mockReset());

describe("ingestArcgisRecords", () => {
  it("sin zip en la capa, el zip del sitio sale de las coordenadas", async () => {
    zipMock.mockResolvedValue("33311");
    const prisma = prismaFalso(null);
    await ingestArcgisRecords(prisma as never, "broward-parcels", "Broward", [LOCAL]);
    expect(zipMock).toHaveBeenCalledWith(26.1606, -80.1464);
    expect(prisma.deal.create.mock.calls[0][0].data).toMatchObject({
      zip: "33311", city: "Wilton Manors", latitude: 26.1606, longitude: -80.1464,
    });
  });

  it("con zip valido en la capa no consulta al Census", async () => {
    const prisma = prismaFalso(null);
    await ingestArcgisRecords(prisma as never, "broward-parcels", "Broward", [
      { ...LOCAL, attributes: { ...LOCAL.attributes, SITUS_ZIP_CODE: "333111234" } },
    ]);
    expect(zipMock).not.toHaveBeenCalled();
    expect(prisma.deal.create.mock.calls[0][0].data.zip).toBe("33311");
  });

  it("la resincronizacion de un deal con distress no le borra el premio del score", async () => {
    zipMock.mockResolvedValue("33311");
    const conDistress = prismaFalso({ id: "viejo", distressStage: "PRE_FORECLOSURE" });
    const sinDistress = prismaFalso({ id: "viejo", distressStage: "NONE" });
    await ingestArcgisRecords(conDistress as never, "broward-parcels", "Broward", [LOCAL]);
    await ingestArcgisRecords(sinDistress as never, "broward-parcels", "Broward", [LOCAL]);
    const con = conDistress.deal.update.mock.calls[0][0].data.score;
    const sin = sinDistress.deal.update.mock.calls[0][0].data.score;
    // PRE_FORECLOSURE suma 40 en computeTriageScore; el resto del deal es identico.
    expect(con - sin).toBe(40);
  });
});
