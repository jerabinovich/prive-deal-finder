import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchArcgisPagina } from "../arcgis-pagina";
import { CONDADOS_ESTATALES } from "../parcelas-estatales";
import { CatastroEstatalParcelsConnector } from "./parcelas-estatales.connector";

jest.mock("../arcgis-pagina", () => ({ fetchArcgisPagina: jest.fn() }));
const pagina = fetchArcgisPagina as jest.MockedFunction<typeof fetchArcgisPagina>;

const ENV = { ...process.env };
const original = global.fetch;
const MONROE = CONDADOS_ESTATALES.find((c) => c.source === "monroe-parcels")!;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "bb-estatal-c-"));
  writeFileSync(
    join(dir, "buybox.json"),
    JSON.stringify({ corredores_tier1: { "Key West (Old Town)": { zips: ["33040"], municipios: ["Key West"] } } }),
  );
  process.env.BUYBOX_JSON = join(dir, "buybox.json");
  process.env.PARCELAS_POR_CORRIDA = "2";
  pagina.mockReset();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ features: [{ attributes: { lo: 100, hi: 2099, n: 1500 } }] }),
  }) as unknown as typeof fetch;
});
afterAll(() => {
  process.env = ENV;
  global.fetch = original;
});

const kw = (oid: number, ciudad = "KEY WEST") => ({
  attributes: { OBJECTID: oid, CO_NO: 54, PARCEL_ID: `00${oid}`, DOR_UC: "039", PHY_ADDR1: `${oid} DUVAL St`, PHY_CITY: ciudad, PHY_ZIPCD: 33040 },
  geometry: { x: -81.8, y: 24.55 },
});

describe("conector de parcelas por el catastro estatal", () => {
  it("una fuente por condado, sin variables de entorno", () => {
    const fuentes = CONDADOS_ESTATALES.map((c) => new CatastroEstatalParcelsConnector(c));
    expect(fuentes.map((f) => f.source)).toEqual(["martin-parcels", "monroe-parcels"]);
    expect(fuentes.every((f) => f.requiredEnv.length === 0)).toBe(true);
  });

  it("devuelve la pagina del corredor con el mensaje y las metricas que mira el aviso por fuente", async () => {
    pagina.mockResolvedValueOnce([kw(101), kw(102, "STOCK ISLAND"), kw(103), kw(104)]);
    const r = await new CatastroEstatalParcelsConnector(MONROE).sync({ cursor: null });
    expect(r.status).toBe("OK");
    expect(r.message).toBe("Monroe parcels: corridor page of 2 (read 3) from 100");
    expect(r.records).toHaveLength(2);
    expect(r.cursor).toMatchObject({ offset: 104, vueltas: 0 });
    expect(r.metrics).toMatchObject({ modo: "corredores", condado: 54, offset: 100, pedidos: 2, leidos: 3, fueraDelCorredor: 1, vuelta: 0 });
  });

  it("si la capa falla, la corrida termina en ERROR con el motivo", async () => {
    pagina.mockRejectedValue(new Error("ArcGIS query failed 504"));
    const r = await new CatastroEstatalParcelsConnector(MONROE).sync({ cursor: null });
    expect(r.status).toBe("ERROR");
    expect(r.message).toContain("Monroe parcels fetch failed");
  }, 15000);

  it("el estado de salud mira solo el rango del condado", async () => {
    const h = await new CatastroEstatalParcelsConnector(MONROE).getHealthStatus();
    expect(h).toEqual({ status: "OK", message: "Monroe parcels reachable (1500 parcels)" });
    expect(pagina).not.toHaveBeenCalled();
  });
});
