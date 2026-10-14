import {
  capaPoligonosBroward,
  centroDePoligonos,
  folioMaestroCondominio,
  normalizarRegistrosBroward,
  ubicacionesBroward,
} from "./broward-parcelas";
import { fetchArcgisWhere } from "./connectors/arcgis";

jest.mock("./connectors/arcgis", () => ({ fetchArcgisWhere: jest.fn() }));
const arcgis = fetchArcgisWhere as jest.MockedFunction<typeof fetchArcgisWhere>;

const cuadrado = (x: number, y: number) => ({ rings: [[[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2]]] });
const poligono = (folio: string, x: number, y: number) => ({ attributes: { FOLIO: folio }, geometry: cuadrado(x, y) });

function servicioConCapas(capas: Array<{ id: number; name: string }>) {
  return jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ layers: capas }) } as Response);
}

afterEach(() => {
  jest.restoreAllMocks();
  arcgis.mockReset();
});

describe("folioMaestroCondominio", () => {
  it("la unidad de condominio va al folio del edificio; un folio comun o maestro no", () => {
    expect(folioMaestroCondominio("494111BA0640")).toBe("494111BA0000");
    expect(folioMaestroCondominio("494227000171")).toBeNull();
    expect(folioMaestroCondominio("494111BA0000")).toBeNull();
  });
});

describe("centroDePoligonos", () => {
  it("promedia los vertices de todos los edificios del complejo", () => {
    expect(centroDePoligonos([cuadrado(0, 0), cuadrado(10, 0)])).toEqual({ x: 6, y: 1 });
    expect(centroDePoligonos([])).toBeNull();
  });
});

describe("capaPoligonosBroward", () => {
  it("encuentra la capa Parcels del mismo servicio", async () => {
    servicioConCapas([{ id: 3, name: "City Limits" }, { id: 16, name: "Parcels" }]);
    await expect(capaPoligonosBroward("https://s/A/MapServer/36")).resolves.toBe("https://s/A/MapServer/16");
  });

  it("sin capa Parcels, null", async () => {
    servicioConCapas([{ id: 3, name: "City Limits" }]);
    await expect(capaPoligonosBroward("https://s/B/MapServer/36")).resolves.toBeNull();
  });
});

describe("ubicacionesBroward", () => {
  it("poligono propio, o el del edificio para una unidad; lo que no aparece queda sin ubicacion", async () => {
    servicioConCapas([{ id: 16, name: "Parcels" }]);
    arcgis
      .mockResolvedValueOnce([poligono("494227000171", 0, 0)])
      .mockResolvedValueOnce([poligono("494111BA0000", 10, 10)]);
    const r = await ubicacionesBroward("https://s/C/MapServer/36", ["494227000171", "494111BA0640", "999999999999"]);
    expect(r.get("494227000171")).toEqual({ x: 1, y: 1, fuente: "PARCELA" });
    expect(r.get("494111BA0640")).toEqual({ x: 11, y: 11, fuente: "CONDOMINIO" });
    expect(r.has("999999999999")).toBe(false);
    expect(arcgis).toHaveBeenNthCalledWith(1, "https://s/C/MapServer/16", expect.stringContaining("'494227000171'"), 500);
    expect(arcgis).toHaveBeenNthCalledWith(2, "https://s/C/MapServer/16", "FOLIO IN ('494111BA0000')", 500);
  });
});

describe("normalizarRegistrosBroward", () => {
  it("ciudad con nombre, codigo guardado y punto donde hay poligono", async () => {
    servicioConCapas([{ id: 16, name: "Parcels" }]);
    arcgis.mockResolvedValueOnce([poligono("494227000171", 0, 0)]).mockResolvedValueOnce([]);
    const [a, b, c] = (await normalizarRegistrosBroward("https://s/D/MapServer/36", [
      { attributes: { FOLIO_NUMBER: "494227000171", SITUS_CITY: "WM" } },
      { attributes: { FOLIO_NUMBER: "1", SITUS_CITY: "FL" }, geometry: { x: 5, y: 6 } },
      { attributes: { FOLIO_NUMBER: "2", SITUS_CITY: "ZZ" } },
    ])) as Array<{ attributes: Record<string, unknown>; geometry?: Record<string, unknown> }>;
    expect(a.attributes).toMatchObject({ SITUS_CITY: "Wilton Manors", SITUS_CITY_CODIGO: "WM" });
    expect(a.geometry).toEqual({ x: 1, y: 1 });
    expect(b.attributes.SITUS_CITY).toBe("Fort Lauderdale");
    expect(b.geometry).toEqual({ x: 5, y: 6 });
    expect(c.attributes.SITUS_CITY).toBe("ZZ");
    expect(c.geometry).toBeUndefined();
  });
});
