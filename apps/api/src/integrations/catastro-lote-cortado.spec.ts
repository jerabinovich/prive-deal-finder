import { LoteCortado, consultaArcgis, consultarCatastro, consultarVentasDelCondado } from "./catastro-valores";

/**
 * LOTE CORTADO POR EL TOPE DE FILAS DE LA CAPA (25-oct-2026, cowork-pendientes-5oct, hallazgo 1 de la revision del
 * PR 13). Una capa de ArcGIS devuelve a lo sumo maxRecordCount filas (BCPA_SALES: 1.000) y avisa con
 * exceededTransferLimit. Antes se tomaba lo que vino como si fuera todo: ventas perdidas sin aviso. Medido el
 * 25-oct sobre los 4.597 folios de Broward en lotes de 200: el lote mas grande trae 45 filas, asi que hoy no pasa.
 */
const foliosDe = (where: string) => (where.match(/'([^']*)'/g) ?? []).map((s) => s.slice(1, -1));
const original = global.fetch;

afterEach(() => {
  global.fetch = original;
});

describe("lote cortado por el tope de filas de la capa", () => {
  it("consultaArcgis rechaza una respuesta cortada, sin reintentar", async () => {
    const fetchFalso = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ features: [{ attributes: {} }], exceededTransferLimit: true }),
    });
    global.fetch = fetchFalso as never;
    await expect(consultaArcgis("https://capa.invalid/37", { where: "1=1" })).rejects.toBeInstanceOf(LoteCortado);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("una respuesta completa sigue igual", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ attributes: { A: 1 } }] }) }) as never;
    await expect(consultaArcgis("https://capa.invalid/0", { where: "1=1" })).resolves.toEqual([{ attributes: { A: 1 } }]);
  });

  it("ventas del condado: el lote cortado se parte hasta que entra y no se pierde ninguna venta", async () => {
    const folios = ["F1", "F2", "F3", "F4", "F5"];
    const buscar = jest.fn(async (_url: string, where: string) => {
      const lista = foliosDe(where);
      if (lista.length > 2) throw new LoteCortado("https://capa.invalid/37");
      return lista.flatMap((f) => [
        { attributes: { FOLIO_NUMBER: f, SALE_DATE: 1, SALE_AMOUNT: "100000", SALE_VER: "Q" } },
        { attributes: { FOLIO_NUMBER: f, SALE_DATE: 2, SALE_AMOUNT: "200000", SALE_VER: "Q" } },
      ]);
    });
    const r = await consultarVentasDelCondado("broward-parcels", folios, buscar);
    expect([...r.keys()].sort()).toEqual(folios);
    for (const f of folios) expect(r.get(f)).toHaveLength(2);
  });

  it("catastro estatal: el lote cortado se parte igual", async () => {
    const buscar = jest.fn(async (_url: string, where: string) => {
      const lista = foliosDe(where);
      if (lista.length > 1) throw new LoteCortado("https://capa.invalid/0");
      return lista.map((f) => ({ attributes: { CO_NO: 16, PARCEL_ID: f, ASMNT_YR: 2026, JV: 1000 } }));
    });
    const r = await consultarCatastro(16, ["P1", "P2", "P3"], buscar);
    expect([...r.keys()].sort()).toEqual(["P1", "P2", "P3"]);
  });

  it("si un solo folio no entra, falla con el error: nunca devuelve algo cortado", async () => {
    const buscar = jest.fn(async () => {
      throw new LoteCortado("https://capa.invalid/37");
    });
    await expect(consultarVentasDelCondado("broward-parcels", ["F1", "F2"], buscar)).rejects.toBeInstanceOf(LoteCortado);
  });

  it("otros errores no se parten: siguen como antes", async () => {
    const buscar = jest.fn(async () => {
      throw new Error("ArcGIS 500");
    });
    await expect(consultarVentasDelCondado("broward-parcels", ["F1", "F2"], buscar)).rejects.toThrow("ArcGIS 500");
    expect(buscar).toHaveBeenCalledTimes(1);
  });
});
