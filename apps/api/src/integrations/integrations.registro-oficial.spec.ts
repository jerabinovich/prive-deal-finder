import { IntegrationsService } from "./integrations.service";
import { IntegrationStatus } from "./connectors/types";
import { fetchArcgisWhere } from "./connectors/arcgis";
import { CLAVE_SIN_FOLIO, MARCA_REINTENTO } from "./expedientes-sin-folio";
import { indiceVacio, type OrigenRegistro } from "./registro-oficial-broward";

jest.mock("./connectors/arcgis", () => ({ ...jest.requireActual("./connectors/arcgis"), fetchArcgisWhere: jest.fn() }));
const arcgis = fetchArcgisWhere as jest.MockedFunction<typeof fetchArcgisWhere>;
jest.mock("./rescore-distress", () => ({ ...jest.requireActual("./rescore-distress"), recalcularDistressYPuntaje: jest.fn(async () => 1) }));

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
    dealDistressSignal: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})) },
  };
  const service = new IntegrationsService(mock, {} as any);
  // 1-nov-2026: ninguna corrida de prueba abre el FTP real; las sentencias leen la ventana falsa.
  (service as any).abrirRegistroOficial = jest.fn(async () => origenFalso());
  // 6-nov-2026: ni la ventana local de los lis pendens (pasoLisPendens): vacia, para que estas corridas no la lean.
  (service as any).ventanaLisPendens = jest.fn(async () => indiceVacio());
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

