import { consultarCapa, fetchArcgisPagina, LoteCortado as LoteDelCliente } from "./arcgis-pagina";
import { consultaArcgis, LoteCortado } from "./catastro-valores";
import { fetchArcgisWhere } from "./connectors/arcgis";

// CLIENTE ARCGIS UNICO (25-oct-2026, cowork-1025-cierres). Los tres clientes pasan por consultarCapa: mismo pedido de
// siempre por fuera (GET con la misma URL, POST con el mismo cuerpo), y los arreglos valen para los tres.
describe("cliente ArcGIS unico (25-oct)", () => {
  const original = global.fetch;
  afterEach(() => { global.fetch = original; });
  const responde = (cuerpo: unknown) => jest.fn(async () => ({ ok: true, json: async () => cuerpo })) as never;

  it("los conectores piden por GET con la misma URL que antes, en el mismo orden", async () => {
    const f = responde({ features: [{ a: 1 }] });
    global.fetch = f;
    expect(await fetchArcgisWhere("https://capa/0/", "FOLIO = '12 3'", 5, "FOLIO_NUMBER")).toHaveLength(1);
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(
      "https://capa/0/query?where=" + encodeURIComponent("FOLIO = '12 3'") +
      "&outFields=*&f=json&returnGeometry=true&outSR=4326&resultRecordCount=5&orderByFields=FOLIO_NUMBER",
    );
    expect(init.method).toBeUndefined();
  });

  it("el sync pide por POST con el mismo cuerpo que antes", async () => {
    const f = responde({ features: [] });
    global.fetch = f;
    await fetchArcgisPagina("https://capa/0", "1=1", { offset: 0, cantidad: 10, orden: "OBJECTID" });
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe("https://capa/0/query");
    expect(init.body).toBe("where=1%3D1&outFields=*&f=json&orderByFields=OBJECTID&resultOffset=0&resultRecordCount=10&returnGeometry=true&outSR=4326");
  });

  it("un error de la capa sin mensaje ya no pasa por una capa vacia en los conectores", async () => {
    global.fetch = responde({ error: { code: 400 } });
    await expect(fetchArcgisWhere("https://capa/0", "1=1")).rejects.toThrow("ArcGIS query error: sin detalle");
  });

  it("el catastro corta con el mismo mensaje claro que el sync cuando la capa no responde", async () => {
    const espia = jest.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("t", "TimeoutError")));
    global.fetch = jest.fn((_u: string, init?: { signal?: AbortSignal }) => Promise.reject(init?.signal?.reason)) as never;
    const esperar = jest.fn().mockResolvedValue(undefined);
    await expect(consultaArcgis("https://capa/37", { where: "1=1" }, esperar)).rejects.toThrow(/sin respuesta en 60 s/);
    expect(esperar.mock.calls).toEqual([[2000], [4000]]);
    espia.mockRestore();
  });

  it("el tope de filas solo corta donde se pide: el catastro falla, el sync toma la pagina", async () => {
    global.fetch = responde({ features: [{ a: 1 }], exceededTransferLimit: true });
    await expect(consultaArcgis("https://capa/37", { where: "1=1" })).rejects.toBeInstanceOf(LoteCortado);
    expect(await fetchArcgisPagina("https://capa/0", "1=1", { offset: 0, cantidad: 1, orden: "OBJECTID" })).toHaveLength(1);
    expect(LoteCortado).toBe(LoteDelCliente);
  });

  it("consultarCapa reintenta solo si se le pide", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("caida")) as never;
    await expect(consultarCapa("https://capa/0", { where: "1=1" })).rejects.toThrow("caida");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
