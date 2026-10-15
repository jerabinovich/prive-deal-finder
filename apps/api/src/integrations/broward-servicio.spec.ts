import { fetchArcgisPagina } from "./arcgis-pagina";
import { olvidarServicioBroward, partesDeCapa, servicioMasNuevo, urlTablaBroward } from "./broward-servicio";

jest.mock("./arcgis-pagina", () => ({ fetchArcgisPagina: jest.fn(async () => [{ attributes: { FOLIO_NUMBER: "1" } }]) }));
const pagina = fetchArcgisPagina as jest.MockedFunction<typeof fetchArcgisPagina>;

const DIR = "https://gisweb-adapters.bcpa.net/arcgis/rest/services";
const JAN26 = `${DIR}/BCPA_EXTERNAL_JAN26/MapServer/36`;

function respuestas(mapa: Record<string, unknown>) {
  const llamadas: string[] = [];
  (global as any).fetch = jest.fn(async (url: string) => {
    llamadas.push(url);
    if (!(url in mapa)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => mapa[url] };
  });
  return llamadas;
}

const ORIGINAL = global.fetch;
beforeEach(() => {
  olvidarServicioBroward();
  pagina.mockClear();
});
afterAll(() => {
  (global as any).fetch = ORIGINAL;
});

describe("Broward: el servicio del rol vigente", () => {
  it("elige el BCPA_EXTERNAL mas nuevo por ano y mes; ignora los internos y los de prueba", () => {
    expect(servicioMasNuevo(["BCPA_EXTERNAL_JAN25", "BCPA_EXTERNAL_JAN26", "BCPA_INTERNAL_AUG26", "BCPA_INTERNAL_MAR26_TEST4"])).toBe("BCPA_EXTERNAL_JAN26");
    expect(servicioMasNuevo(["BCPA_EXTERNAL_DEC26", "BCPA_EXTERNAL_JAN27", "BCPA_EXTERNAL_JUL26"])).toBe("BCPA_EXTERNAL_JAN27");
    expect(servicioMasNuevo(["STREETS_MAR20"])).toBeNull();
  });

  it("parte la URL de la capa", () => {
    expect(partesDeCapa(JAN26)).toEqual({ directorio: DIR, servicio: "BCPA_EXTERNAL_JAN26", capa: 36 });
    expect(partesDeCapa("https://bcpa/MapServer/36")).toBeNull();
  });

  it("si la configurada es la mas nueva, queda; y la respuesta se guarda", async () => {
    const llamadas = respuestas({ [`${DIR}?f=json`]: { services: [{ name: "BCPA_EXTERNAL_JAN25" }, { name: "BCPA_EXTERNAL_JAN26" }] } });
    expect(await urlTablaBroward(JAN26)).toBe(JAN26);
    expect(await urlTablaBroward(JAN26)).toBe(JAN26);
    expect(llamadas).toHaveLength(1);
  });

  it("cuando sale un rol nuevo, usa la tabla del mismo nombre aunque cambie el numero, probada con una consulta", async () => {
    respuestas({
      [`${DIR}?f=json`]: { services: [{ name: "BCPA_EXTERNAL_JAN26" }, { name: "BCPA_EXTERNAL_JAN27" }] },
      [`${JAN26}?f=json`]: { name: "SQLGIS02.dbo.BCPA_INFO", type: "Table" },
      [`${DIR}/BCPA_EXTERNAL_JAN27/MapServer?f=json`]: {
        layers: [{ id: 16, name: "Parcels" }],
        tables: [{ id: 37, name: "SQLGIS03.dbo.BCPA_INFO" }, { id: 38, name: "SQLGIS03.dbo.OTRA" }],
      },
    });
    expect(await urlTablaBroward(JAN26)).toBe(`${DIR}/BCPA_EXTERNAL_JAN27/MapServer/37`);
    expect(pagina.mock.calls[0][0]).toBe(`${DIR}/BCPA_EXTERNAL_JAN27/MapServer/37`);
  });

  it("si el rol nuevo no tiene la tabla, o algo no responde, queda la configurada", async () => {
    respuestas({
      [`${DIR}?f=json`]: { services: [{ name: "BCPA_EXTERNAL_JAN27" }] },
      [`${JAN26}?f=json`]: { name: "SQLGIS02.dbo.BCPA_INFO" },
      [`${DIR}/BCPA_EXTERNAL_JAN27/MapServer?f=json`]: { layers: [{ id: 16, name: "Parcels" }], tables: [] },
    });
    expect(await urlTablaBroward(JAN26)).toBe(JAN26);
    olvidarServicioBroward();
    respuestas({});
    expect(await urlTablaBroward(JAN26)).toBe(JAN26);
  });

  it("si la consulta de prueba falla, queda la configurada", async () => {
    respuestas({
      [`${DIR}?f=json`]: { services: [{ name: "BCPA_EXTERNAL_JAN27" }] },
      [`${JAN26}?f=json`]: { name: "BCPA_INFO" },
      [`${DIR}/BCPA_EXTERNAL_JAN27/MapServer?f=json`]: { tables: [{ id: 37, name: "BCPA_INFO" }] },
    });
    pagina.mockRejectedValueOnce(new Error("ArcGIS query failed 500"));
    expect(await urlTablaBroward(JAN26)).toBe(JAN26);
  });

  it("una URL que no es de un BCPA_EXTERNAL se usa tal cual, sin salir a la red", async () => {
    const llamadas = respuestas({});
    expect(await urlTablaBroward("https://bcpa/MapServer/36")).toBe("https://bcpa/MapServer/36");
    expect(await urlTablaBroward("")).toBeUndefined();
    expect(llamadas).toHaveLength(0);
  });
});