describe("IntegrationsService: la sentencia final como remate (1-nov-2026)", () => {
  const anterior = process.env.BROWARD_REGISTRO_OFICIAL;
  afterEach(() => {
    if (anterior === undefined) delete process.env.BROWARD_REGISTRO_OFICIAL;
    else process.env.BROWARD_REGISTRO_OFICIAL = anterior;
  });
  function conSentencia(): OrigenRegistro {
    const archivos: Record<string, string> = {
      "Official_Records_Download/10-29-2026doc-ver.txt": doc("121178001", "FJ", "20261027", "101500", "", "CACE-26-016536"),
      "Official_Records_Download/10-29-2026nme-ver.txt": "",
      "Official_Records_Download/10-29-2026lnk-ver.txt": "",
    };
    return {
      listar: async (dir) => Object.keys(archivos).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
      leer: async (ruta) => archivos[ruta] ?? "",
      leerInicio: async () => "",
      recorrer: async () => undefined,
      cerrar: jest.fn(async () => undefined),
    };
  }
  function corrida() {
    const base = armarServicio();
    const bf = base.s.connectors.find((c: { source: string }) => c.source === "broward-foreclosure");
    jest.spyOn(bf, "sync").mockResolvedValue({ status: IntegrationStatus.OK, records: [], estado: { ultimaFechaCompleta: "2026-10-28" } });
    const fin = jest.spyOn(base.s, "finishRun");
    return { ...base, fin, correr: () => base.service.sync("broward-foreclosure", { confirmPaidDataUse: true }) };
  }

  it("un dia sin expedientes nuevos igual mira las sentencias: la de un caso conocido entra y se recalcula su deal", async () => {
    const c = corrida();
    c.s.abrirRegistroOficial = jest.fn(async () => conSentencia());
    c.mock.dealDistressSignal.findMany.mockResolvedValue([{ dealId: "deal-1", externalId: "CACE26016536" }]);
    await c.correr();
    expect(c.mock.dealDistressSignal.upsert.mock.calls[0][0].create).toMatchObject({ dealId: "deal-1", source: "broward-sentencia" });
    const { recalcularDistressYPuntaje } = jest.requireMock("./rescore-distress");
    expect(recalcularDistressYPuntaje).toHaveBeenCalledWith(c.mock, ["deal-1"]);
    expect((c.fin.mock.calls[0] as any[])[2].metrics.sentencias).toEqual({ activo: true, enVentana: 1, conSenal: 1, nuevas: 1, recalculados: 1 });
  });

  // 4-nov-2026: con la misma ventana, el caso que termino antes del remate (cierres-broward.ts). CACE26015855, real.
  function conCierre(): OrigenRegistro {
    const archivos: Record<string, string> = {
      "Official_Records_Download/10-26-2026doc-ver.txt": [
        doc("121171429", "RST", "20261026", "121833", "", "CACE-26-015855"),
        `121172402|20261026|x|033012|D|425000.00|||O||484124022810|||2|0|V||E||`,
      ].join("\n"),
      "Official_Records_Download/10-26-2026nme-ver.txt": [
        "121171429|GNZ FUNDING LLC|D|",
        "121171429|JAVIAC ENTERPRISES CORP|R|",
        "121172402|JAVIAC ENTERPRISES CORP|D|",
        "121172402|NORTH LAUDERDALE LLC|R|",
      ].join("\n"),
      "Official_Records_Download/10-26-2026lnk-ver.txt": "",
    };
    return {
      listar: async (dir) => Object.keys(archivos).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
      leer: async (ruta) => archivos[ruta] ?? "",
      leerInicio: async () => "",
      recorrer: async () => undefined,
      cerrar: jest.fn(async () => undefined),
    };
  }

  it("el caso vendido y liberado sale del distress: cierre guardado, senal en CLEARED y deal recalculado", async () => {
    const c = corrida();
    c.s.abrirRegistroOficial = jest.fn(async () => conCierre());
    c.mock.dealDistressSignal.update = jest.fn(async () => ({}));
    c.mock.dealDistressSignal.findMany.mockResolvedValue([
      {
        id: "s-1",
        dealId: "deal-margate",
        externalId: "CACE26015855",
        metadata: JSON.stringify({ defendantName: "JAVIAC ENTERPRISES CORP", filedDate: "09/29/2026" }),
        deal: { parcelId: "484124022810" },
      },
    ]);
    await c.correr();
    expect(c.mock.dealDistressSignal.upsert.mock.calls[0][0].create).toMatchObject({ dealId: "deal-margate", source: "broward-cierre", status: "CLEARED" });
    expect(c.mock.dealDistressSignal.update).toHaveBeenCalledWith({ where: { id: "s-1" }, data: { status: "CLEARED" } });
    const { recalcularDistressYPuntaje } = jest.requireMock("./rescore-distress");
    expect(recalcularDistressYPuntaje).toHaveBeenCalledWith(c.mock, ["deal-margate"]);
    expect((c.fin.mock.calls[0] as any[])[2].metrics.cierres).toEqual({
      activo: true, revisadas: 1, cerradas: 1, porLiberacion: 1, porVenta: 1, recalculados: 1,
    });
  });

  it("si el FTP falla, la corrida sigue OK y la metrica lo dice", async () => {
    const c = corrida();
    c.s.abrirRegistroOficial = jest.fn(async () => {
      throw new Error("FTP de Official Records: la conexion sin respuesta en 25 s");
    });
    await c.correr();
    expect((c.fin.mock.calls[0] as any[])[2].status).toBe(IntegrationStatus.OK);
    expect((c.fin.mock.calls[0] as any[])[2].metrics.sentencias.error).toContain("sin respuesta");
    expect((c.fin.mock.calls[0] as any[])[2].metrics.cierres.error).toContain("sin respuesta");
  });

  it("BROWARD_REGISTRO_OFICIAL=off no abre el FTP", async () => {
    process.env.BROWARD_REGISTRO_OFICIAL = "off";
    const c = corrida();
    c.s.abrirRegistroOficial = jest.fn();
    await c.correr();
    expect(c.s.abrirRegistroOficial).not.toHaveBeenCalled();
    expect((c.fin.mock.calls[0] as any[])[2].metrics.sentencias).toEqual({ activo: false });
    expect((c.fin.mock.calls[0] as any[])[2].metrics.cierres).toEqual({ activo: false });
  });
});

describe("IntegrationsService: la ingesta respeta el cierre del registro oficial (4-nov-2026)", () => {
  function ingesta(conCierre: boolean) {
    const { s, mock } = armarServicio();
    mock.deal = { findFirst: jest.fn(async () => ({ id: "deal-margate" })) };
    mock.dealDistressSignal.findUnique = jest.fn(async ({ where }: any) =>
      where.dealId_source_externalId.source === "broward-cierre" ? (conCierre ? { id: "cierre-1" } : null) : { id: "s-1" },
    );
    const registro = { caseNumber: "CACE26015855", parcelId: "484124022810", status: "CONFIRMED", defendantName: "JAVIAC ENTERPRISES CORP" };
    return { correr: () => s.ingestDistressRecords("broward-foreclosure", [registro]), mock };
  }

  it("un caso que vuelve del Clerk ya cerrado queda en CLEARED", async () => {
    const i = ingesta(true);
    await i.correr();
    const { update, create } = i.mock.dealDistressSignal.upsert.mock.calls[0][0];
    expect(update.status).toBe("CLEARED");
    expect(create.status).toBe("CLEARED");
  });

  it("sin cierre la senal sigue CONFIRMED, como siempre", async () => {
    const i = ingesta(false);
    await i.correr();
    expect(i.mock.dealDistressSignal.upsert.mock.calls[0][0].update.status).toBe("CONFIRMED");
  });
});
