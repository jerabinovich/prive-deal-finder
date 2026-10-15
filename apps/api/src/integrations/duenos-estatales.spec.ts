import { completarDuenosEstatales, duenosEstatales, ROL_ESTATAL } from "./domicilio-postal";

function catastro(filas: Array<Record<string, unknown>>) {
  const urls: string[] = [];
  (global as any).fetch = jest.fn(async (url: string) => {
    urls.push(decodeURIComponent(url));
    return { ok: true, json: async () => ({ features: filas.map((attributes) => ({ attributes })) }) };
  });
  return urls;
}

function prismaMock(deals: Array<{ id: string; parcelId: string }>, existentes: Record<string, string> = {}) {
  const creados: string[] = [];
  const vinculos: Array<Record<string, unknown>> = [];
  const mock: any = {
    deal: { findMany: jest.fn(async () => deals) },
    owner: {
      findFirst: jest.fn(async ({ where }: any) => (existentes[where.name] ? { id: existentes[where.name] } : null)),
      create: jest.fn(async ({ data }: any) => {
        creados.push(data.name);
        return { id: `nuevo-${data.name}` };
      }),
    },
    dealOwner: { upsert: jest.fn(async ({ create }: any) => vinculos.push(create)) },
  };
  return { mock, creados, vinculos };
}

const ORIGINAL = global.fetch;
afterAll(() => {
  (global as any).fetch = ORIGINAL;
});

describe("dueno del rol estatal para Miami-Dade", () => {
  it("vincula el dueno del rol a los deals sin dueno, marcado como ROL_ESTATAL, y reusa un dueno que ya existe", async () => {
    const urls = catastro([
      { PARCEL_ID: "0141370390010", OWN_NAME: "ACME  HOLDINGS LLC" },
      { PARCEL_ID: "0141370390020", OWN_NAME: "MIAMI-DADE COUNTY" },
    ]);
    const { mock, creados, vinculos } = prismaMock(
      [{ id: "d1", parcelId: "01-4137-039-0010" }, { id: "d2", parcelId: "0141370390020" }, { id: "d3", parcelId: "0141370390030" }],
      { "MIAMI-DADE COUNTY": "o-county" },
    );
    const r = await completarDuenosEstatales(mock, "miami-dade-parcels");
    expect(r).toEqual({ revisados: 3, vinculados: 2, sinFila: 1 });
    expect(creados).toEqual(["ACME HOLDINGS LLC"]);
    expect(vinculos).toEqual([
      { dealId: "d1", ownerId: "nuevo-ACME HOLDINGS LLC", role: ROL_ESTATAL },
      { dealId: "d2", ownerId: "o-county", role: ROL_ESTATAL },
    ]);
    expect(mock.deal.findMany.mock.calls[0][0].where).toMatchObject({ source: "miami-dade-parcels", owners: { none: {} } });
    expect(urls[0]).toContain("CO_NO = 23 AND PARCEL_ID IN ('0141370390010','0141370390020','0141370390030')");
  });

  it("no toca fuentes cuya capa trae el dueno, ni sale a la red", async () => {
    const urls = catastro([]);
    const { mock } = prismaMock([{ id: "d1", parcelId: "494227000171" }]);
    expect(await completarDuenosEstatales(mock, "broward-parcels")).toEqual({ revisados: 0, vinculados: 0, sinFila: 0 });
    expect(mock.deal.findMany).not.toHaveBeenCalled();
    expect(urls).toHaveLength(0);
  });

  it("un dueno vacio en el rol no se escribe; un lote que falla no frena", async () => {
    catastro([{ PARCEL_ID: "0141370390010", OWN_NAME: "  " }]);
    expect((await duenosEstatales(23, ["0141370390010"])).size).toBe(0);
    (global as any).fetch = jest.fn(async () => {
      throw new Error("red");
    });
    expect((await duenosEstatales(23, ["0141370390010"])).size).toBe(0);
  });
});
