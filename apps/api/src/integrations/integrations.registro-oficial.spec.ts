import { IntegrationsService } from "./integrations.service";
import { IntegrationStatus } from "./connectors/types";
import { fetchArcgisWhere } from "./connectors/arcgis";
import { CLAVE_SIN_FOLIO, MARCA_REINTENTO } from "./expedientes-sin-folio";
import type { OrigenRegistro } from "./registro-oficial-broward";

jest.mock("./connectors/arcgis", () => ({ ...jest.requireActual("./connectors/arcgis"), fetchArcgisWhere: jest.fn() }));
const arcgis = fetchArcgisWhere as jest.MockedFunction<typeof fetchArcgisWhere>;

// 31-oct-2026: el registro oficial de Broward dentro del servicio: la cadena para los que el nombre no resolvio, y la
// lista de expedientes sin folio que se reintenta en las corridas siguientes.
const doc = (inst: string, tipo: string, fecha: string, hora: string, folio = "", caso = "") =>
  `${inst}|${fecha}|x|${hora}|${tipo}|0.00|||O||${folio}|||2|0|V||E|${caso}|`;
const ARCHIVOS: Record<string, string> = {
  "Official_Records_Download/10-29-2026doc-ver.txt": [
    doc("121179930", "LP", "20261029", "032006", "", "CACE-26-099001"),
    doc("121179931", "D", "20261029", "032100", "504206200430"),
    doc("121179932", "M", "20261029", "032101"),
  ].join("\n"),
  "Official_Records_Download/10-29-2026nme-ver.txt": ["121179930|PEREZ,JUAN|R|1|", "121179932|PEREZ,JUAN|D|1|"].join("\n"),
  "Official_Records_Download/10-29-2026lnk-ver.txt": "121179930|||O|LP|121179932|||O|M||",
};
function origenFalso(): OrigenRegistro {
  return {
    listar: async (dir) => Object.keys(ARCHIVOS).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
    leer: async (ruta) => ARCHIVOS[ruta] ?? "",
    leerInicio: async () => "",
    recorrer: async () => undefined,
    cerrar: jest.fn(async () => undefined),
  };
}

function armarServicio() {
  const metas: Record<string, string> = {};
  const mock: any = {
    integrationRun: { create: jest.fn(async () => ({ id: "run-1" })), update: jest.fn(async () => ({ startedAt: new Date() })) },
    integration: {
      findUnique: jest.fn(async ({ where }: any) => (where.source in metas ? { meta: metas[where.source] } : null)),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        // Integration se actualiza tambien sin meta (estado de la fuente): solo cuenta la que trae meta.
        const meta = update?.meta ?? create?.meta;
        if (typeof meta === "string") metas[where.source] = meta;
        return {};
      }),
    },
    alertEvent: { upsert: jest.fn(async () => ({ id: "alert-1" })) },
    alertRule: { findMany: jest.fn(async () => []) },
    alertInboxItem: { createMany: jest.fn(async () => ({})) },
    stagingRecord: { createMany: jest.fn() },
  };
  const service = new IntegrationsService(mock, {} as any);
  return { service, s: service as any, metas, mock };
}

describe("IntegrationsService: folio por el registro oficial de Broward", () => {
  const anterior = process.env.BROWARD_REGISTRO_OFICIAL;
  afterEach(() => {
    if (anterior === undefined) delete process.env.BROWARD_REGISTRO_OFICIAL;
    else process.env.BROWARD_REGISTRO_OFICIAL = anterior;
    arcgis.mockReset();
  });

  it("resuelve por la cadena, deja la resolucion por nombre al lado y devuelve la parcela del catastro", async () => {
    const { s } = armarServicio();
    const origen = origenFalso();
    s.abrirRegistroOficial = jest.fn(async () => origen);
    arcgis.mockResolvedValue([{ attributes: { FOLIO_NUMBER: "504206200430" } }] as any);
    const registros: Array<Record<string, unknown>> = [
      { caseNumber: "CACE26099001", defendantName: "Juan Perez", resolucionFolio: { estado: "SIN_COINCIDENCIA", folios: [] } },
      { caseNumber: "CACE26000009", defendantName: "Ana Gomez" },
      { caseNumber: "CACE26000010", parcelIds: ["494205DJ0420"] },
    ];
    const features = await s.foliosPorRegistroOficial("url-bcpa", registros);
    expect(features).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      parcelId: "504206200430",
      parcelIds: ["504206200430"],
      resolucionFolio: { estado: "REGISTRO_OFICIAL", folios: ["504206200430"] },
      resolucionFolioPorNombre: { estado: "SIN_COINCIDENCIA" },
      registroOficial: { estado: "CADENA" },
    });
    expect(registros[1]).toMatchObject({ registroOficial: { estado: "SIN_LIS_PENDENS" } });
    expect(registros[1].parcelIds).toBeUndefined();
    expect(registros[2].registroOficial).toBeUndefined();
    expect(arcgis.mock.calls[0][1]).toBe("FOLIO_NUMBER IN ('504206200430')");
    expect(origen.cerrar).toHaveBeenCalled();
    expect(s.registroOficialUltimo).toMatchObject({ activo: true, consultados: 2, resueltos: 1 });
  });

  it("un folio que el catastro no tiene no se usa", async () => {
    const { s } = armarServicio();
    s.abrirRegistroOficial = jest.fn(async () => origenFalso());
    arcgis.mockResolvedValue([] as any);
    const registros: Array<Record<string, unknown>> = [{ caseNumber: "CACE26099001", defendantName: "Juan Perez" }];
    expect(await s.foliosPorRegistroOficial("url-bcpa", registros)).toEqual([]);
    expect(registros[0].parcelIds).toBeUndefined();
    expect(registros[0]).toMatchObject({ registroOficial: { estado: "FOLIO_FUERA_DEL_CATASTRO" } });
  });

  it("si el FTP falla, no frena la siembra: queda ERROR para reintentar", async () => {
    const { s } = armarServicio();
    s.abrirRegistroOficial = jest.fn(async () => {
      throw new Error("FTP de Official Records: la conexion sin respuesta en 25 s");
    });
    const registros: Array<Record<string, unknown>> = [{ caseNumber: "CACE26099001" }];
    expect(await s.foliosPorRegistroOficial("url-bcpa", registros)).toEqual([]);
    expect(registros[0]).toMatchObject({ registroOficial: { estado: "ERROR" } });
    expect(s.registroOficialUltimo.error).toContain("sin respuesta");
  });

  it("BROWARD_REGISTRO_OFICIAL=off no abre el FTP", async () => {
    process.env.BROWARD_REGISTRO_OFICIAL = "off";
    const { s } = armarServicio();
    s.abrirRegistroOficial = jest.fn();
    expect(await s.foliosPorRegistroOficial("url-bcpa", [{ caseNumber: "CACE26099001" }])).toEqual([]);
    expect(s.abrirRegistroOficial).not.toHaveBeenCalled();
  });
});

