import { fetchArcgisPagina } from "./arcgis-pagina";

afterEach(() => jest.restoreAllMocks());

describe("fetchArcgisPagina", () => {
  it("pide por POST la pagina con orden, desde y cantidad", async () => {
    const espia = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ attributes: { FOLIO: "1" } }] }),
    } as Response);
    const r = await fetchArcgisPagina("https://s/MapServer/72/", "A = 1", { offset: 400, cantidad: 200, orden: "FOLIO" });
    expect(r).toHaveLength(1);
    const [url, init] = espia.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://s/MapServer/72/query");
    expect(init.method).toBe("POST");
    const p = new URLSearchParams(String(init.body));
    expect(p.get("where")).toBe("A = 1");
    expect(p.get("orderByFields")).toBe("FOLIO");
    expect(p.get("resultOffset")).toBe("400");
    expect(p.get("resultRecordCount")).toBe("200");
    expect(p.get("outSR")).toBe("4326");
  });

  it("una tabla va sin geometria, y un error de la capa se propaga", async () => {
    const espia = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: "Invalid query" } }),
    } as Response);
    await expect(fetchArcgisPagina("https://s/36", "x", { offset: 0, cantidad: 1, orden: "FOLIO_NUMBER", geometria: false })).rejects.toThrow(
      "ArcGIS query error: Invalid query",
    );
    const p = new URLSearchParams(String((espia.mock.calls[0] as [string, RequestInit])[1].body));
    expect(p.get("returnGeometry")).toBe("false");
    expect(p.has("outSR")).toBe(false);
  });
});
