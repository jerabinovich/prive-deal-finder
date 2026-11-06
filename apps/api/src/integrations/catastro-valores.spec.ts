import {
  CONDADO_POR_FUENTE, VENTAS_DEL_CONDADO, aplicarValores, consultaArcgis, enriquecerConCatastro, consultarCatastro, consultarVentasDelCondado, guardarVentas,
  valoresDeFila, ventaBroward, ventaPalmBeach,
} from "./catastro-valores";

const FILA = {
  attributes: {
    CO_NO: 16, PARCEL_ID: "494126380040", ASMNT_YR: 2026, JV: 368640, AV_NSD: 124370, TV_NSD: 99370,
    LND_VAL: 10740, LND_SQFOOT: 2262,
    SALE_PRC1: 455000, SALE_YR1: 2025, SALE_MO1: "07", QUAL_CD1: "01",
    SALE_PRC2: 100, SALE_YR2: 2025, SALE_MO2: "03", QUAL_CD2: "11",
  },
};

describe("valoresDeFila", () => {
  it("separa la tasacion de la venta y solo guarda ventas de mercado (codigo 01)", () => {
    const v = valoresDeFila(FILA.attributes)!;
    expect(v).toMatchObject({ parcelId: "494126380040", taxYear: 2026, justValue: 368640, assessedValue: 124370, taxableValue: 99370, lotSizeSqft: 2262 });
    expect(v.ventas).toEqual([{ saleDate: new Date(Date.UTC(2025, 6, 1)), salePrice: 455000, saleType: "FDOR 01" }]);
  });

  it("ceros y blancos del estado quedan en null, sin ventas", () => {
    const v = valoresDeFila({ PARCEL_ID: "X", ASMNT_YR: 2026, JV: 0, AV_NSD: 0, TV_NSD: 0, LND_SQFOOT: 0, SALE_PRC1: 0, SALE_YR1: 0, SALE_MO1: " ", QUAL_CD1: " " })!;
    expect(v).toMatchObject({ justValue: null, assessedValue: null, taxableValue: null, lotSizeSqft: null, ventas: [] });
  });

  it("descarta transferencias de varias parcelas (37) aunque el precio sea alto", () => {
    const v = valoresDeFila({ ...FILA.attributes, QUAL_CD1: "37", SALE_PRC1: 44888400 })!;
    expect(v.ventas).toEqual([]);
  });

  it("sin folio o sin anio no hay valores", () => {
    expect(valoresDeFila({ ASMNT_YR: 2026, JV: 1 })).toBeNull();
    expect(valoresDeFila({ PARCEL_ID: "X", JV: 1 })).toBeNull();
  });
});

describe("consultarCatastro", () => {
  it("pide por condado y en lotes, y devuelve por folio", async () => {
    const buscar = jest.fn().mockResolvedValue([FILA]);
    const folios = Array.from({ length: 450 }, (_, i) => `F${i}`);
    const r = await consultarCatastro(16, folios, buscar);
    expect(buscar).toHaveBeenCalledTimes(3);
    const where = buscar.mock.calls[0][1] as string;
    expect(where.startsWith("CO_NO=16 AND PARCEL_ID IN ('F0','F1'")).toBe(true);
    expect(r.get("494126380040")?.justValue).toBe(368640);
  });

  it("escapa comillas del folio", async () => {
    const buscar = jest.fn().mockResolvedValue([]);
    await consultarCatastro(54, ["A'B"], buscar);
    expect(buscar.mock.calls[0][1]).toContain("'A''B'");
  });

  it("los cinco condados de las fuentes de parcelas", () => {
    expect(CONDADO_POR_FUENTE).toEqual({
      "miami-dade-parcels": 23, "broward-parcels": 16, "palm-beach-parcels": 60, "monroe-parcels": 54, "martin-parcels": 53,
    });
  });
});

