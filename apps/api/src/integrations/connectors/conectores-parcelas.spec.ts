import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchArcgisPagina } from "../arcgis-pagina";
import { normalizarRegistrosBroward } from "../broward-parcelas";
import { claveConsulta, whereMiamiDade } from "../parcelas-corredores";
import { BrowardParcelsConnector } from "./broward-parcels.connector";
import { CAPA_MIAMI_DADE, MiamiDadeParcelsConnector, capaMiamiDade } from "./miami-dade-parcels.connector";

jest.mock("../arcgis-pagina", () => ({ fetchArcgisPagina: jest.fn() }));
jest.mock("../broward-parcelas", () => ({ normalizarRegistrosBroward: jest.fn(async (_u: string, r: unknown[]) => r) }));
const pagina = fetchArcgisPagina as jest.MockedFunction<typeof fetchArcgisPagina>;
void normalizarRegistrosBroward;

const ENV = { ...process.env };
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "bb-"));
  writeFileSync(join(dir, "buybox.json"), JSON.stringify({ corredores_tier1: { Brickell: { zips: ["33131"] }, "Las Olas": { zips: ["33301"] } } }));
  process.env.BUYBOX_JSON = join(dir, "buybox.json");
  process.env.PARCELAS_POR_CORRIDA = "3";
  process.env.BROWARD_PARCELS_URL = "https://bcpa/MapServer/36";
  process.env.MIAMI_DADE_PARCELS_URL = "https://portal/api/download/v1/items/abc/geojson";
  pagina.mockReset();
});
afterAll(() => {
  process.env = ENV;
});

const f = (n: number) => Array.from({ length: n }, (_, i) => ({ attributes: { FOLIO: String(i) } }));

describe("conectores de parcelas por corredores", () => {
  it("Miami-Dade: un enlace de descarga no es una capa; se usa MD_Emaps/72", () => {
    expect(capaMiamiDade()).toBe(CAPA_MIAMI_DADE);
    expect(capaMiamiDade("https://x/arcgis/rest/services/P/FeatureServer/0/")).toBe("https://x/arcgis/rest/services/P/FeatureServer/0");
  });

  it("Miami-Dade: sigue donde quedo y devuelve el cursor siguiente", async () => {
    pagina.mockResolvedValueOnce(f(3));
    const c = new MiamiDadeParcelsConnector();
    const primera = await c.sync({ cursor: null });
    expect(pagina.mock.calls[0][0]).toBe(CAPA_MIAMI_DADE);
    expect(pagina.mock.calls[0][2]).toMatchObject({ offset: 0, cantidad: 3, orden: "FOLIO" });
    expect(primera.cursor).toMatchObject({ offset: 3, vueltas: 0 });
    pagina.mockResolvedValueOnce(f(1));
    const segunda = await c.sync({ cursor: primera.cursor });
    expect(pagina.mock.calls[1][2]).toMatchObject({ offset: 3 });
    expect(segunda.cursor).toMatchObject({ offset: 0, vueltas: 1 });
    expect(segunda.records).toHaveLength(1);
  });

  it("Miami-Dade: si el recorrido termino justo en el borde, vuelve al principio en la misma corrida", async () => {
    const clave = claveConsulta(CAPA_MIAMI_DADE, whereMiamiDade(["33131", "33301"]));
    pagina.mockResolvedValueOnce([]).mockResolvedValueOnce(f(3));
    const r = await new MiamiDadeParcelsConnector().sync({ cursor: { clave, offset: 9, vueltas: 0 } });
    expect(pagina.mock.calls.map((c) => c[2].offset)).toEqual([9, 0]);
    expect(r.records).toHaveLength(3);
    expect(r.cursor).toMatchObject({ offset: 3, vueltas: 1 });
  });

  it("Broward: pagina por FOLIO_NUMBER sin geometria y normaliza", async () => {
    pagina.mockResolvedValueOnce(f(2));
    const r = await new BrowardParcelsConnector().sync({ cursor: null });
    expect(pagina.mock.calls[0][0]).toBe("https://bcpa/MapServer/36");
    expect(pagina.mock.calls[0][1]).toContain("SITUS_ZIP_CODE LIKE '33301%'");
    expect(pagina.mock.calls[0][2]).toMatchObject({ offset: 0, cantidad: 3, orden: "FOLIO_NUMBER", geometria: false });
    expect(r.records).toHaveLength(2);
    expect(r.cursor).toMatchObject({ offset: 0, vueltas: 1 });
  });

  it("el estado de la integracion no mueve el recorrido: una sola parcela, sin cursor", async () => {
    pagina.mockResolvedValue(f(1));
    expect((await new BrowardParcelsConnector().getHealthStatus()).status).toBe("OK");
    expect((await new MiamiDadeParcelsConnector().getHealthStatus()).status).toBe("OK");
    expect(pagina.mock.calls.every((c) => c[2].cantidad === 1 && c[2].offset === 0)).toBe(true);
  });

  it("sin buybox.json legible, el sync falla con el motivo", async () => {
    process.env.BUYBOX_JSON = "/no/existe/buybox.json";
    const r = await new MiamiDadeParcelsConnector().sync({ cursor: null });
    expect(r.status).toBe("ERROR");
    expect(r.message).toMatch(/no corridors/);
    expect(pagina).not.toHaveBeenCalled();
  });
});
