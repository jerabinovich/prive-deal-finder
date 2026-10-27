import { IntegrationsService } from "./integrations.service";
import { IntegrationStatus } from "./connectors/types";

// 26-oct-2026 (revision de Codex del PR 23): estado por fuente en Integration.meta.estadoConector. El conector lo
// recibe en el sync y lo devuelve; el servicio lo guarda solo si la corrida termina OK, y despues de ingerir.
function armar(resultado: Record<string, unknown>, metaInicial?: Record<string, unknown>) {
  const metas: Record<string, string> = metaInicial ? { "broward-foreclosure": JSON.stringify(metaInicial) } : {};
  const mock: any = {
    integrationRun: { create: jest.fn(async () => ({ id: "run-1" })), update: jest.fn(async () => ({ startedAt: new Date() })) },
    integration: {
      findUnique: jest.fn(async ({ where }: any) => (where.source in metas ? { meta: metas[where.source] } : null)),
      upsert: jest.fn(async ({ where, update, create }: any) => {
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
  const bf = (service as any).connectors.find((c: { source: string }) => c.source === "broward-foreclosure");
  const sync = jest.spyOn(bf, "sync").mockResolvedValue(resultado);
  const s = service as any;
  jest.spyOn(s, "seedDealsFromDistressFolios").mockResolvedValue(0);
  jest.spyOn(s, "ingestDistressRecords").mockResolvedValue({ signals: 1 });
  jest.spyOn(s, "rescoreDealsWithDistress").mockResolvedValue(0);
  return { service, metas, sync, s };
}
const estado = (metas: Record<string, string>) =>
  metas["broward-foreclosure"] ? JSON.parse(metas["broward-foreclosure"]).estadoConector : undefined;
const correr = (service: IntegrationsService) => service.sync("broward-foreclosure", { confirmPaidDataUse: true });

describe("IntegrationsService: estado del conector", () => {
  const nuevo = { ultimaFechaCompleta: "2026-10-23" };

  it("le pasa al conector el estado guardado, sin pisar el resto de meta", async () => {
    const { service, sync, metas } = armar({ status: IntegrationStatus.OK, records: [], estado: nuevo },
      { otraCosa: 1, estadoConector: { ultimaFechaCompleta: "2026-10-22" } });
    await correr(service);
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ estado: { ultimaFechaCompleta: "2026-10-22" } }));
    expect(JSON.parse(metas["broward-foreclosure"]).otraCosa).toBe(1);
  });
  it("OK sin registros (dias sin foreclosures): guarda el estado", async () => {
    const { service, metas } = armar({ status: IntegrationStatus.OK, records: [], estado: nuevo });
    await correr(service);
    expect(estado(metas)).toEqual(nuevo);
  });
  it("OK con registros: guarda el estado despues de ingerir", async () => {
    const { service, metas } = armar({ status: IntegrationStatus.OK, records: [{ Case_Number: "X" }], estado: nuevo });
    await correr(service);
    expect(estado(metas)).toEqual(nuevo);
  });
  it("si la ingesta falla, el estado no avanza (la fecha se vuelve a pedir)", async () => {
    const { service, metas, s } = armar({ status: IntegrationStatus.OK, records: [{ Case_Number: "X" }], estado: nuevo });
    s.ingestDistressRecords.mockRejectedValue(new Error("db caida"));
    await correr(service);
    expect(estado(metas)).toBeUndefined();
  });
  it("si la fuente falla, el estado no avanza", async () => {
    const { service, metas } = armar({ status: IntegrationStatus.ERROR, message: "fetch failed", estado: nuevo });
    await correr(service);
    expect(estado(metas)).toBeUndefined();
  });
});
