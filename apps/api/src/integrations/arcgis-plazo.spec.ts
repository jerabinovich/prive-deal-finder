import { fetchArcgisPagina } from "./arcgis-pagina";
import { fetchArcgisWhere } from "./connectors/arcgis";

// 25-oct-2026: una respuesta que nunca llega no puede colgar el sync (el 23-oct una consulta sin tope colgo una corrida
// 30 minutos). El fetch falso no responde nunca y solo corta si el pedido trae una senal de corte.
function fetchQueNoResponde() {
  return jest.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((_ok, falla) => {
    init?.signal?.addEventListener("abort", () => falla(init.signal?.reason ?? new Error("abort")));
  }));
}

// Tipado explicito para que el mismo test corra contra la version sin el parametro de plazo (prueba en rojo).
const pagina = fetchArcgisPagina as (u: string, w: string, o: { offset: number; cantidad: number; orden: string; plazoMs?: number }) => Promise<unknown[]>;
const donde = fetchArcgisWhere as (u: string, w: string, l?: number, o?: string, plazoMs?: number) => Promise<unknown[]>;

describe("plazo de los clientes ArcGIS del sync (25-oct)", () => {
  const original = global.fetch;
  afterEach(() => { global.fetch = original; });

  it("fetchArcgisPagina corta con un error claro si la capa no responde", async () => {
    global.fetch = fetchQueNoResponde() as never;
    await expect(pagina("https://capa/0", "1=1", { offset: 0, cantidad: 1, orden: "OBJECTID", plazoMs: 50 })).rejects.toThrow(/sin respuesta/);
  }, 3000);

  it("fetchArcgisWhere corta con un error claro si la capa no responde", async () => {
    global.fetch = fetchQueNoResponde() as never;
    await expect(donde("https://capa/0", "1=1", 1, undefined, 50)).rejects.toThrow(/sin respuesta/);
  }, 3000);

  it("si los encabezados llegan pero el cuerpo no, tambien corta con el mensaje claro (revision del PR 18)", async () => {
    global.fetch = jest.fn(async (_u: string, init?: { signal?: AbortSignal }) => ({
      ok: true,
      json: () => new Promise((_ok, falla) => {
        init?.signal?.addEventListener("abort", () => falla(init.signal?.reason ?? new Error("abort")));
      }),
    })) as never;
    await expect(pagina("https://capa/0", "1=1", { offset: 0, cantidad: 1, orden: "OBJECTID", plazoMs: 50 })).rejects.toThrow(/sin respuesta/);
    await expect(donde("https://capa/0", "1=1", 1, undefined, 50)).rejects.toThrow(/sin respuesta/);
  }, 3000);

  it("el plazo por defecto es exactamente 120 s", async () => {
    const espia = jest.spyOn(AbortSignal, "timeout");
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })) as never;
    await pagina("https://capa/0", "1=1", { offset: 0, cantidad: 1, orden: "OBJECTID" });
    await donde("https://capa/0", "1=1");
    expect(espia.mock.calls).toEqual([[120_000], [120_000]]);
    espia.mockRestore();
  });

  it("por defecto el plazo es 120 s (la corrida mas larga medida en 14 dias fue de 82 s en total)", async () => {
    const vistos: Array<AbortSignal | undefined> = [];
    global.fetch = jest.fn(async (_u: string, init?: { signal?: AbortSignal }) => {
      vistos.push(init?.signal);
      return { ok: true, json: async () => ({ features: [] }) };
    }) as never;
    await pagina("https://capa/0", "1=1", { offset: 0, cantidad: 1, orden: "OBJECTID" });
    await donde("https://capa/0", "1=1");
    expect(vistos).toHaveLength(2);
    for (const s of vistos) expect(s).toBeInstanceOf(AbortSignal);
  });
});