function prismaFalso(opciones: { tasacion?: unknown; ventas?: unknown[] } = {}) {
  return {
    mdpaAssessment: {
      findFirst: jest.fn().mockResolvedValue(opciones.tasacion ?? null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    mdpaSale: {
      findFirst: jest.fn().mockImplementation(async () => (opciones.ventas ?? []).shift() ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
    deal: { update: jest.fn().mockResolvedValue({}) },
  };
}

describe("aplicarValores", () => {
  const v = valoresDeFila(FILA.attributes)!;

  it("crea la tasacion, la venta y el lote que faltaba", async () => {
    const prisma = prismaFalso();
    const r = await aplicarValores(prisma as never, { id: "d1", lotSizeSqft: null }, v, "snap");
    expect(prisma.mdpaAssessment.create.mock.calls[0][0].data).toEqual({
      dealId: "d1", taxYear: 2026, justValue: 368640, assessedValue: 124370, taxableValue: 99370, sourceSnapshotId: "snap",
    });
    expect(prisma.mdpaSale.create.mock.calls[0][0].data).toMatchObject({ dealId: "d1", salePrice: 455000, saleType: "FDOR 01", sourceSnapshotId: "snap" });
    expect(prisma.deal.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { lotSizeSqft: 2262, dataCompletenessScore: 7.7 } });
    expect(r).toEqual({ tasacion: "nueva", ventasNuevas: 1, lote: true });
  });

  it("al cargar el lote recalcula la completitud de la parcela, sin precio pedido", async () => {
    const prisma = prismaFalso();
    const parcela = {
      id: "d2", source: "broward-parcels", parcelId: "504201010010", address: "1 MAIN ST", city: "HOLLYWOOD", zip: "33020",
      propertyUseCode: "01", lotSizeSqft: null, buildingSizeSqft: 1500, yearBuilt: 1960, zoning: "RS-5",
      askingPrice: null, pricePerSqft: null, latitude: 26.01, longitude: -80.14,
    };
    await aplicarValores(prisma as never, parcela, v, "snap");
    expect(prisma.deal.update).toHaveBeenCalledWith({ where: { id: "d2" }, data: { lotSizeSqft: 2262, dataCompletenessScore: 100 } });
  });

  it("repetir no duplica: actualiza la tasacion, saltea la venta y no pisa un lote existente", async () => {
    const prisma = prismaFalso({ tasacion: { id: "t1" }, ventas: [{ id: "s1" }] });
    const r = await aplicarValores(prisma as never, { id: "d1", lotSizeSqft: 8000 }, v, "snap");
    expect(prisma.mdpaAssessment.create).not.toHaveBeenCalled();
    expect(prisma.mdpaAssessment.update.mock.calls[0][0].where).toEqual({ id: "t1" });
    expect(prisma.mdpaSale.create).not.toHaveBeenCalled();
    expect(prisma.deal.update).not.toHaveBeenCalled();
    expect(r).toEqual({ tasacion: "actualizada", ventasNuevas: 0, lote: false });
  });
});

describe("ventas de los condados (23-oct)", () => {
  it("Broward: solo SALE_VER Q, monto con signo y comas, fecha exacta", () => {
    expect(ventaBroward({ FOLIO_NUMBER: "494126380090", SALE_DATE: 1753747200000, SALE_AMOUNT: "$325,000", SALE_VER: "Q" })).toEqual({
      saleDate: new Date(1753747200000), salePrice: 325000, saleType: "BCPA Q",
    });
    expect(ventaBroward({ FOLIO_NUMBER: "1", SALE_DATE: 1753747200000, SALE_AMOUNT: "$100", SALE_VER: "U" })).toBeNull();
  });

  it("Palm Beach: solo QUAL_CODE Q (fuera QM de varias parcelas y D o U de transferencias)", () => {
    expect(ventaPalmBeach({ PARCEL_NUMBER: "5643", SALE_DATE: 980226000000, PRICE: "95000", QUAL_CODE: "Q" })).toEqual({
      saleDate: new Date(980226000000), salePrice: 95000, saleType: "PAPA Q",
    });
    for (const codigo of ["QM", "D", "DD", "U", null]) {
      expect(ventaPalmBeach({ PARCEL_NUMBER: "5643", SALE_DATE: 980226000000, PRICE: "95000", QUAL_CODE: codigo })).toBeNull();
    }
    expect(ventaPalmBeach({ PARCEL_NUMBER: "5643", SALE_DATE: null, PRICE: "95000", QUAL_CODE: "Q" })).toBeNull();
  });

  it("consulta por el campo de folio de cada condado y agrupa por folio", async () => {
    const buscar = jest.fn().mockResolvedValue([
      { attributes: { FOLIO_NUMBER: "A", SALE_DATE: 1, SALE_AMOUNT: "$500,000", SALE_VER: "Q" } },
      { attributes: { FOLIO_NUMBER: "A", SALE_DATE: 2, SALE_AMOUNT: "$600,000", SALE_VER: "Q" } },
    ]);
    const r = await consultarVentasDelCondado("broward-parcels", ["A"], buscar);
    expect(buscar.mock.calls[0][0]).toBe(VENTAS_DEL_CONDADO["broward-parcels"].url);
    expect(buscar.mock.calls[0][1]).toBe("FOLIO_NUMBER IN ('A')");
    expect(r.get("A")).toHaveLength(2);
    expect(Object.keys(VENTAS_DEL_CONDADO).sort()).toEqual(["broward-parcels", "palm-beach-parcels"]);
  });

  it("la misma venta del estado (mes) y del condado (dia) no se duplica", async () => {
    const prisma = prismaFalso({ ventas: [{ id: "s1" }] });
    const n = await guardarVentas(prisma as never, "d1", [{ saleDate: new Date(Date.UTC(2025, 6, 18)), salePrice: 455000, saleType: "BCPA Q" }], null);
    expect(n).toBe(0);
    expect(prisma.mdpaSale.findFirst.mock.calls[0][0].where).toEqual({
      dealId: "d1", salePrice: 455000, saleDate: { gte: new Date(Date.UTC(2025, 6, 1)), lt: new Date(Date.UTC(2025, 7, 1)) },
    });
  });
});

describe("consultaArcgis reintentos (25-oct)", () => {
  // Tipado explicito para que el mismo test corra contra la version sin el tercer parametro (prueba en rojo).
  const conEspera = consultaArcgis as (url: string, p: Record<string, string>, esperar: (ms: number) => Promise<void>) => Promise<unknown[]>;
  const original = global.fetch;
  afterEach(() => { global.fetch = original; });

  it("espera entre intentos pero no despues del ultimo, y lanza el ultimo error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("caida")) as never;
    const esperar = jest.fn().mockResolvedValue(undefined);
    await expect(conEspera("https://capa/0", { where: "1=1" }, esperar)).rejects.toThrow("caida");
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(esperar.mock.calls).toEqual([[2000], [4000]]);
  }, 20_000);

  it("un exito en el segundo intento no espera de mas", async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error("caida"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [{ attributes: { A: 1 } }] }) }) as never;
    const esperar = jest.fn().mockResolvedValue(undefined);
    expect(await conEspera("https://capa/0", { where: "1=1" }, esperar)).toHaveLength(1);
    expect(esperar.mock.calls).toEqual([[2000]]);
  }, 20_000);
});

