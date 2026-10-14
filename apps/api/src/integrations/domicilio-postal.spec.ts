import {
  completarDomiciliosPostales,
  domicilioDeLaCapa,
  domiciliosEstatales,
  formatearDomicilioEstatal,
  mismoDueno,
} from "./domicilio-postal";

afterEach(() => jest.restoreAllMocks());

function rol(features: Array<Record<string, unknown>>) {
  const llamadas: string[] = [];
  jest.spyOn(global, "fetch").mockImplementation(async (entrada) => {
    llamadas.push(String(entrada));
    return { ok: true, json: async () => ({ features: features.map((attributes) => ({ attributes })) }) } as Response;
  });
  return llamadas;
}

describe("domicilio postal del dueno", () => {
  it("Palm Beach: PADDR1 a PADDR3 de su propia capa", () => {
    expect(domicilioDeLaCapa({ PADDR1: "PO BOX 12 ", PADDR2: null, PADDR3: "WEST PALM BEACH FL 33402 0012" })).toBe(
      "PO BOX 12, WEST PALM BEACH FL 33402 0012",
    );
    expect(domicilioDeLaCapa({ PADDR1: "", PADDR3: "MIAMI FL" })).toBeUndefined();
  });

  it("rol estatal: calle, ciudad, estado y zip de 5", () => {
    expect(formatearDomicilioEstatal({ OWN_ADDR1: "1 MAIN ST", OWN_ADDR2: "STE 2", OWN_CITY: "FORT LAUDERDALE", OWN_STATE: "FL", OWN_ZIPCD: 333011234 })).toBe(
      "1 MAIN ST, STE 2, FORT LAUDERDALE, FL 33301",
    );
    expect(formatearDomicilioEstatal({ OWN_ADDR1: "1 MAIN ST", OWN_CITY: "" })).toBeUndefined();
    // Broward manda el estado con el nombre entero; Miami-Dade a veces el zip en 0; los ceros a la izquierda se pierden
    expect(formatearDomicilioEstatal({ OWN_ADDR1: "9 A ST", OWN_CITY: "SUNRISE", OWN_STATE: "FLORIDA", OWN_STATE_: " ", OWN_ZIPCD: 33351 })).toBe(
      "9 A ST, SUNRISE, FL 33351",
    );
    expect(formatearDomicilioEstatal({ OWN_ADDR1: "8 B ST", OWN_CITY: "MIAMI", OWN_STATE: "FL", OWN_ZIPCD: 0 })).toBe("8 B ST, MIAMI, FL");
    expect(formatearDomicilioEstatal({ OWN_ADDR1: "7 C ST", OWN_CITY: "BOSTON", OWN_STATE: "Massachusetts", OWN_ZIPCD: 2108 })).toBe(
      "7 C ST, BOSTON, MA 02108",
    );
    expect(formatearDomicilioEstatal({ OWN_ADDR1: "6 D ST", OWN_CITY: "PALM BEACH", OWN_STATE: "Florida", OWN_STATE_: "FL", OWN_ZIPCD: 33480 })).toBe(
      "6 D ST, PALM BEACH, FL 33480",
    );
    expect(formatearDomicilioEstatal({ OWN_ADDR1: "5 E ST", OWN_CITY: "TORONTO", OWN_STATE: "ONTARIO CANADA", OWN_ZIPCD: 0 })).toBe(
      "5 E ST, TORONTO, ONTARIO CANADA",
    );
  });

  it("el dueno del rol tiene que ser el nuestro", () => {
    expect(mismoDueno("ANDREWS AVE RETAIL LLC", "ANDREWS AVE RETAIL LLC")).toBe(true);
    expect(mismoDueno("SMITH JOHN & MARY", "SMITH JOHN AND MARY H/E")).toBe(true);
    expect(mismoDueno("BINDRA INVESTMENTS INC", "CHAPEL TRAIL HOLDINGS LLC")).toBe(false);
    expect(mismoDueno(null, "CUALQUIERA")).toBe(true);
    expect(mismoDueno("ALGUIEN", "")).toBe(false);
  });

  it("consulta el rol por condado y folio, sin paginar, y deja afuera lo que no tiene domicilio", async () => {
    const llamadas = rol([
      { PARCEL_ID: "494330CB2161", OWN_NAME: "X LLC", OWN_ADDR1: "1 MAIN ST", OWN_CITY: "MIAMI", OWN_STATE: "FL", OWN_ZIPCD: "33131" },
      { PARCEL_ID: "494330CB2170", OWN_NAME: "Y LLC", OWN_ADDR1: "", OWN_CITY: "MIAMI" },
    ]);
    const r = await domiciliosEstatales(16, ["494330CB2161", "494330-CB-2170", "corto"], "https://rol/0");
    expect(llamadas).toHaveLength(1);
    expect(decodeURIComponent(llamadas[0])).toContain("CO_NO = 16 AND PARCEL_ID IN ('494330CB2161','494330CB2170')");
    expect(r.get("494330CB2161")).toEqual({ nombre: "X LLC", domicilio: "1 MAIN ST, MIAMI, FL 33131" });
    expect(r.has("494330CB2170")).toBe(false);
  });

  it("completa solo deals sin domicilio, y no escribe si el dueno es otro", async () => {
    rol([
      { PARCEL_ID: "111111110000", OWN_NAME: "DUENO UNO LLC", OWN_ADDR1: "1 A ST", OWN_CITY: "MIAMI", OWN_STATE: "FL", OWN_ZIPCD: "33131" },
      { PARCEL_ID: "222222220000", OWN_NAME: "VENDEDOR VIEJO LLC", OWN_ADDR1: "2 B ST", OWN_CITY: "MIAMI", OWN_STATE: "FL", OWN_ZIPCD: "33131" },
      { PARCEL_ID: "333333330000", OWN_NAME: "SIN DUENO NUESTRO", OWN_ADDR1: "3 C ST", OWN_CITY: "MIAMI", OWN_STATE: "FL", OWN_ZIPCD: "33131" },
    ]);
    const escritos: Array<{ id: string; mailingAddress: string }> = [];
    const prisma = {
      deal: {
        findMany: jest.fn().mockResolvedValue([
          { id: "a", parcelId: "111111110000", owners: [{ owner: { name: "DUENO UNO LLC" } }] },
          { id: "b", parcelId: "222222220000", owners: [{ owner: { name: "COMPRADOR NUEVO LLC" } }] },
          { id: "c", parcelId: "333333330000", owners: [] },
          { id: "d", parcelId: "444444440000", owners: [] },
        ]),
        updateMany: jest.fn().mockImplementation(async (args: { where: { id: string }; data: { mailingAddress: string } }) => {
          escritos.push({ id: args.where.id, mailingAddress: args.data.mailingAddress });
          return { count: 1 };
        }),
      },
    };
    const r = await completarDomiciliosPostales(prisma as never, "broward-parcels", 500, "https://rol/0");
    expect(r).toEqual({ revisados: 4, escritos: 2, duenoDistinto: 1 });
    expect(escritos).toEqual([
      { id: "a", mailingAddress: "1 A ST, MIAMI, FL 33131" },
      { id: "c", mailingAddress: "3 C ST, MIAMI, FL 33131" },
    ]);
    const filtro = prisma.deal.findMany.mock.calls[0][0].where;
    expect(filtro.source).toBe("broward-parcels");
    expect(filtro.OR).toEqual([{ mailingAddress: null }, { mailingAddress: "" }]);
  });

  it("una fuente sin condado conocido no consulta nada", async () => {
    const prisma = { deal: { findMany: jest.fn(), updateMany: jest.fn() } };
    const r = await completarDomiciliosPostales(prisma as never, "amanda");
    expect(r.revisados).toBe(0);
    expect(prisma.deal.findMany).not.toHaveBeenCalled();
  });
});
