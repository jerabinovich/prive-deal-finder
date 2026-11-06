import { IntegrationsService } from "./integrations.service";
import { IntegrationStatus } from "./connectors/types";
import { agregarArchivo, indiceVacio } from "./registro-oficial-broward";

jest.mock("./rescore-distress", () => ({ ...jest.requireActual("./rescore-distress"), recalcularDistressYPuntaje: jest.fn(async () => 1) }));

// 6-nov-2026 (JR, fase 2): los lis pendens que el Clerk no trajo entran por la misma ingesta, con el tipo inferido.
const doc = (inst: string, ymd: string, tipo: string, monto: number, caso = "") =>
  `${inst}|${ymd}|${ymd.slice(4, 6)}/${ymd.slice(6)}/${ymd.slice(0, 4)}|101500|${tipo}|${monto.toFixed(2)}|||O|||||1|0|V||E|${caso}|`;

function ventana() {
  const ind = indiceVacio();
  agregarArchivo(ind, "doc", [
    doc("121300005", "20261104", "M", 900000),
    doc("121300006", "20261104", "LP", 0, "CACE-26-018006"),
    doc("121300007", "20261104", "LP", 0, "CACE-26-014898"),
  ].join("\n"));
  agregarArchivo(ind, "nme", ["121300005|NUEVO DUENO LLC|D|1|", "121300006|OTRO BANCO NA|D|1|", "121300006|NUEVO DUENO LLC|R|1|"].join("\n"));
  agregarArchivo(ind, "lnk", ["121300006|||O|LP|121300005|1|1|O|M|121300005|", "121300007|||O|LP|118000001|1|1|O|M|118000001|"].join("\n"));
  ind.dias = ["2026-11-04"];
  return ind;
}

function armar(clerk: { status: IntegrationStatus; records?: unknown[]; message?: string }) {
  const mock: any = {
    integrationRun: { create: jest.fn(async () => ({ id: "run-1" })), update: jest.fn(async (a: any) => ({ startedAt: new Date(), ...a.data })) },
    integration: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})) },
    alertEvent: { upsert: jest.fn(async () => ({ id: "a" })) },
    alertRule: { findMany: jest.fn(async () => []) },
    alertInboxItem: { createMany: jest.fn(async () => ({})) },
    stagingRecord: { createMany: jest.fn() },
    dealDistressSignal: {
      findMany: jest.fn(async (a: any) => (a?.distinct ? [{ externalId: "CACE26014898" }] : [])),
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
    },
    deal: {
      findFirst: jest.fn(async () => ({ id: "deal-lp", propertyUseCode: "11", assetType: "Stores, one story (DOR 11)" })),
      findMany: jest.fn(async () => [{ distressStage: "PRE_FORECLOSURE" }]),
    },
  };
  const service = new IntegrationsService(mock, {} as any);
  const s = service as any;
  s.abrirRegistroOficial = jest.fn(async () => {
    throw new Error("sin FTP en la prueba");
  });
  s.ventanaLisPendens = jest.fn(async () => ventana());
  s.archivosLisPendens = jest.fn(async () => []);
  const bf = s.connectors.find((c: { source: string }) => c.source === "broward-foreclosure");
  jest.spyOn(bf, "sync").mockResolvedValue(clerk);
  const sembrados: Array<Record<string, unknown>> = [];
  jest.spyOn(s, "seedDealsFromDistressFolios").mockImplementation(async (...args: any[]) => {
    for (const r of args[1] as Array<Record<string, unknown>>) {
      sembrados.push(r);
      r.parcelId = "494212040070";
      r.parcelIds = ["494212040070"];
    }
    return 1;
  });
  const ingeridos: Array<Record<string, unknown>> = [];
  jest.spyOn(s, "ingestDistressRecords").mockImplementation(async (...args: any[]) => {
    ingeridos.push(...(args[1] as Array<Record<string, unknown>>));
    return { createdSignals: (args[1] as unknown[]).length };
  });
  jest.spyOn(s, "rescoreDealsWithDistress").mockResolvedValue(0);
  return { service, mock, sembrados, ingeridos };
}

describe("IntegrationsService: lis pendens de Broward (fase 2)", () => {
  const anterior = process.env.BROWARD_LIS_PENDENS;
  afterEach(() => {
    if (anterior === undefined) delete process.env.BROWARD_LIS_PENDENS;
    else process.env.BROWARD_LIS_PENDENS = anterior;
  });

  it("con el Clerk sin unidades igual entran los lis pendens; la corrida conserva el error del Clerk", async () => {
    const c = armar({ status: IntegrationStatus.ERROR, message: "Low Unit Balance !" });
    const r = await c.service.sync("broward-foreclosure", { confirmPaidDataUse: true });
    expect(r.status).toBe(IntegrationStatus.ERROR);
    expect(c.sembrados.map((x) => x.caseNumber)).toEqual(["CACE26018006"]); // el conocido no entra
    expect(c.ingeridos).toHaveLength(1);
    expect(c.ingeridos[0]).toMatchObject({
      caseNumber: "CACE26018006",
      caseTypeCode: "Real Prop Comm Fore $250,000 or More (inferido del lis pendens)",
      metadata: { Case_Type: "Real Prop Comm Fore $250,000 or More (inferido del lis pendens)" },
      origen: "lis-pendens",
      caption: "OTRO BANCO NA Plaintiff vs. NUEVO DUENO LLC Defendant",
    });
    const crudo = c.mock.integrationRun.update.mock.calls.at(-1)[0].data.metrics;
    const metricas = typeof crudo === "string" ? JSON.parse(crudo) : crudo;
    expect(metricas.lisPendens).toMatchObject({ activo: true, candidatos: 1, conFolio: 1, sinFolio: 0 });
  });

  it("un expediente que trajo el Clerk en la misma corrida no se duplica desde el lis pendens", async () => {
    const c = armar({ status: IntegrationStatus.OK, records: [{ caseNumber: "CACE26018006", defendantName: "Nuevo Dueno LLC" }] });
    await c.service.sync("broward-foreclosure", { confirmPaidDataUse: true });
    expect(c.ingeridos.filter((x) => x.origen === "lis-pendens")).toHaveLength(0);
  });

  it("BROWARD_LIS_PENDENS=off no lee la ventana", async () => {
    process.env.BROWARD_LIS_PENDENS = "off";
    const c = armar({ status: IntegrationStatus.OK, records: [] });
    await c.service.sync("broward-foreclosure", { confirmPaidDataUse: true });
    expect((c.service as any).ventanaLisPendens).not.toHaveBeenCalled();
    expect(c.sembrados).toHaveLength(0);
  });
});
