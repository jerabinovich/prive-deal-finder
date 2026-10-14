import { foliosDescartados } from "./descartados";
import { ingestArcgisRecords } from "./arcgis.ingest";
import { zipPorCoordenadas } from "./zip";

jest.mock("./zip", () => ({ ...jest.requireActual("./zip"), zipPorCoordenadas: jest.fn().mockResolvedValue("33132") }));
void zipPorCoordenadas;

function prismaFalso(descartados: string[]) {
  return {
    folioDescartado: {
      findMany: jest.fn().mockImplementation(async (args: { where: { parcelId: { in: string[] } } }) =>
        descartados.filter((d) => args.where.parcelId.in.includes(d)).map((parcelId) => ({ parcelId })),
      ),
    },
    deal: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "nuevo" }),
      update: jest.fn().mockResolvedValue({ id: "viejo" }),
    },
    owner: { findFirst: jest.fn(), create: jest.fn() },
    dealOwner: { upsert: jest.fn() },
  };
}

const parcela = (folio: string) => ({
  attributes: { FOLIO: folio, TRUE_SITE_ADDR: "401 BISCAYNE BLVD", TRUE_SITE_CITY: "Miami", TRUE_SITE_ZIP_CODE: "33132" },
  geometry: { x: -80.1852, y: 25.7784 },
});

describe("folios descartados", () => {
  it("devuelve solo los folios de la lista, sin repetir ni vacios", async () => {
    const prisma = prismaFalso(["0101000000520"]);
    const r = await foliosDescartados(prisma as never, ["0101000000520", "0101000000520", "", null, "0101000000999"]);
    expect([...r]).toEqual(["0101000000520"]);
    expect(prisma.folioDescartado.findMany.mock.calls[0][0].where.parcelId.in).toEqual(["0101000000520", "0101000000999"]);
  });

  it("sin delegado (prisma de prueba) no hay descartados y no se cae", async () => {
    expect((await foliosDescartados({} as never, ["0101000000520"])).size).toBe(0);
  });

  it("la ingesta no crea ni actualiza un folio descartado y sigue con el resto", async () => {
    const prisma = prismaFalso(["0101000000520"]);
    const r = await ingestArcgisRecords(prisma as never, "miami-dade-parcels", "Miami-Dade", [parcela("0101000000520"), parcela("0101000000999")]);
    expect(prisma.deal.create).toHaveBeenCalledTimes(1);
    expect(prisma.deal.create.mock.calls[0][0].data.parcelId).toBe("0101000000999");
    expect(prisma.deal.findFirst).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ createdDeals: 1, descartados: 1 });
  });
});