describe("IntegrationsService: la lista de expedientes de Broward sin folio", () => {
  function armarCorrida() {
    const base = armarServicio();
    const bf = base.s.connectors.find((c: { source: string }) => c.source === "broward-foreclosure");
    const sync = jest.spyOn(bf, "sync");
    const sembrados: Array<Array<Record<string, unknown>>> = [];
    const ingeridos: Array<Array<Record<string, unknown>>> = [];
    let resuelve = new Set<string>();
    jest.spyOn(base.s, "seedDealsFromDistressFolios").mockImplementation(async (...args: any[]) => {
      const registros = args[1] as Array<Record<string, unknown>>;
      sembrados.push(registros.map((r) => ({ ...r })));
      for (const r of registros) {
        if (resuelve.has(String(r.caseNumber))) r.parcelIds = ["504206200430"];
        else r.registroOficial = { estado: "SIN_LIS_PENDENS", motivo: "todavia no" };
      }
      return 0;
    });
    jest.spyOn(base.s, "ingestDistressRecords").mockImplementation(async (...args: any[]) => {
      ingeridos.push(args[1] as Array<Record<string, unknown>>);
      return { createdSignals: 0 };
    });
    jest.spyOn(base.s, "rescoreDealsWithDistress").mockResolvedValue(0);
    return {
      ...base,
      sync,
      sembrados,
      ingeridos,
      resolver: (casos: string[]) => (resuelve = new Set(casos)),
      lista: () => (base.metas["broward-foreclosure"] ? JSON.parse(base.metas["broward-foreclosure"])[CLAVE_SIN_FOLIO] : undefined),
      correr: () => base.service.sync("broward-foreclosure", { confirmPaidDataUse: true }),
    };
  }

  it("el que no resolvio queda en la lista; un dia sin expedientes nuevos se reintenta y, si resuelve, entra a la ingesta", async () => {
    const c = armarCorrida();
    c.sync.mockResolvedValueOnce({
      status: IntegrationStatus.OK,
      records: [{ caseNumber: "CACE26000001", defendantName: "Juan Perez" }, { caseNumber: "CACE26000002" }],
      estado: { ultimaFechaCompleta: "2026-10-29" },
    });
    c.resolver(["CACE26000002"]);
    await c.correr();
    expect(c.lista().map((e: { caso: string }) => e.caso)).toEqual(["CACE26000001"]);
    expect(c.ingeridos[0]).toHaveLength(2);

    c.sync.mockResolvedValueOnce({ status: IntegrationStatus.OK, records: [], estado: { ultimaFechaCompleta: "2026-10-29" } });
    c.resolver(["CACE26000001"]);
    await c.correr();
    expect(c.sembrados[1]).toHaveLength(1);
    expect(c.sembrados[1][0][MARCA_REINTENTO]).toBe(true);
    expect(c.ingeridos[1].map((r) => r.caseNumber)).toEqual(["CACE26000001"]);
    expect(c.ingeridos[1][0][MARCA_REINTENTO]).toBeUndefined();
    expect(c.lista()).toEqual([]);
    expect(JSON.parse(c.metas["broward-foreclosure"]).estadoConector).toEqual({ ultimaFechaCompleta: "2026-10-29" });
  });

  it("un reintento que sigue sin folio no va a la ingesta y sigue en la lista", async () => {
    const c = armarCorrida();
    c.sync.mockResolvedValueOnce({ status: IntegrationStatus.OK, records: [{ caseNumber: "CACE26000001" }] });
    await c.correr();
    c.sync.mockResolvedValueOnce({ status: IntegrationStatus.OK, records: [{ caseNumber: "CACE26000005" }] });
    c.resolver(["CACE26000005"]);
    await c.correr();
    expect(c.ingeridos[1].map((r) => r.caseNumber)).toEqual(["CACE26000005"]);
    expect(c.lista()).toEqual([expect.objectContaining({ caso: "CACE26000001", intentos: 2 })]);
  });

  it("si la fuente falla, la lista no se toca ni se reintenta", async () => {
    const c = armarCorrida();
    c.sync.mockResolvedValueOnce({ status: IntegrationStatus.OK, records: [{ caseNumber: "CACE26000001" }] });
    await c.correr();
    const antes = c.metas["broward-foreclosure"];
    c.sync.mockResolvedValueOnce({ status: IntegrationStatus.ERROR, message: "fetch failed" });
    await c.correr();
    expect(c.sembrados).toHaveLength(1);
    expect(c.metas["broward-foreclosure"]).toBe(antes);
  });
});