describe("enriquecerConCatastro recalcula el score de los deals que recibieron lote (25-oct)", () => {
  function prismaEnriquecer() {
    return {
      deal: {
        findMany: jest.fn().mockResolvedValue([{ id: "d1", parcelId: "494126380040", lotSizeSqft: null }, { id: "d2", parcelId: "OTRO", lotSizeSqft: 5000 }]),
        update: jest.fn().mockResolvedValue({}),
      },
      mdpaDatasetSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: "snap" }), create: jest.fn() },
      mdpaAssessment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), update: jest.fn() },
      mdpaSale: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    };
  }
  const buscar = jest.fn().mockResolvedValue([FILA, { attributes: { ...FILA.attributes, PARCEL_ID: "OTRO" } }]);
  // Tipado explicito para que el mismo test corra contra la version sin la opcion recalcular (prueba en rojo).
  type Opciones = Parameters<typeof enriquecerConCatastro>[1];

  it("con aplicar: llama a recalcular solo con los deals a los que se les cargo el lote", async () => {
    const recalcular = jest.fn().mockResolvedValue(1);
    const prisma = prismaEnriquecer();
    await enriquecerConCatastro(prisma as never, { aplicar: true, fuentes: ["monroe-parcels"], buscar, recalcular } as Opciones);
    expect(recalcular).toHaveBeenCalledTimes(1);
    expect(recalcular.mock.calls[0][1]).toEqual(["d1"]);
  });

  it("si la corrida falla despues de cargar un lote, ese deal ya quedo recalculado (revision de Codex del PR 17)", async () => {
    const recalcular = jest.fn().mockResolvedValue(1);
    const prisma = prismaEnriquecer();
    prisma.deal.findMany.mockResolvedValue([{ id: "d1", parcelId: "494126380040", lotSizeSqft: null }, { id: "d2", parcelId: "OTRO", lotSizeSqft: null }]);
    prisma.mdpaAssessment.create.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("base caida"));
    await expect(enriquecerConCatastro(prisma as never, { aplicar: true, fuentes: ["monroe-parcels"], buscar, recalcular } as Opciones)).rejects.toThrow("base caida");
    expect(recalcular.mock.calls).toEqual([[prisma, ["d1"]]]);
  });

  it("en prueba (sin aplicar) no recalcula nada", async () => {
    const recalcular = jest.fn().mockResolvedValue(0);
    await enriquecerConCatastro(prismaEnriquecer() as never, { aplicar: false, fuentes: ["monroe-parcels"], buscar, recalcular } as Opciones);
    expect(recalcular).not.toHaveBeenCalled();
  });
});

describe("un lote que la capa no contesta se anota y la corrida sigue (4-nov)", () => {
  // El 1-nov (repaso mensual) y el 4-nov un 504 del catastro despues de los 3 intentos corto la corrida entera: el
  // 1-nov no se cargo nada en ningun condado. Tipado explicito para que corra contra la version sin `fallidos` (rojo).
  type Fallido = { url: string; folios: number; error: string };
  const consultarConFallidos = consultarCatastro as (
    c: number, f: string[], b: unknown, u?: string, fallidos?: Fallido[],
  ) => Promise<Map<string, unknown>>;
  const ventasConFallidos = consultarVentasDelCondado as (
    fuente: string, f: string[], b: unknown, fallidos?: Fallido[],
  ) => Promise<Map<string, unknown[]>>;
  const caido = () => Promise.reject(new Error("ArcGIS query failed 504"));
  type Opciones = Parameters<typeof enriquecerConCatastro>[1];

  it("catastro: el lote caido queda anotado y los otros lotes se cargan", async () => {
    const otro = { attributes: { ...FILA.attributes, PARCEL_ID: "OTRO" } };
    const buscar = jest.fn().mockResolvedValueOnce([FILA]).mockImplementationOnce(caido).mockResolvedValueOnce([otro]);
    const fallidos: Fallido[] = [];
    const r = await consultarConFallidos(16, Array.from({ length: 450 }, (_, i) => `F${i}`), buscar, "https://capa/0", fallidos);
    expect(buscar).toHaveBeenCalledTimes(3);
    expect([...r.keys()]).toEqual(["494126380040", "OTRO"]);
    expect(fallidos).toEqual([{ url: "https://capa/0", folios: 200, error: "ArcGIS query failed 504" }]);
  });

  it("sin lista de fallidos sigue lanzando, como antes", async () => {
    await expect(consultarCatastro(16, ["F1"], jest.fn().mockImplementation(caido))).rejects.toThrow("504");
  });

  it("ventas del condado: el lote caido queda anotado y el resto se agrupa", async () => {
    const venta = { attributes: { FOLIO_NUMBER: "B", SALE_DATE: 1, SALE_AMOUNT: "$500,000", SALE_VER: "Q" } };
    const buscar = jest.fn().mockImplementationOnce(caido).mockResolvedValueOnce([venta]);
    const fallidos: Fallido[] = [];
    const r = await ventasConFallidos("broward-parcels", Array.from({ length: 300 }, (_, i) => (i < 200 ? `A${i}` : "B")), buscar, fallidos);
    expect(r.get("B")).toHaveLength(1);
    expect(fallidos).toEqual([{ url: VENTAS_DEL_CONDADO["broward-parcels"].url, folios: 200, error: "ArcGIS query failed 504" }]);
  });

  it("enriquecer: el condado caido queda en su resumen y el siguiente condado se carga igual", async () => {
    const prisma = {
      deal: {
        findMany: jest.fn().mockResolvedValue([{ id: "d1", parcelId: "494126380040", lotSizeSqft: 5000 }, { id: "d2", parcelId: "OTRO", lotSizeSqft: 5000 }]),
        update: jest.fn().mockResolvedValue({}),
      },
      mdpaDatasetSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: "snap" }), create: jest.fn() },
      mdpaAssessment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), update: jest.fn() },
      mdpaSale: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    };
    const buscar = jest.fn().mockImplementation(async (_url: string, where: string) =>
      (where.startsWith("CO_NO=54") ? caido() : [FILA]));
    const log = jest.fn();
    const r = await enriquecerConCatastro(prisma as never, {
      aplicar: true, fuentes: ["monroe-parcels", "martin-parcels"], buscar, log, recalcular: jest.fn().mockResolvedValue(0),
    } as Opciones);
    expect(r.map((x) => [x.fuente, x.tasaciones, (x as { lotesFallidos?: number }).lotesFallidos, (x as { foliosSinConsultar?: number }).foliosSinConsultar]))
      .toEqual([["monroe-parcels", 0, 1, 2], ["martin-parcels", 1, 0, 0]]);
    expect(log.mock.calls.map((c) => c[0]).join("\n")).toMatch(/monroe-parcels: lote de 2 folios sin respuesta .*ArcGIS query failed 504/);
  });

  it("una falla de la base no se tapa: la corrida se corta como antes", async () => {
    const prisma = {
      deal: { findMany: jest.fn().mockResolvedValue([{ id: "d1", parcelId: "494126380040", lotSizeSqft: 5000 }]), update: jest.fn() },
      mdpaDatasetSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: "snap" }), create: jest.fn() },
      mdpaAssessment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockRejectedValue(new Error("base caida")), update: jest.fn() },
      mdpaSale: { findFirst: jest.fn(), create: jest.fn() },
    };
    await expect(enriquecerConCatastro(prisma as never, {
      aplicar: true, fuentes: ["martin-parcels"], buscar: jest.fn().mockResolvedValue([FILA]),
    } as Opciones)).rejects.toThrow("base caida");
  });
});
